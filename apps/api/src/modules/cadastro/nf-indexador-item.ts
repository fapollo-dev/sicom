/**
 * O INDEXADOR TRIBUTÁRIO e o REPASSE do item de ENTRADA — o que o diálogo do item faz ao escolher o produto e no OK
 * (`TfrmItensNF.CarregaIndexadorTributario`, uItensNF.pas:786-1004; REPASSADO no OK, :1839-1856), e a análise automática da importação
 * (recon `scratchpad/recon-indexador`, conferido com a produção):
 *  - a consulta só roda com a empresa em FIGURAFISCAL 'O'/'S', fornecedor que não é livre de indexador (PARCEIROS.RETIRA_FORNINDEX),
 *    sem pedido de devolução e com a NF não liberada (NF.LIBERA_NF_INDEXADOR) — R1;
 *  - achou (R4): CST pela operação, ICME = ICM_FONTE (ou a alíquota reduzida da Lei 3166), BCR = REDUÇÃO, MVA do indexador, INDEXADORTRIB
 *    e o MVA AJUSTADO pela fórmula do TIndexadorTributario (uIndexadorTributario.pas:259-285) — CST 97-98%, ICME 97-98%, BCR 96%, MVA 99,3%,
 *    MVA ajustado 99,4% nos itens de 2026;
 *  - não achou (R5): INDEXADORTRIB 0 e o MVA do produto; o resto fica o da nota;
 *  - REPASSADO (R8): 'S' com indexador, fornecedor livre ou NF de devolução (finalidade 4); sem eles 'N' em FIGURAFISCAL 'O' e 'S' em 'S';
 *    fora da consulta (FIGURAFISCAL 'D' ou NF liberada) 'S' — 100% dos itens analisados desde 2025.
 * O ST EXTERNO da entrada (`stExternoDoItem`, R7) — o `RecalculaICMSST` (uItensNF.pas:3369-3486) sobre o `TIndexadorTributario`.
 * As travas do processamento são os próximos cortes.
 */
import { TributacaoRepository } from '../precificacao/tributacao.repository';

type AnyDB = any;
const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};
const roundTo = (v: number, casas: number) => Math.round((v + Number.EPSILON) * 10 ** casas) / 10 ** casas;

export interface ContextoIndexadorNf {
  tipo: 'E' | 'S';
  figuraFiscal: string;
  ufLoja: string;
  ufParceiro: string;
  codparceiro: number | null;
  fornecedorLivre: boolean;
  liberada: boolean;
  pedidoDevolucao: boolean;
  finalidade: string;
}

/** o contexto da nota para o indexador (lido uma vez por gravação) — entrada e saída */
export async function contextoIndexadorNf(trx: AnyDB, codnf: number): Promise<ContextoIndexadorNf | null> {
  const nf = (await trx.selectFrom('nf as n')
    .leftJoin('empresas as e', 'e.idempresa', 'n.idempresa')
    .leftJoin('parceiros_end as pe', 'pe.codend', 'n.codparceiro_end')
    .leftJoin('parceiros as p', 'p.codparceiro', 'n.codparceiro')
    .select(['n.tipo', 'n.codparceiro', 'n.libera_nf_indexador', 'n.cod_ped_dev_compra', 'n.finalidade', 'e.figurafiscal', 'e.uf as uf_loja', 'pe.uf as uf_parceiro', 'p.retira_fornindex'])
    .where('n.codnf', '=', codnf).executeTakeFirst()) as Record<string, unknown> | undefined;
  if (!nf || !['E', 'S'].includes(String(nf.tipo))) return null;
  const figuraFiscal = String(nf.figurafiscal ?? 'D').trim().toUpperCase();
  const liberada = String(nf.libera_nf_indexador ?? '') === 'S';
  // o fornecedor só é lido fora de 'D' e com a NF não liberada; nos outros casos é tratado como livre (uItensNF.pas:3862-3877)
  const fornecedorLivre = figuraFiscal === 'D' || liberada ? true : String(nf.retira_fornindex ?? '') === 'S';
  return {
    tipo: String(nf.tipo) as 'E' | 'S', figuraFiscal, liberada, fornecedorLivre,
    ufLoja: String(nf.uf_loja ?? '').trim().toUpperCase(),
    ufParceiro: String(nf.uf_parceiro ?? '').trim().toUpperCase(),
    codparceiro: nf.codparceiro != null ? Number(nf.codparceiro) : null,
    pedidoDevolucao: n(nf.cod_ped_dev_compra) > 0,
    finalidade: String(nf.finalidade ?? '').trim(),
  };
}

/** o MVA ajustado do TIndexadorTributario: interestadual e fornecedor não-SN; senão o próprio MVA (3 casas) */
export function mvaAjustado(mva: number, icmFonte: number, aliquota: number, fem: number, interestadual: boolean, fornecedorSn: boolean): number {
  if (mva === 0) return 0;
  if (!interestadual || fornecedorSn) return mva;
  const den = (aliquota - fem) / 100 - 1;
  if (den === 0) return mva;
  return roundTo((((mva / 100 + 1) * (icmFonte / 100 - 1)) / den - 1) * 100, 3);
}

/** o que o item recebe do indexador; `null` nos campos que ficam como estão */
export async function indexadorDoItem(trx: AnyDB, ctx: ContextoIndexadorNf, it: Record<string, unknown>, trib: TributacaoRepository): Promise<Record<string, unknown>> {
  const idp = Number(it.codproduto);
  const prod = (await trx.selectFrom('produtos').select(['codfigurafiscal', 'codbarra', 'ncmsh', 'mva']).where('idproduto', '=', idp).executeTakeFirst()) as
    Record<string, unknown> | undefined;
  const saida = ctx.tipo === 'S';
  // a NF gerada pela devolução de compra não passa pelo diálogo (REPASSADO nulo em 69 de 75 itens 5411 da loja 2 em 2026)
  if (saida && ctx.pedidoDevolucao) return {};
  const consulta = (ctx.figuraFiscal === 'O' || ctx.figuraFiscal === 'S') && !ctx.fornecedorLivre && !ctx.pedidoDevolucao && !ctx.liberada;
  // a saída consulta o indexador de tipo C, da loja para o destinatário (uItensNF.pas:808-822)
  const figura = consulta && prod?.codfigurafiscal != null
    ? await trib.resolverFigura({
      codfigurafiscal: Number(prod.codfigurafiscal), tpCadastro: saida ? 'C' : 'F', origem: saida ? ctx.ufLoja : ctx.ufParceiro, destino: saida ? ctx.ufParceiro : ctx.ufLoja,
      codcfop: Number(it.cfop),
      codbarra: prod.codbarra != null ? String(prod.codbarra).trim() : null, ncm: prod.ncmsh != null ? String(prod.ncmsh).trim() : null, codparceiro: ctx.codparceiro,
    }, trx)
    : null;
  const out: Record<string, unknown> = {};
  if (saida) {
    // na saída, CST/alíquota/base/MVA do indexador são do recálculo fiscal (nf-fiscal.service, a mesma figura); aqui o que o OK grava
    out.indexadortrib = figura ? figura.codindexadortributario : 0;
    if (figura) out.mva_ajustado = mvaAjustado(figura.mva, figura.icmFonte, figura.aliquotaDest, figura.aliquotaFem, ctx.ufParceiro !== ctx.ufLoja, figura.tpFigura === 'S');
  } else if (figura) {
    const operacoes: Record<string, number> = { T: 0, R: 20, C: 10, F: 60, S: 50, D: 51, I: 40, N: 90, Y: 41, Z: 70, '': 0 };
    if (figura.operacao in operacoes) out.cst = operacoes[figura.operacao];
    out.icme = figura.lei3166 ? figura.aliquotaReduzidaLei3166 : figura.icmFonte;
    out.bcr = figura.reducao;
    out.mva = figura.mva;
    out.indexadortrib = figura.codindexadortributario;
    out.mva_ajustado = mvaAjustado(figura.mva, figura.icmFonte, figura.aliquotaDest, figura.aliquotaFem, ctx.ufParceiro !== ctx.ufLoja, figura.tpFigura === 'S');
  } else {
    out.indexadortrib = 0;
    out.mva = n(prod?.mva);
  }
  // o REPASSADO do OK do item (uItensNF.pas:1839-1856)
  if (ctx.figuraFiscal !== 'D' && !ctx.liberada) {
    out.repassado = n(out.indexadortrib) > 0 || ctx.fornecedorLivre || ctx.finalidade === '4' ? 'S' : ctx.figuraFiscal === 'O' ? 'N' : 'S';
  } else {
    out.repassado = 'S';
  }
  return out;
}

export interface ParametrosIndexador {
  vrProduto: number; // TOTALPRODS + TOTALDESCPROD (o produto antes do desconto)
  vrDesconto: number;
  vrIpi: number;
  vrOutrasDesp: number; // DEPSACESS + VRSEGURO
  vrFrete: number;
  vrIcmsStNota: number;
  vrBcStNota: number;
  reducaoBcSt: number; // REDCOM literal (NULL = 0 zera a base, como o legado)
  mva: number;
  aliquota: number; // ALIQUOTA (a de destino)
  aliquotaFonte: number; // ICM_FONTE
  aliquotaFem: number;
  reducaoAliquotaFonte: number; // REDUCAO
  lei3166: boolean;
  aliqFonteLei3166: number;
  fornecedorSimples: boolean; // TP_FIGURA = 'S'
  cfop: number;
  icmsComFrete: boolean; // GERAICM_FRETE
  cst: number;
  ufOrigem: string;
  ufDestino: string;
  considerarDesconto: boolean;
}

const CFOPS_ST = ['1403', '2403', '1401', '2401', '1407', '2407', '1411', '2411', '5403', '6403', '1949', '2949', '5411', '6411', '5202', '6202',
  '1910', '2910', '1911', '2911', '1902', '2902', '1124', '1923', '2923', '1406', '2406'];

/**
 * O `TIndexadorTributario` (uIndexadorTributario.pas) — base e ICMS-ST calculados e o ST A RECOLHER da entrada: débito (BCST × alíquota)
 * − crédito (produto − desconto, × redução, × ICM_FONTE; + frete com GERAICM_FRETE; Lei 3166) − o ST da nota, zerado entre −0,02 e 0,01
 * (sem piso em zero: 140 negativos em 2026). BCST = (produto + IPI + despesas + frete [− desconto com CONSIDERAR_DESCONTO]) × REDCOM ×
 * (1 + MVA ajustado); a da nota vale se encosta (0,01999).
 */
export function calculoIndexador(p: ParametrosIndexador): { calcularSt: boolean; bcStCalculada: number; icmsStCalculado: number; icmsStRecolher: number } {
  let calcularSt = CFOPS_ST.includes(String(p.cfop));
  if (['1910', '2910', '1911', '2911', '1902', '2902'].includes(String(p.cfop)) && ![10, 70, 60].includes(p.cst)) calcularSt = false;
  if (calcularSt) calcularSt = p.mva !== 0;
  const mvaAj = mvaAjustado(p.mva, p.aliquotaFonte, p.aliquota, p.aliquotaFem, p.ufOrigem !== p.ufDestino, p.fornecedorSimples);
  const total = p.vrProduto + p.vrIpi + p.vrOutrasDesp + p.vrFrete - (p.considerarDesconto ? p.vrDesconto : 0);
  const bcReduzida = (total * p.reducaoBcSt) / 100;
  let bcStCalculada = calcularSt ? bcReduzida + (bcReduzida * mvaAj) / 100 : 0;
  if (p.vrBcStNota > 0 && Math.abs(bcStCalculada - p.vrBcStNota) <= 0.01999) bcStCalculada = p.vrBcStNota;
  let creditoNota = ((p.vrProduto - p.vrDesconto) * p.reducaoAliquotaFonte) / 100 * (p.aliquotaFonte / 100);
  if (p.icmsComFrete) creditoNota += (p.vrFrete * p.aliquotaFonte) / 100;
  const aliqLei = p.lei3166 ? p.aliqFonteLei3166 : 0;
  const credito = p.lei3166 ? (p.ufOrigem === 'ES' ? (creditoNota * aliqLei) / 100 : (p.vrProduto * aliqLei) / 100) : creditoNota;
  const debito = (bcStCalculada * p.aliquota) / 100;
  let recolher = 0;
  let calculado = 0;
  if (calcularSt) {
    if (p.fornecedorSimples) {
      calculado = debito - credito;
      recolher = calculado - p.vrIcmsStNota;
    } else {
      recolher = debito - credito - p.vrIcmsStNota;
    }
    if (recolher >= -0.02 && recolher <= 0.01) recolher = 0;
    if (!p.fornecedorSimples) calculado = p.vrIcmsStNota + recolher;
  }
  return { calcularSt, bcStCalculada, icmsStCalculado: calculado, icmsStRecolher: recolher };
}

const arred2 = (x: number): number => (Math.floor(Math.abs(x) * 100 + 0.5 + 1e-9) / 100) * (x < 0 ? -1 : 1);
const trunca2 = (x: number): number => (Math.floor(Math.abs(x) * 100 + 1e-9) / 100) * (x < 0 ? -1 : 1);

/** a linha do indexador que o ST usa (os valores crus: o legado lê NULL como 0) */
export interface FiguraSt {
  aliquota_dest?: unknown; icm_fonte?: unknown; redcom?: unknown; mva?: unknown; aliquota_fem?: unknown; reducao?: unknown;
  aliquota_reduzida_lei_3166?: unknown; aliquota_fonte_lei_3166?: unknown; tp_figura?: unknown; codcfop?: unknown; st_externo?: unknown;
  considerar_desconto_calc_st?: unknown; origem?: unknown; destino?: unknown;
}

export interface ContextoStExterno {
  figuraFiscal: string;
  liberada: boolean;
  fornecedorLivre: boolean;
  importada: boolean;
  tipoemissao: string;
  /** CALCULA_ICMSST_EMISSAOPROPRIA_NF_SEM_INDEX (produção 'N') */
  calculaSemIndexador: boolean;
  rateio: string;
  rateioSt: string;
  /** TOTALBASEICMT, TOTALICM_ST e TOTALPRODST do cabeçalho (as ConstICMST/ConstVRICMST do NewRecord, udmNF.pas:4786-4800) */
  totalBaseIcmt: number;
  totalIcmSt: number;
  totalProdSt: number;
}

/** o item com os valores do CalcValorNota (TOTALPRODS, TOTALDESCPROD, VRIPI, VRFRETE, VRSEGURO) e o produto (MVA, ALIQOPE_INTERNA) */
export interface ItemSt {
  totalprods: number; totaldescprod: number; vripi: number; vrfrete: number; vrseguro: number; depsacess: number;
  vricmst: number; vrbasest: number; vricm: number; cfop: string; cst: number; geraicmFrete: boolean; mva: number; arredonda: boolean;
  mvaProduto: number; aliqopeInterna: number;
}

export interface StExternoItem {
  vrbasest?: number; vricmst?: number; streal?: number; vrbase_stexterno?: number; vricms_stexterno?: number; vricms_stexterno_separadonf?: number;
}

const CFOPS_TEMP_ST = ['1403', '2403', '1401', '2401', '1406', '2406', '1407', '2407', '1411', '2411', '1902', '2902', '1923', '2923', '1910', '2910',
  '5403', '6403', '5411', '6411', '5202', '6202', '1949', '2949', '1124'];

/**
 * O TEMPVRBASEST/TEMPVRICMST do `CalcValorNota` (udmNF.pas:4027-4125) no caso em que ele é lido — sem indexador (fornecedor livre, loja 'D'):
 * com MVA no item e sem ST no cabeçalho, (produtos + frete + IPI + acessórias + seguro) × (1 + MVA) e o ICMS pela ALIQOPE_INTERNA − o
 * ICMS próprio; senão, com o ST do cabeçalho e sem rateio, a proporção dele (TOTALBASEICMT/TOTALICM_ST sobre TOTALPRODST).
 */
export function stTempDoItem(it: ItemSt, ctx: ContextoStExterno): { base: number; valor: number } {
  if (!CFOPS_TEMP_ST.includes(it.cfop)) return { base: 0, valor: 0 };
  const constIcmst = ctx.totalBaseIcmt > 0 && ctx.totalProdSt > 0 ? (ctx.totalBaseIcmt / ctx.totalProdSt) * 100 : 0;
  const constVrIcmst = ctx.totalBaseIcmt > 0 && ctx.totalProdSt > 0 ? (ctx.totalIcmSt / ctx.totalProdSt) * 100 : 0;
  if (it.mva > 0 && constIcmst === 0 && !ctx.liberada) {
    const total = it.totalprods + it.vrfrete + it.vripi + it.depsacess + it.vrseguro;
    const base = total + (total * it.mva) / 100;
    if (it.aliqopeInterna <= 0) return { base: 0, valor: 0 };
    return { base, valor: (it.arredonda ? arred2 : trunca2)((base * it.aliqopeInterna) / 100 - it.vricm) };
  }
  if (it.totalprods > 0 && ctx.rateio === 'N' && ctx.rateioSt === 'N' && constIcmst > 0) {
    return { base: (it.totalprods * constIcmst) / 100, valor: (it.totalprods * constVrIcmst) / 100 };
  }
  return { base: 0, valor: 0 };
}

/**
 * O `RecalculaICMSST` da ENTRADA (uItensNF.pas:3371-3450) — conferido com os itens de entrada de 2026 da produção: com indexador,
 * STREAL/VRBASE_STEXTERNO/VRICMS_STEXTERNO 100% nos 357 itens digitados e 98,2% nos 44.685 importados; fornecedor livre importado (ST da
 * nota) 99,1%; loja 'D' de terceiros importada 98,7%.
 *  - loja 'O'/'S' e NF não liberada:
 *    · emissão própria (TIPOEMISSAO 0), indexador com ST_EXTERNO, CFOP 1403/2403, MVA > 0, não importada: zera a ST da nota e grava o
 *      calculado como ST externo SEPARADO da NF;
 *    · fornecedor livre: MVA/ALIQOPE_INTERNA do produto e não importada → os TEMP do CalcValorNota; senão o ST externo é o da nota;
 *    · com indexador: STREAL = ST calculado, VRBASE_STEXTERNO = BC-ST calculada, VRICMS_STEXTERNO = a recolher;
 *    · sem indexador: o legado usa o que sobrou do item anterior no objeto (`InicializarVariaveis` não limpa a ST da nota) — o item fica
 *      como está (a importação guarda o ST da nota, 72 de 72);
 *  - loja 'D' ou NF liberada: só terceiros (TIPOEMISSAO 1) ou a config — os TEMP (produto com MVA, não importada) ou o ST da nota;
 *  - e o OK do item por cima: nota digitada de emissão própria na loja 'D' fica com o ST da nota.
 */
export function stExternoDoItem(it: ItemSt, fig: FiguraSt | null, ctx: ContextoStExterno): StExternoItem {
  const r = recalculaIcmsSt(it, fig, ctx);
  // o OK do item (uItensNF.pas:1815-1823): nota digitada de emissão própria na loja 'D' — o ST externo é o da nota
  if (ctx.figuraFiscal === 'D' && !ctx.importada && ctx.tipoemissao === '0') {
    return { ...r, streal: r.vricmst ?? it.vricmst, vrbase_stexterno: r.vrbasest ?? it.vrbasest, vricms_stexterno: 0, vricms_stexterno_separadonf: 0 };
  }
  return r;
}

function recalculaIcmsSt(it: ItemSt, fig: FiguraSt | null, ctx: ContextoStExterno): StExternoItem {
  const temp = (): StExternoItem => {
    const t = stTempDoItem(it, ctx);
    return { vrbasest: arred2(t.base), vricmst: arred2(t.valor), streal: arred2(t.valor), vrbase_stexterno: arred2(t.base) };
  };
  const daNota: StExternoItem = { streal: it.vricmst, vrbase_stexterno: it.vrbasest, vricms_stexterno: 0, vricms_stexterno_separadonf: 0 };
  const usaTemp = (it.mvaProduto > 0 || it.aliqopeInterna > 0) && !ctx.importada;
  if (ctx.figuraFiscal !== 'D' && !ctx.liberada) {
    const c = fig ? calculoIndexador(parametrosDaFigura(it, fig)) : null;
    if (fig && c && ctx.tipoemissao === '0' && String(fig.st_externo ?? '') === 'S' && ['1403', '2403'].includes(it.cfop) && n(fig.mva) > 0 && !ctx.importada) {
      const sep = arred2(c.icmsStCalculado);
      return { vrbasest: 0, vricmst: 0, streal: 0, vrbase_stexterno: 0, vricms_stexterno: sep, vricms_stexterno_separadonf: sep };
    }
    if (ctx.fornecedorLivre) return usaTemp ? temp() : daNota;
    if (!fig || !c) return {};
    return { streal: arred2(c.icmsStCalculado), vrbase_stexterno: arred2(c.bcStCalculada), vricms_stexterno: arred2(c.icmsStRecolher), vricms_stexterno_separadonf: 0 };
  }
  if (ctx.tipoemissao === '1' || ctx.calculaSemIndexador) return usaTemp ? temp() : daNota;
  return {};
}

/** os parâmetros do `SetParametros` (uItensNF.pas:964-990): o produto antes do desconto, IPI, acessórias + seguro, frete e a ST da nota */
function parametrosDaFigura(it: ItemSt, fig: FiguraSt): ParametrosIndexador {
  return {
    vrProduto: it.totalprods + it.totaldescprod, vrDesconto: it.totaldescprod, vrIpi: it.vripi, vrOutrasDesp: it.depsacess + it.vrseguro, vrFrete: it.vrfrete,
    vrIcmsStNota: it.vricmst, vrBcStNota: it.vrbasest, reducaoBcSt: n(fig.redcom), mva: n(fig.mva), aliquota: n(fig.aliquota_dest), aliquotaFonte: n(fig.icm_fonte),
    aliquotaFem: n(fig.aliquota_fem), reducaoAliquotaFonte: n(fig.reducao), lei3166: String(fig.aliquota_fonte_lei_3166 ?? '') === 'S',
    aliqFonteLei3166: n(fig.aliquota_reduzida_lei_3166), fornecedorSimples: String(fig.tp_figura ?? '') === 'S', cfop: n(fig.codcfop), icmsComFrete: it.geraicmFrete,
    cst: it.cst, ufOrigem: String(fig.origem ?? '').trim().toUpperCase(), ufDestino: String(fig.destino ?? '').trim().toUpperCase(),
    considerarDesconto: String(fig.considerar_desconto_calc_st ?? '') === 'S',
  };
}
