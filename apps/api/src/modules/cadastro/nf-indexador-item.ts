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
 * O ST externo da entrada (VRICMS_STEXTERNO/VRBASE_STEXTERNO pelo indexador, R7) e as travas do processamento são os próximos cortes.
 */
import { TributacaoRepository } from '../precificacao/tributacao.repository';

type AnyDB = any;
const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};
const roundTo = (v: number, casas: number) => Math.round((v + Number.EPSILON) * 10 ** casas) / 10 ** casas;

export interface ContextoIndexadorNf {
  figuraFiscal: string;
  ufLoja: string;
  ufParceiro: string;
  codparceiro: number | null;
  fornecedorLivre: boolean;
  liberada: boolean;
  pedidoDevolucao: boolean;
  finalidade: string;
}

/** o contexto da nota para o indexador (lido uma vez por gravação) */
export async function contextoIndexadorNf(trx: AnyDB, codnf: number): Promise<ContextoIndexadorNf | null> {
  const nf = (await trx.selectFrom('nf as n')
    .leftJoin('empresas as e', 'e.idempresa', 'n.idempresa')
    .leftJoin('parceiros_end as pe', 'pe.codend', 'n.codparceiro_end')
    .leftJoin('parceiros as p', 'p.codparceiro', 'n.codparceiro')
    .select(['n.tipo', 'n.codparceiro', 'n.libera_nf_indexador', 'n.cod_ped_dev_compra', 'n.finalidade', 'e.figurafiscal', 'e.uf as uf_loja', 'pe.uf as uf_parceiro', 'p.retira_fornindex'])
    .where('n.codnf', '=', codnf).executeTakeFirst()) as Record<string, unknown> | undefined;
  if (!nf || String(nf.tipo) !== 'E') return null;
  const figuraFiscal = String(nf.figurafiscal ?? 'D').trim().toUpperCase();
  const liberada = String(nf.libera_nf_indexador ?? '') === 'S';
  // o fornecedor só é lido fora de 'D' e com a NF não liberada; nos outros casos é tratado como livre (uItensNF.pas:3862-3877)
  const fornecedorLivre = figuraFiscal === 'D' || liberada ? true : String(nf.retira_fornindex ?? '') === 'S';
  return {
    figuraFiscal, liberada, fornecedorLivre,
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
  const consulta = (ctx.figuraFiscal === 'O' || ctx.figuraFiscal === 'S') && !ctx.fornecedorLivre && !ctx.pedidoDevolucao && !ctx.liberada;
  const figura = consulta && prod?.codfigurafiscal != null
    ? await trib.resolverFigura({
      codfigurafiscal: Number(prod.codfigurafiscal), tpCadastro: 'F', origem: ctx.ufParceiro, destino: ctx.ufLoja, codcfop: Number(it.cfop),
      codbarra: prod.codbarra != null ? String(prod.codbarra).trim() : null, ncm: prod.ncmsh != null ? String(prod.ncmsh).trim() : null, codparceiro: ctx.codparceiro,
    }, trx)
    : null;
  const out: Record<string, unknown> = {};
  if (figura) {
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
