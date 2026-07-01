import { Injectable } from '@nestjs/common';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { TributacaoRepository } from '../precificacao/tributacao.repository';
import { FiscalPricingService } from '../precificacao/preco-fiscal.service';
import { ConfigService } from './config.service';

type AnyDB = any;
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/**
 * NF — Fase 2: RECÁLCULO fiscal por item de ENTRADA, REUSANDO o motor `precificacao`
 * (NÃO reescreve cálculo). Ação explícita (espelha o btnCalcular/recálculo do legado),
 * PURA: recebe o dto da NF e DEVOLVE o dto com os campos fiscais por item preenchidos —
 * NÃO grava nada (a persistência continua no save do agregado). Mantém a invariante F1
 * "sem efeitos".
 *
 * Fórmulas verbatim do legado (proveniência no dossiê uNF.md §7):
 *  - ICMS próprio: VRBASECALCULO = round(TOTALPRODS·BCR/100 + complementoBase);
 *    VRICM = round(VRBASECALCULO·ICME/100)   (udmNF.pas:4200/4218)
 *  - zeramento de crédito por CFOP/CST        (udmNF.pas:4231-4261)
 *  - IPI = round(TOTALPRODS·ipi%/100)          (udmNF.pas:4164)
 *  - ICMS-ST clássico = baseSt·aliqDest − ICMS próprio (reuso FiscalPricingService.calcularIcmsSt)
 *
 * Reuso: TributacaoRepository.resolverAtual (DET_ALIQUOTA → icm/icmEfetivo/base/cst) e
 * resolverIndexador (INDEXADOR_TRIBUTARIO → mva/aliqDest/icmFonte). A UF vem do parceiro da nota.
 *
 * Adiado (F2b+, dossiê §10): MVA ajustado, redução BC-ST/própria complexa, ST SN-vs-LR+Lei3166,
 * DIFAL/FCP, PIS/COFINS valor, rateio fino, figura fiscal completa, modo-truncar (flag ARREDONDA).
 */
@Injectable()
export class NfFiscalService {
  // CFOPs que disparam ICMS-ST (uIndexadorTributario.pas SetCFOP L420-436).
  private static readonly CFOP_ST = new Set([
    '1403', '2403', '1401', '2401', '1407', '2407', '1411', '2411', '5403', '6403',
    '1949', '2949', '5411', '6411', '5202', '6202', '1910', '2910', '1911', '2911',
    '1902', '2902', '1124', '1923', '2923', '1406', '2406',
  ]);

  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly trib: TributacaoRepository,
    private readonly fiscal: FiscalPricingService,
    private readonly config: ConfigService,
  ) {}

  private round2(v: number): number {
    return Math.round((v + Number.EPSILON) * 100) / 100;
  }
  private trunc2(v: number): number {
    return Math.trunc(v * 100) / 100;
  }
  /** F2b — ARREDONDA por item: 'N' trunca 2 casas; senão arredonda (golden: o valor ARMAZENADO segue a flag). */
  private arred(v: number, modo: string): number {
    return modo === 'N' ? this.trunc2(v) : this.round2(v);
  }

  /** Recalcula os impostos de cada item; devolve o dto enriquecido (NÃO grava). */
  async recalcular(dto: Record<string, unknown>): Promise<Record<string, unknown>> {
    const uf = await this.resolverUf(dto);
    const emp = currentTenant().empresaId ?? null;
    const empresa = await this.resolverEmpresa(emp); // { uf origem, classfiscal, alqsimplesnac }
    // F2c: empresa Simples Nacional NÃO destaca ICMS/ST na emissão (DmOld/udmNF.pas:1869).
    const empresaSn = empresa?.classfiscal === 'SN';
    const alqSimplesNac = num(empresa?.alqsimplesnac);
    const tipoNota = dto.tipo != null ? String(dto.tipo) : ''; // 'E' entrada / 'S' saída (regime SN difere)
    // Epic-config: gate real do zeramento de crédito de ST (udmNF.pas:4231/4470); default 'N' = zera.
    const aproveitaCreditoSt = await this.config.ligado('APROVEITAMENTO_CREDITO_ICMSST_NF', { empresaId: emp });
    const itens = Array.isArray(dto.itens) ? (dto.itens as Record<string, unknown>[]) : [];
    const calculados: Record<string, unknown>[] = [];
    for (const it of itens)
      calculados.push(await this.calcularItem(it, uf, empresa?.uf ?? null, empresaSn, aproveitaCreditoSt, tipoNota, alqSimplesNac));
    return { ...dto, itens: calculados };
  }

  /** Config fiscal da EMPRESA (emitente/tenant): UF de origem (MVA ajustado interestadual) + regime
   * (CLASSFISCAL 'LR'/'SN'). Consolidou o stub empresa_fiscal. null se não cadastrada. */
  private async resolverEmpresa(
    emp: number | null,
  ): Promise<{ uf: string | null; classfiscal: string | null; alqsimplesnac: number } | null> {
    if (emp == null) return null;
    const ef = await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('empresas')
      .select(['uf', 'classfiscal', 'alqsimplesnac'])
      .where('idempresa', '=', emp)
      .executeTakeFirst();
    if (!ef) return null;
    return {
      uf: ef.uf ? String(ef.uf).toUpperCase() : null,
      classfiscal: ef.classfiscal ? String(ef.classfiscal) : null,
      alqsimplesnac: num(ef.alqsimplesnac), // crédito presumido do Simples na ENTRADA (udmNF.pas:4021)
    };
  }

  /** UF da nota (não por item): nf.codparceiro_end → parceiros_end.uf; senão endereço padrão. */
  private async resolverUf(dto: Record<string, unknown>): Promise<string> {
    const db = this.dbp.forTenantRead() as AnyDB;
    if (dto.codparceiro_end != null) {
      const e = await db
        .selectFrom('parceiros_end')
        .select('uf')
        .where('codend', '=', Number(dto.codparceiro_end))
        .executeTakeFirst();
      if (e?.uf) return String(e.uf).toUpperCase();
    }
    if (dto.codparceiro != null) {
      const r = await db
        .selectFrom('parceiros as p')
        .innerJoin('parceiros_end as e', 'e.codend', 'p.codend')
        .select('e.uf as uf')
        .where('p.codparceiro', '=', Number(dto.codparceiro))
        .executeTakeFirst();
      if (r?.uf) return String(r.uf).toUpperCase();
    }
    throw new BusinessRuleError('NF_UF_NAO_RESOLVIDA', { codparceiro: dto.codparceiro });
  }

  private async calcularItem(
    it: Record<string, unknown>,
    uf: string,
    ufOrigem: string | null,
    empresaSn: boolean,
    aproveitaCreditoSt: boolean,
    tipoNota: string,
    alqSimplesNac: number,
  ): Promise<Record<string, unknown>> {
    const item: Record<string, unknown> = { ...it };
    const codAliquota = it.aliquota != null ? String(it.aliquota).trim() : '';
    if (!codAliquota) return item; // sem config fiscal por item → nada a recalcular

    const modo = it.arredonda != null ? String(it.arredonda) : 'S'; // F2b: arredonda(S)/trunca(N) por item
    const totalProds = this.round2(num(it.quantidade) * num(it.vrvenda)); // TOTALPRODS do item

    // (1) ICMS próprio — resolve (aliquota, uf) e aplica as fórmulas verbatim do legado.
    const a = await this.trib.resolverAtual(codAliquota, uf); // {icm (destacada), icmEfetivo, base (BCR), cst}
    item.cst = a.cst;
    // a redução vive UMA vez no BCR (base); o ICMS é base_reduzida × alíquota DESTACADA (a.icm),
    // NÃO a efetiva — senão a redução seria aplicada 2× (udmNF.pas:4200/4215/4218: VRBASECALCULO=
    // TOTALPRODS·BCR/100; VRICM=VRBASECALCULO·ICM/100). a.icmEfetivo é só p/ exibição/crédito.
    item.icms = a.icm; // alíquota destacada/operação (a usada no destaque)
    item.icme = a.icmEfetivo; // alíquota efetiva (exibição; legado a guarda no campo "ICMS")
    item.bcr = a.base; // % base reduzida (BCR)

    // (3) IPI = % sobre o total de produtos do item (ipi guarda a alíquota %).
    // O IPI SEMPRE arredonda (udmNF.pas:4164 — TruncarArredondar 'A', independe de ARREDONDA).
    const vripi = this.round2((totalProds * num(it.ipi)) / 100);
    item.vripi = vripi;

    // complementoBase (flags GERAICM_*; default 'N' = revenda dominante) — udmNF.pas:4189-4196.
    // F2b: acessórias usa DEPSACESS (× BCR) — coluna correta (udmNF.pas:4193). Frete entra integral.
    let complemento = 0;
    if (it.geraicm_ipi === 'S') complemento += vripi;
    if (it.geraicm_frete === 'S') complemento += num(it.frete);
    if (it.geraicm_acess === 'S') complemento += this.round2((num(it.depsacess) * a.base) / 100);

    // Base CRUA do ICMS. ARREDONDA (udmNF.pas:4199-4202/4217-4220): em 'S' arredonda a base e
    // calcula o VRICM sobre ela; em 'N' deixa a base CHEIA e trunca SÓ o VRICM (não a base).
    const baseIcm = (totalProds * a.base) / 100 + complemento;
    let vrbasecalculo = this.arred(baseIcm, modo);
    let vricm = this.arred(((modo === 'N' ? baseIcm : vrbasecalculo) * a.icm) / 100, modo); // alíquota DESTACADA (redução no BCR)

    // (2) Zeramento de crédito por CFOP/CST — GATE por config `APROVEITAMENTO_CREDITO_ICMSST_NF`
    // (udmNF.pas:4231/4470): default <>'S' → zera; se a empresa tiver o override 'S', APROVEITA (não zera).
    if (!aproveitaCreditoSt && this.zeraCreditoIcms(String(it.cfop ?? ''), a.cst, codAliquota)) {
      vrbasecalculo = 0;
      vricm = 0;
    }
    item.vrbasecalculo = vrbasecalculo;
    item.vricm = vricm;

    // (4) ICMS-ST (F2b profundo): MVA ajustado interestadual + redução BC-ST (REDCOM) + crédito (LR).
    const cfop = String(it.cfop ?? '');
    const ncm = it.ncm != null ? String(it.ncm).trim() : '';
    if (NfFiscalService.CFOP_ST.has(cfop) && ncm && !this.bonificacaoSemSt(cfop, a.cst)) {
      const idx = await this.trib.resolverIndexador(ncm);
      if (idx.mva > 0) {
        const interstate = !!ufOrigem && ufOrigem !== uf; // UF emitente ≠ destino → MVA ajustado
        const st = this.fiscal.calcularIcmsSt(
          totalProds,
          {
            aliquotaDest: idx.aliquotaDest,
            icmFonte: idx.icmFonte,
            mva: idx.mva,
            redcom: idx.redcom, // redução da BC-ST (default 100 = sem)
            aliquotaFem: idx.aliquotaFem, // FEM no MVA ajustado
            interstate,
            fornecedorSn: idx.tpFigura === 'S', // fornecedor Simples → não ajusta MVA
            // reducaoAliqFonte default 100 (crédito sem redução) — coluna específica adiada.
          },
          'atual',
        );
        item.mva = st.mvaEfetivo; // MVA AJUSTADO (golden: armazena o ajustado)
        item.vrbasest = this.arred(st.baseSt, modo);
        item.vricmst = this.arred(st.icmsSt, modo);
        item.streal = this.arred(st.icmsSt, modo);
      }
    }

    // (5) F2c — REGIME DA EMPRESA (Simples Nacional). SN nunca é substituto → zera ST em qualquer
    // sentido. O ICMS próprio depende do TIPO da nota (udmNF.pas:4011-4022 / DmOld:1869-1877):
    //  - SAÍDA/emissão: SN NÃO destaca ICMS → zera base+ICMS (`if not (CLASSFISCAL='SN') then ...`).
    //  - ENTRADA: crédito PRESUMIDO do Simples = base_ICMS × ALQSIMPLESNAC/100 (udmNF.pas:4021,
    //    TruncarArredondar 'A'); mantém a base. (Substitui o crédito-por-diferença do Lucro Real.)
    if (empresaSn) {
      item.vrbasest = 0;
      item.vricmst = 0;
      item.streal = 0;
      if (tipoNota === 'E') {
        item.vricm = this.round2((num(item.vrbasecalculo) * alqSimplesNac) / 100); // crédito presumido
      } else {
        item.vrbasecalculo = 0;
        item.vricm = 0;
      }
    }
    return item;
  }

  /** Bonificação tributada (CFOP 19xx/29xx) só calcula ST com CST 10/70/60 — uIndexadorTributario.pas:439-443. */
  private bonificacaoSemSt(cfop: string, cst: number): boolean {
    const bonif = ['1910', '2910', '1911', '2911', '1902', '2902'].includes(cfop);
    return bonif && ![10, 70, 60].includes(Number(cst));
  }

  /** Zeramento de crédito de ICMS próprio por CFOP/CST (udmNF.pas:4231-4261). */
  private zeraCreditoIcms(cfop: string, cst: number, aliquota: string): boolean {
    const fim3 = cfop.slice(-3); // ex.: '1403' → '403'
    if (['401', '403', '933', '556'].includes(fim3)) return true; // ST já retida — sem crédito
    if (['101', '102'].includes(fim3) && (cst === 40 || cst === 90)) return true;
    if ((cfop === '1910' || cfop === '2910') && aliquota.charAt(0).toUpperCase() !== 'T') return true;
    return false;
  }
}
