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
  // CFOPs que disparam retenção de FUNRURAL (udmNF.pas:3728).
  private static readonly FUNRURAL_CFOP = new Set([
    '1403', '2403', '1401', '2401', '1102', '2102', '1101', '2101', '1949', '2949', '1556', '2556', '1407', '2407',
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
    // F2c-2: figura fiscal só é consultada quando FIGURAFISCAL 'O'/'S' (udmNF.pas:6666); 'D' usa alíquota/NCM.
    const figuraFiscal = empresa?.figurafiscal ?? 'D';
    // Epic-config: gate real do zeramento de crédito de ST (udmNF.pas:4231/4470); default 'N' = zera.
    const aproveitaCreditoSt = await this.config.ligado('APROVEITAMENTO_CREDITO_ICMSST_NF', { empresaId: emp });
    const itens = Array.isArray(dto.itens) ? (dto.itens as Record<string, unknown>[]) : [];
    const calculados: Record<string, unknown>[] = [];
    for (const it of itens)
      calculados.push(
        await this.calcularItem(it, uf, empresa?.uf ?? null, empresaSn, aproveitaCreditoSt, tipoNota, alqSimplesNac, figuraFiscal),
      );
    // A1 — retenções de serviço no cabeçalho (CalcularRetencoes, udmNF.pas:3558). Só ENTRADA c/ situação E03.
    const retencoes = await this.calcularRetencoes(dto, tipoNota, emp, calculados);
    return { ...dto, ...retencoes, itens: calculados };
  }

  /** valor de config numérico (aceita vírgula ou ponto decimal). */
  private numCfg(s: string | null | undefined): number {
    if (!s) return 0;
    const n = Number(String(s).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * A1 — cálculo das RETENÇÕES no cabeçalho (CalcularRetencoes, udmNF.pas:3558). Retenção só em ENTRADA
   * de serviço: gate TIPO='E' + codparceiro + SITUACAO_NF.TIPO_OPERACAO='E03' (SituacaoGeraRetencao) +
   * totalnf>0. Cada retenção = base × alíquota/100. Flags por parceiro (HABILITA_RETENCAO_*_NF); alíquotas
   * da camada de config (ALIQUOTA_RETENCAO_*) — IR/ISSQN preferem PERC_ALIQUOTA_IR/ISSQN do parceiro.
   * Bases: PIS/COFINS/CSLL/IR sobre BASE_RET_IRRF_PISCOFINS_CSLL (default totalnf); INSS sobre
   * BASE_RETENCAO_INSS (default totalnf); ISSQN/FUNRURAL sobre TOTALNOTA (=totalnf). FUNRURAL tem gate
   * próprio por lista de CFOP. Puro (não grava). Override manual das bases = UI (adiado).
   */
  private async calcularRetencoes(
    dto: Record<string, unknown>,
    tipoNota: string,
    emp: number | null,
    itens: Record<string, unknown>[],
  ): Promise<Record<string, unknown>> {
    const zero = {
      total_ret_pis: 0, total_ret_cofins: 0, total_ret_csll: 0, total_ret_ir: 0,
      total_ret_inss: 0, total_ret_issqn: 0, total_ret_funrural: 0,
      base_ret_irrf_piscofins_csll: 0, base_retencao_inss: 0,
      // resíduo (e): SNAPSHOT da alíquota REAL usada por imposto (udmNF.pas:3659-3679) — o F4 lê daqui p/ a OBS,
      // fechando o drift de config entre F2 e F4. Só a % — o VALOR já é o snapshot nf.total_ret_*.
      perc_aliquota_ret_pis: 0, perc_aliquota_ret_cofins: 0, perc_aliquota_ret_csll: 0, perc_aliquota_ret_ir: 0,
      perc_aliquota_ret_inss: 0, perc_aliquota_ret_issqn: 0, perc_aliquota_ret_funrural: 0,
    };
    const codparceiro = dto.codparceiro != null ? Number(dto.codparceiro) : 0;
    const idsit = dto.idsituacao_nf != null ? Number(dto.idsituacao_nf) : 0;
    if (tipoNota !== 'E' || !codparceiro || !idsit) return zero;

    // base = totalnf recomputado dos itens (mesma fórmula do nf.aggregate.derivar).
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    let totalprod = 0, totaldesc = 0, totalipi = 0, totalicmSt = 0;
    for (const it of itens) {
      totalprod += num(it.quantidade) * num(it.vrvenda);
      totaldesc += num(it.desconto);
      totalipi += num(it.vripi);
      totalicmSt += num(it.vricmst);
    }
    const totalnf = r2(totalprod - totaldesc + num(dto.totalfrete) + num(dto.totalseguro) + num(dto.totalacessorias) + totalipi + totalicmSt);
    if (totalnf <= 0) return zero;

    const db = this.dbp.forTenantRead() as AnyDB;
    const sit = await db.selectFrom('situacao_nf').select('tipo_operacao').where('idsituacao_nf', '=', idsit).executeTakeFirst();
    const geraRetencao = sit?.tipo_operacao === 'E03'; // SituacaoGeraRetencao (udmNF:5356)
    const cfop = String(dto.cfop ?? '');
    const funruralCfop = NfFiscalService.FUNRURAL_CFOP.has(cfop);
    if (!geraRetencao && !funruralCfop) return zero;

    const p = await db
      .selectFrom('parceiros')
      .select([
        'habilita_retencao_pis_nf', 'habilita_retencao_cofins_nf', 'habilita_retencao_csll_nf',
        'habilita_retencao_ir_nf', 'habilita_retencao_inss_nf', 'habilita_retencao_issqn_nf',
        'habilita_retencao_funrural_nf', 'perc_aliquota_ir', 'perc_aliquota_issqn',
      ])
      .where('codparceiro', '=', codparceiro)
      .executeTakeFirst();
    if (!p) return zero;

    const cfg = (codigo: string) => this.config.resolver(codigo, { empresaId: emp ?? undefined });
    const out = { ...zero, base_ret_irrf_piscofins_csll: totalnf, base_retencao_inss: totalnf };

    // PIS/COFINS/CSLL/IR/INSS/ISSQN — só quando a SITUAÇÃO gera retenção (E03).
    if (geraRetencao) {
      if (p.habilita_retencao_pis_nf === 'S') {
        const a = this.numCfg(await cfg('ALIQUOTA_RETENCAO_PIS'));
        if (a > 0) { out.total_ret_pis = r2((totalnf * a) / 100); out.perc_aliquota_ret_pis = a; }
      }
      if (p.habilita_retencao_cofins_nf === 'S') {
        const a = this.numCfg(await cfg('ALIQUOTA_RETENCAO_COFINS'));
        if (a > 0) { out.total_ret_cofins = r2((totalnf * a) / 100); out.perc_aliquota_ret_cofins = a; }
      }
      if (p.habilita_retencao_csll_nf === 'S') {
        const a = this.numCfg(await cfg('ALIQUOTA_RETENCAO_CSLL'));
        if (a > 0) { out.total_ret_csll = r2((totalnf * a) / 100); out.perc_aliquota_ret_csll = a; }
      }
      if (p.habilita_retencao_ir_nf === 'S') {
        const a = num(p.perc_aliquota_ir) > 0 ? num(p.perc_aliquota_ir) : this.numCfg(await cfg('ALIQUOTA_RETENCAO_IR'));
        if (a > 0) { out.total_ret_ir = r2((totalnf * a) / 100); out.perc_aliquota_ret_ir = a; }
      }
      if (p.habilita_retencao_inss_nf === 'S') {
        const a = this.numCfg(await cfg('ALIQUOTA_RETENCAO_INSS'));
        if (a > 0) { out.total_ret_inss = r2((totalnf * a) / 100); out.perc_aliquota_ret_inss = a; }
      }
      if (p.habilita_retencao_issqn_nf === 'S') {
        const a = num(p.perc_aliquota_issqn); // ISSQN vem SEMPRE do parceiro (udmNF:3710)
        if (a > 0) { out.total_ret_issqn = r2((totalnf * a) / 100); out.perc_aliquota_ret_issqn = a; }
      }
    }
    // FUNRURAL — gate próprio por CFOP (udmNF:3728), independe de E03.
    if (funruralCfop && p.habilita_retencao_funrural_nf === 'S') {
      const a = this.numCfg(await cfg('ALIQUOTA_RETENCAO_FUNRURAL'));
      if (a > 0) { out.total_ret_funrural = r2((totalnf * a) / 100); out.perc_aliquota_ret_funrural = a; }
    }
    return out;
  }

  /** Config fiscal da EMPRESA (emitente/tenant): UF de origem (MVA ajustado interestadual) + regime
   * (CLASSFISCAL 'LR'/'SN'). Consolidou o stub empresa_fiscal. null se não cadastrada. */
  private async resolverEmpresa(
    emp: number | null,
  ): Promise<{ uf: string | null; classfiscal: string | null; alqsimplesnac: number; figurafiscal: string | null } | null> {
    if (emp == null) return null;
    const ef = await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('empresas')
      .select(['uf', 'classfiscal', 'alqsimplesnac', 'figurafiscal'])
      .where('idempresa', '=', emp)
      .executeTakeFirst();
    if (!ef) return null;
    return {
      uf: ef.uf ? String(ef.uf).toUpperCase() : null,
      classfiscal: ef.classfiscal ? String(ef.classfiscal) : null,
      alqsimplesnac: num(ef.alqsimplesnac), // crédito presumido do Simples na ENTRADA (udmNF.pas:4021)
      figurafiscal: ef.figurafiscal ? String(ef.figurafiscal) : null, // 'D' não consulta / 'O'-'S' consultam
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
    figuraFiscal: string,
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

    // F2c-2: FIGURA FISCAL — quando a empresa é 'O'/'S' (udmNF.pas:6666), resolve a chave MULTI-CAMPO do
    // INDEXADOR (produtos.codfigurafiscal + tp_cadastro + origem/destino + cfop) e sobrepõe o CST pela
    // OPERAÇÃO (udmNF.pas:10096). 'D' (empresa do corte-1) NÃO consulta → segue por alíquota/NCM. A figura
    // dirige CST + ST aqui; o destaque de ICMS próprio (ICME/BCR) por figura é resíduo (precisa golden).
    let figura: any = null;
    if (figuraFiscal === 'O' || figuraFiscal === 'S') {
      const prod = await (this.dbp.forTenantRead() as AnyDB)
        .selectFrom('produtos')
        .select('codfigurafiscal')
        .where('idproduto', '=', Number(it.codproduto))
        .executeTakeFirst();
      if (prod?.codfigurafiscal != null) {
        figura = await this.trib.resolverFigura({
          codfigurafiscal: Number(prod.codfigurafiscal),
          tpCadastro: tipoNota === 'E' ? 'F' : 'C', // entrada 'F' / saída 'C'
          origem: tipoNota === 'E' ? uf : ufOrigem ?? '', // entrada: parceiro→empresa; saída: empresa→parceiro
          destino: tipoNota === 'E' ? ufOrigem ?? '' : uf,
          codcfop: Number(it.cfop),
          ncm: it.ncm != null ? String(it.ncm).trim() : null,
          codparceiro: it.codparceiro != null ? Number(it.codparceiro) : null,
        });
        if (figura) item.cst = figura.cst; // CST pela OPERAÇÃO da figura (sobrepõe o de resolverAtual)
      }
    }

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
    // A FIGURA (F2c-2, quando resolvida) tem PRIORIDADE sobre o caminho por NCM/CFOP_ST (o legado com
    // FIGURAFISCAL='O'/'S' resolve o ST pela figura, não pela lista fixa de CFOPs).
    const cfop = String(it.cfop ?? '');
    const ncm = it.ncm != null ? String(it.ncm).trim() : '';
    let stp: { aliquotaDest: number; icmFonte: number; mva: number; redcom: number; aliquotaFem: number; tpFigura: string } | null = null;
    if (figura) {
      stp = { aliquotaDest: figura.aliquotaDest, icmFonte: figura.icmFonte, mva: figura.mva, redcom: figura.redcom, aliquotaFem: figura.aliquotaFem, tpFigura: figura.tpFigura };
    } else if (NfFiscalService.CFOP_ST.has(cfop) && ncm && !this.bonificacaoSemSt(cfop, a.cst)) {
      stp = await this.trib.resolverIndexador(ncm);
    }
    if (stp && stp.mva > 0) {
      const interstate = !!ufOrigem && ufOrigem !== uf; // UF emitente ≠ destino → MVA ajustado
      const st = this.fiscal.calcularIcmsSt(
        totalProds,
        {
          aliquotaDest: stp.aliquotaDest,
          icmFonte: stp.icmFonte,
          mva: stp.mva,
          redcom: stp.redcom, // redução da BC-ST (default 100 = sem)
          aliquotaFem: stp.aliquotaFem, // FEM no MVA ajustado
          interstate,
          fornecedorSn: stp.tpFigura === 'S', // fornecedor Simples → não ajusta MVA
          // reducaoAliqFonte default 100 (crédito sem redução) — coluna específica adiada.
        },
        'atual',
      );
      item.mva = st.mvaEfetivo; // MVA AJUSTADO (golden: armazena o ajustado)
      item.vrbasest = this.arred(st.baseSt, modo);
      item.vricmst = this.arred(st.icmsSt, modo);
      item.streal = this.arred(st.icmsSt, modo);
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
