/**
 * O VALOR DO ITEM DA NF — o `CalcValorNota` do legado (udmNF.pas:3928), na parte que decide o total dos produtos.
 *
 * O valor unitário da linha é `VRCUSTO` (entrada e saída); `VRVENDA` é o PREÇO DE VENDA que a precificação sugere na
 * entrada e fica zerado na saída. O total da linha é `QUANTIDADE × VRCUSTO` (o `VRCUSTO` é por embalagem:
 * `QTDETOTAL × VRCUSTO / FATOREMBAL`), com 2 casas — ARREDONDADO quando o item tem `ARREDONDA='S'` e TRUNCADO quando
 * não (`TruncarArredondar(…, 'A'|'T', 2)`, :3996). O desconto não entra no total dos produtos: vai para `TOTALDESC`,
 * que é a soma do `VRDESCPROD` (dinheiro); `DESCONTO` guarda o percentual equivalente.
 *
 * Prova (produção, NFs de 2026 não canceladas): 6.449 de 6.449 entradas, 375 de 375 NFs de cupom e 374 de 378 saídas
 * (as 4 são rascunhos com total 0); golden de 36 NFs reais em `test/nf-valor.golden.json`.
 */

export interface ItemValorNf {
  quantidade?: unknown;
  vrcusto?: unknown;
  vrdescprod?: unknown;
  arredonda?: unknown;
}

const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

/** 2 casas: arredonda (meio para cima, como o `RoundTo` do Delphi sobre moeda) ou trunca em direção ao zero */
export function duasCasas(v: number, modo: 'A' | 'T'): number {
  // o épsilon protege do binário (0,1 × 3 = 0,30000000000000004 não pode virar 0,31 nem 0,29)
  const c = v * 100;
  const e = 1e-7;
  if (modo === 'A') return Math.sign(c) * Math.floor(Math.abs(c) + 0.5 + e) / 100;
  return Math.sign(c) * Math.floor(Math.abs(c) + e) / 100;
}

/** o total da linha (TOTALPRODS): quantidade × valor unitário, arredondado ou truncado conforme o item */
export function totalProdutoItem(it: ItemValorNf): number {
  return duasCasas(n(it.quantidade) * n(it.vrcusto), String(it.arredonda ?? '').toUpperCase() === 'S' ? 'A' : 'T');
}

/**
 * a BASE da linha para os impostos (o `TOTALPRODS` do item no `CalcValorNota`): o total líquido do desconto em dinheiro
 * — `QUANTIDADE × VRCUSTO − VRDESCPROD`, com o mesmo arredondar/truncar. Produção: a base do ICMS dos itens com desconto
 * de 2026 sai líquida em 39 de 39.
 */
export function baseProdutoItem(it: ItemValorNf): number {
  return duasCasas(n(it.quantidade) * n(it.vrcusto) - n(it.vrdescprod), String(it.arredonda ?? '').toUpperCase() === 'S' ? 'A' : 'T');
}

/** o percentual de desconto que o legado guarda em `DESCONTO`, a partir do desconto em dinheiro */
export function percentualDesconto(it: ItemValorNf): number {
  const bruto = n(it.quantidade) * n(it.vrcusto);
  return bruto > 0 ? (n(it.vrdescprod) / bruto) * 100 : 0;
}

/** os totais de produtos e de desconto da nota (TOTALPROD / TOTALDESC) */
export function totaisProdutosNf(itens: ItemValorNf[]): { totalprod: number; totaldesc: number } {
  let prod = 0;
  let desc = 0;
  for (const it of itens) {
    prod += totalProdutoItem(it);
    desc += n(it.vrdescprod);
  }
  return { totalprod: duasCasas(prod, 'A'), totaldesc: duasCasas(desc, 'A') };
}
