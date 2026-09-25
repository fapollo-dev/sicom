/**
 * O ITEM DA NF IMPORTADA DO XML como o `TNFe.ImportaNFe` o monta (NFe.pas:3734-4208) — as regras que o dado de produção confirma
 * (itens de entrada importados de 2026, só leitura):
 *  - FATOREMBAL: 1; o FATORCX do produto quando > 0; com a unidade do XML 'KG', o FATORKG quando > 0 (:3950-3962); por cima, o fator do
 *    item no MANIFESTO (`GetFatorEmbalagemManifesto`, :3964 — fora do fonte; o dado: NFE_NAO_CADASTRADAS_ITENS.FATOREMBAL da chave e do
 *    produto, 93,4% iguais; sem manifesto, o do produto em 94,7%). O Apollo gravava 1 — metade dos itens (caixas) entrava com a
 *    quantidade errada no estoque;
 *  - CODPRODNOTA = o CODBARRA do produto (:3936; 99,8%), não o código do fornecedor;
 *  - UNIDADE = a do XML, sem acento e sem caractere especial, e 'UN' quando passa de 2 letras (:4021);
 *  - ALIQPISE/S e ALIQCOFINSE/S = as do PISCOFINS do produto (:3967-3977); a base e os valores do XML só com a alíquota do cadastro > 0
 *    (:4086-4097);
 *  - ICMS = o ICM_EFETIVO da DET_ALIQUOTA (alíquota do produto, UF da loja) — 99,9% —, ou o pICMS; produto sem alíquota: a da
 *    DET_ALIQUOTA com esse ICM efetivo (:4114-4145); ICME = pICMS; BCR = vBC / (vProd − vDesc) (:4148-4151);
 *  - IPI (%) = vIPI / (vProd − vDesc), SEGURO (%) idem, DEPSACESS = vOutro (:4037-4054, :4078); o FRETE, no binário novo, é a fatia do frete
 *    total da nota (vFrete do item / vFrete da nota — VRFRETE = TOTALFRETE × FRETE, 267 de 267 em 2026);
 *  - NCM/CEST: com ATUALIZAR_NCMCEST_PRODUTO_XMLNFE='S' os do XML (senão os do produto); com 'N' (a produção) os do produto quando
 *    há, senão os do XML (:3979-4014);
 *  - remessa para depósito (CFOP da nota 5906/1906/1905): CST 90, CSOSN 400, alíquota NTB (:4201-4206).
 * Os valores DA NOTA (os `*_NOTA`, CFOP_ORIGINAL, MVA_AJUSTADO = pMVAST, VRBASE_STEXTERNO, FCP-ST/retido, desonerado, crédito do SN,
 * IPI devolvido, a base e os valores de PIS/COFINS) não passam pela tela: saem em `extras`, gravados no item depois de criado.
 * Ficam como o Apollo já fazia (o dado não segue o fonte de 2020, ou é a análise do item que decide): ARREDONDA (a config), CST/CSOSN
 * e CSTPISCOFINS.
 */
import type { NfeItemParsed } from './nfe-xml.parser';

export interface ProdutoImportacao {
  codbarra?: string | null;
  unidade?: string | null;
  fatorcx?: unknown;
  fatorkg?: unknown;
  ncmsh?: string | null;
  cest?: string | null;
  pis?: string | null;
  aliquota?: string | null;
  origemprod?: string | null;
  aliq_pis_ent?: unknown;
  aliq_pis_sai?: unknown;
  aliq_cofins_ent?: unknown;
  aliq_cofins_sai?: unknown;
  tem_piscofins?: boolean;
}

export interface ContextoItemImportacao {
  /** o ICM_EFETIVO da DET_ALIQUOTA para a alíquota do produto na UF da loja (null: não há linha) */
  icmEfetivo: number | null;
  /** a alíquota da DET_ALIQUOTA da UF com ICM efetivo = pICMS (para o produto sem alíquota) */
  aliquotaPeloIcms: string | null;
  /** o fator do item no manifesto da chave (NFE_NAO_CADASTRADAS_ITENS), quando > 0 */
  fatorManifesto: number | null;
  atualizarNcmCest: boolean;
  remessaDeposito: boolean;
  vrvenda: number;
  cfop: string;
  /** o vFrete TOTAL da nota (ICMSTot) — o FRETE do item é a fatia dele */
  freteTotalNota: number;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** a unidade do XML como o legado a grava: sem acento, só letras e dígitos, maiúscula; mais de 2 → 'UN' */
export function unidadeDoXml(uCom?: string | null): string | undefined {
  const limpa = String(uCom ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!limpa) return undefined;
  return limpa.length > 2 ? 'UN' : limpa;
}

/** o fator de embalagem do item importado */
export function fatorDoItemImportado(prod: ProdutoImportacao, unidade: string | undefined, fatorManifesto: number | null): number {
  let fator = 1;
  if (n(prod.fatorcx) > 0) fator = n(prod.fatorcx);
  if (unidade === 'KG' && n(prod.fatorkg) > 0) fator = n(prod.fatorkg);
  if (fatorManifesto != null && fatorManifesto > 0) fator = fatorManifesto;
  return fator;
}

const pct = (valor: number, base: number): number | undefined => (base > 0 ? (valor * 100) / base : undefined);
const vazio = (s: string | null | undefined): string | undefined => (s == null || String(s).trim() === '' ? undefined : String(s).trim());

export function itemImportado(
  it: NfeItemParsed, idproduto: number, prod: ProdutoImportacao, ctx: ContextoItemImportacao,
): { item: Record<string, unknown>; extras: Record<string, unknown> } {
  const unidade = unidadeDoXml(it.uCom) ?? vazio(prod.unidade)?.slice(0, 2);
  const totalProduto = it.vProd - it.vDesc;
  const aliqPisE = prod.tem_piscofins ? n(prod.aliq_pis_ent) : 0;
  const aliqCofinsE = prod.tem_piscofins ? n(prod.aliq_cofins_ent) : 0;
  let aliquota = vazio(prod.aliquota);
  let icms: number | undefined;
  if (aliquota) icms = ctx.icmEfetivo ?? it.pICMS;
  else if (ctx.aliquotaPeloIcms) { aliquota = ctx.aliquotaPeloIcms; icms = it.pICMS; }
  const ncmCest = ctx.atualizarNcmCest
    ? { ncm: vazio(it.ncm) ?? vazio(prod.ncmsh), cest: vazio(it.cest) ?? vazio(prod.cest) }
    : vazio(prod.ncmsh) || vazio(prod.cest)
      ? { ncm: vazio(prod.ncmsh), cest: vazio(prod.cest) }
      : { ncm: vazio(it.ncm), cest: vazio(it.cest) };
  const item: Record<string, unknown> = {
    nroitem: it.nItem,
    codproduto: idproduto,
    codprodnota: vazio(prod.codbarra),
    quantidade: it.qCom,
    fatorembal: fatorDoItemImportado(prod, unidade, ctx.fatorManifesto),
    unidade,
    vrvenda: ctx.vrvenda,
    vrcusto: it.vUnCom,
    vrcustoreal: it.vUnCom,
    vrdescprod: it.vDesc || undefined,
    cfop: ctx.cfop,
    ncm: ncmCest.ncm,
    cest: ncmCest.cest,
    aliquota,
    icms,
    icme: it.pICMS,
    bcr: pct(it.vBC, totalProduto),
    cst: it.cst != null ? Number(it.cst) : undefined,
    csosn: it.csosn ?? undefined,
    vrbasecalculo: it.vBC,
    vricm: it.vICMS,
    vrbasest: it.vBCST,
    vricmst: it.vICMSST,
    streal: it.vICMSST,
    ipi: pct(it.vIPI, totalProduto),
    vripi: it.vIPI,
    // o FRETE é a FATIA do frete da nota (VRFRETE = TOTALFRETE × FRETE / 100, 267 de 267 em 2026), não % do valor do item
    frete: ctx.freteTotalNota > 0 ? Math.round((it.vFrete / ctx.freteTotalNota) * 100 * 1e6) / 1e6 : undefined,
    seguro: pct(it.vSeg, totalProduto),
    depsacess: it.vOutro,
    pis: vazio(prod.pis),
    cstpiscofins: it.cstPisCofins ?? undefined,
    aliqpise: aliqPisE,
    aliqpiss: prod.tem_piscofins ? n(prod.aliq_pis_sai) : 0,
    aliqcofinse: aliqCofinsE,
    aliqcofinss: prod.tem_piscofins ? n(prod.aliq_cofins_sai) : 0,
    // GERAESTOQUE/MOVIMENTA_ESTOQUE saem do PROC_QTDE do CFOP do item no processar (a importação não decide); ORIGEM_ESTOQUE é o
    // DEFAULT 'E' (100% na produção — o SPED não o usa mais para o CST)
  };
  if (ctx.remessaDeposito) Object.assign(item, { cst: 90, csosn: '400', aliquota: 'NTB' });
  const extras: Record<string, unknown> = {
    total_produto_nota: it.vProd,
    qtd_nota: it.qCom,
    cfop_original: Number(it.cfopXml) || null,
    frete_nota: totalProduto > 0 ? it.vFrete : 0,
    seguro_nota: totalProduto > 0 ? it.vSeg : 0,
    desconto_nota: it.vUnCom > 0 ? it.vDesc : 0,
    outras_despesas_nota: it.vOutro,
    ipi_nota: totalProduto > 0 ? it.vIPI : 0,
    ipi_devolucao: pct(it.vIPIDevol, totalProduto) ?? 0,
    ipi_devolucao_nota: totalProduto > 0 ? it.vIPIDevol : 0,
    ipi_devolucao_perc_devol: totalProduto > 0 ? it.pDevol : 0,
    cst_nota: Number(it.csosn ?? it.cst ?? 0) || 0,
    vrcredsn: it.csosn ? it.vCredICMSSN : 0,
    aliqcredsn: it.csosn ? it.pCredSN : 0,
    icms_aliq_nota: it.pICMS,
    icms_red_bc_nota: it.pRedBC,
    icms_st_aliq_nota: it.pICMSST,
    icms_st_red_bc_nota: it.pRedBCST,
    mva_ajustado: it.pMVAST,
    icms_nota_valor: it.vICMS,
    icms_nota_bc: it.vBC,
    vrbase_stexterno: it.vBCST,
    fcp_bc_st: it.vBCFCPST,
    fcp_aliquota_st: it.pFCPST,
    fcp_valor_st: it.vFCPST,
    fcp_bc_st_ret: it.vBCFCPSTRet,
    fcp_aliquota_st_ret: it.pFCPSTRet,
    fcp_valor_st_ret: it.vFCPSTRet,
    vricms_desonerado: it.vICMSDeson,
    // a base e os valores de PIS/COFINS do XML, só com a alíquota do cadastro > 0 (:4086-4097)
    bcpiscofinse: aliqPisE > 0 ? it.vBcPisCofins : 0,
    vrpise: aliqPisE > 0 ? it.vPIS : 0,
    vrcofinse: aliqCofinsE > 0 ? it.vCOFINS : 0,
  };
  return { item, extras };
}
