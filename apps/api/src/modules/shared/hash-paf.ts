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
