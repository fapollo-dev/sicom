import { createHash } from 'node:crypto';

/**
 * O HASHPAF do preço (`getHASH_MultiPreco`, chamado no `cdsMultiPrecoBeforePost`, udmCadProduto.pas:2286 — a função está em
 * FuncoesApollo, fora do fonte): o MD5, em hex maiúsculo, de IDPRODUTO, IDEMPRESA, VRVENDA e VRCUSTO concatenados, os valores no
 * `CurrToStr` pt-BR (vírgula, sem zeros à direita). Reconstruído do dado: bate em 1.726 de 2.953 preços alterados desde ago/2026; o
 * resto é hash velho — o lote de preço (ajuste de preços) muda o VRVENDA sem refazer o hash, e só o dataset da tela o recalcula. É o
 * selo de integridade do preço que o PAF-ECF confere.
 */
export function hashPaf(idproduto: unknown, idempresa: unknown, vrvenda: unknown, vrcusto: unknown): string {
  const curr = (v: unknown) => {
    const n = v == null || v === '' ? 0 : Number(v);
    return (Number.isFinite(n) ? n : 0).toFixed(4).replace(/\.?0+$/, '').replace('.', ',');
  };
  return createHash('md5').update(`${Number(idproduto)}${Number(idempresa)}${curr(vrvenda)}${curr(vrcusto)}`).digest('hex').toUpperCase();
}

/**
 * O HASHPAF do produto (`getHASH_Produtos`, no `cdsPrincipalBeforePost` do cadastro — UCadProduto.pas:8619-8628; a função está em
 * FuncoesApollo, fora do fonte): o MD5, em hex maiúsculo, de IDPRODUTO, CODBARRA, DESCRICAO, UNIDADE, ALIQUOTA, ATIVO, NCMSH e CEST
 * concatenados (nulo = vazio), com a codificação ASCII do Indy — cada caractere fora do ASCII vira "?" ("PAÇOQUITA" entra como
 * "PA?OQUITA"). Reconstruído do dado: bate com os valores do "Inseriu" da LOG e em 85 de 96 produtos acentuados de 2025-26; os que
 * não batem foram alterados depois por outro caminho (a alíquota trocada para IST, p.ex.), que não refaz o hash — só o gravar da tela.
 */
export function hashProduto(p: { idproduto: unknown; codbarra?: unknown; descricao?: unknown; unidade?: unknown; aliquota?: unknown; ativo?: unknown; ncmsh?: unknown; cest?: unknown }): string {
  const t = (v: unknown) => (v == null ? '' : String(v));
  const texto = `${Number(p.idproduto)}${t(p.codbarra)}${t(p.descricao)}${t(p.unidade)}${t(p.aliquota)}${t(p.ativo)}${t(p.ncmsh)}${t(p.cest)}`;
  const ascii = Array.from(texto, (ch) => (ch.codePointAt(0)! < 128 ? ch : '?')).join('');
  return createHash('md5').update(ascii, 'latin1').digest('hex').toUpperCase();
}
