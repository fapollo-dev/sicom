import { Injectable } from '@nestjs/common';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { TributacaoRepository } from '../precificacao/tributacao.repository';
import { FiscalPricingService } from '../precificacao/preco-fiscal.service';

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
  ) {}

  private round2(v: number): number {
    return Math.round((v + Number.EPSILON) * 100) / 100;
  }

  /** Recalcula os impostos de cada item; devolve o dto enriquecido (NÃO grava). */
  async recalcular(dto: Record<string, unknown>): Promise<Record<string, unknown>> {
    const uf = await this.resolverUf(dto);
    const itens = Array.isArray(dto.itens) ? (dto.itens as Record<string, unknown>[]) : [];
    const calculados: Record<string, unknown>[] = [];
    for (const it of itens) calculados.push(await this.calcularItem(it, uf));
    return { ...dto, itens: calculados };
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

  private async calcularItem(it: Record<string, unknown>, uf: string): Promise<Record<string, unknown>> {
    const item: Record<string, unknown> = { ...it };
    const codAliquota = it.aliquota != null ? String(it.aliquota).trim() : '';
    if (!codAliquota) return item; // sem config fiscal por item → nada a recalcular

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
    const vripi = this.round2((totalProds * num(it.ipi)) / 100);
    item.vripi = vripi;

    // complementoBase (flags GERAICM_*; default 'N' = revenda dominante) — udmNF.pas:4189-4196.
    // Nota: acessórias usa vroutrasdesp (o schema F1 não tem coluna DEPSACESS separada do legado).
    let complemento = 0;
    if (it.geraicm_ipi === 'S') complemento += vripi;
    if (it.geraicm_frete === 'S') complemento += num(it.frete);
    if (it.geraicm_acess === 'S') complemento += this.round2((num(it.vroutrasdesp) * a.base) / 100);

    let vrbasecalculo = this.round2((totalProds * a.base) / 100 + complemento);
    let vricm = this.round2((vrbasecalculo * a.icm) / 100); // alíquota DESTACADA (redução já no BCR)

    // (2) Zeramento de crédito por CFOP/CST. (Adiado: o gate por config
    // APROVEITAMENTO_CREDITO_ICMSST_NF do legado — default <>'S' = zerar, que é o que fazemos.)
    if (this.zeraCreditoIcms(String(it.cfop ?? ''), a.cst, codAliquota)) {
      vrbasecalculo = 0;
      vricm = 0;
    }
    item.vrbasecalculo = vrbasecalculo;
    item.vricm = vricm;

    // (4) ICMS-ST clássico — só p/ CFOP da lista + MVA>0 (reuso do motor; sem MVA ajustado).
    const cfop = String(it.cfop ?? '');
    const ncm = it.ncm != null ? String(it.ncm).trim() : '';
    if (NfFiscalService.CFOP_ST.has(cfop) && ncm && !this.bonificacaoSemSt(cfop, a.cst)) {
      const idx = await this.trib.resolverIndexador(ncm); // {aliquotaDest, icmFonte, mva}
      if (idx.mva > 0) {
        const st = this.fiscal.calcularIcmsSt(
          totalProds,
          { aliquotaDest: idx.aliquotaDest, icmFonte: idx.icmFonte, mva: idx.mva },
          'atual',
        );
        item.mva = idx.mva;
        item.vrbasest = st.baseSt;
        item.vricmst = st.icmsSt;
        item.streal = st.icmsSt;
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
