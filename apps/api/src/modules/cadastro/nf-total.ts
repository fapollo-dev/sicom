/**
 * O TOTAL DA NOTA do legado (`cdsNotaCalcFields`, udmNF.pas:5548-5566): produtos + frete + seguro + acessórias + IPI + IPI devolvido
 * + ICMS-ST + FCP-ST + serviço + outros + (desconto final − desconto) − ICMS desonerado; a nota COMPLEMENTAR soma só IPI + ICMS-ST.
 * Prova: 98,7% das notas de 2026 fecham com ela (a conta sem FCP-ST e desonerado fechava 93% — 451 notas com FCP-ST, 92 com desonerado).
 * `parcela(k)` devolve o valor do cabeçalho (do dto ou da nota gravada); produtos, desconto, IPI e ST vêm somados dos itens.
 */
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function totalNfLegado(itens: { totalprod: number; totaldesc: number; totalipi: number; totalicm_st: number }, parcela: (k: string) => unknown): number {
  if (String(parcela('complemento') ?? '').toUpperCase() === 'S') return r2(itens.totalipi + itens.totalicm_st);
  return r2(itens.totalprod + num(parcela('totalfrete')) + num(parcela('totalseguro')) + num(parcela('totalacessorias')) + itens.totalipi
    + num(parcela('totalipi_devolucao')) + itens.totalicm_st + num(parcela('total_fcp_valor_st')) + num(parcela('valorservico'))
    + num(parcela('totalvroutros')) + num(parcela('totaldescfinal')) - itens.totaldesc - num(parcela('total_icmsdeson')));
}
