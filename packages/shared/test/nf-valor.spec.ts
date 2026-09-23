import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { duasCasas, totalProdutoItem, totaisProdutosNf, percentualDesconto } from '../src/nf-valor';

/**
 * PARIDADE DO VALOR DO ITEM DA NF contra NFs REAIS da produção (Oracle, leitura, 23/09/2026): 36 NFs processadas de
 * jun-set/2026 — entradas, saídas e NFs de cupom (x929), com e sem desconto, com itens `ARREDONDA` 'S' e 'N'.
 * Fecha a INFIDELIDADE-3 do dossiê da NF: o valor unitário é `VRCUSTO`, não `VRVENDA`.
 */
type Item = { quantidade: number; vrcusto: number; vrvenda: number; desconto: number; vrdescprod: number; arredonda: string | null };
type Nf = { codnf: number; tipo: string; cfop: number; totalprod: number; totaldesc: number | null; itens: Item[] };
const golden = JSON.parse(readFileSync(new URL('./nf-valor.golden.json', import.meta.url), 'utf8')) as Nf[];

describe('NF — valor do item (CalcValorNota) contra a produção', () => {
  it('a amostra cobre entrada, saída e cupom, com desconto e com item truncado', () => {
    expect(golden.length).toBeGreaterThanOrEqual(30);
    expect(golden.some((x) => x.tipo === 'E')).toBe(true);
    expect(golden.some((x) => x.tipo === 'S' && String(x.cfop).slice(1) === '929')).toBe(true);
    expect(golden.some((x) => x.tipo === 'S' && String(x.cfop).slice(1) !== '929')).toBe(true);
    expect(golden.some((x) => x.itens.some((i) => (i.vrdescprod ?? 0) !== 0))).toBe(true);
    expect(golden.some((x) => x.itens.some((i) => i.arredonda !== 'S'))).toBe(true);
  });

  for (const nf of golden) {
    it(`NF ${nf.codnf} (${nf.tipo}/${nf.cfop}): TOTALPROD e TOTALDESC`, () => {
      const t = totaisProdutosNf(nf.itens);
      expect(t.totalprod).toBeCloseTo(nf.totalprod, 2);
      expect(t.totaldesc).toBeCloseTo(nf.totaldesc ?? 0, 2);
    });
  }

  it('VRVENDA não é o valor da linha: na saída ele é zero e o total vem do VRCUSTO', () => {
    const saida = golden.find((x) => x.tipo === 'S' && x.itens.every((i) => !i.vrvenda) && x.totalprod > 0)!;
    expect(saida).toBeTruthy();
    expect(totaisProdutosNf(saida.itens).totalprod).toBeCloseTo(saida.totalprod, 2);
  });

  it('trunca sem ARREDONDA e arredonda com ARREDONDA=S; o binário não desloca o centavo', () => {
    expect(totalProdutoItem({ quantidade: 0.332, vrcusto: 30.42, arredonda: 'N' })).toBe(10.09); // 10,09944
    expect(totalProdutoItem({ quantidade: 0.332, vrcusto: 30.42, arredonda: 'S' })).toBe(10.1);
    expect(duasCasas(0.1 * 3, 'T')).toBe(0.3);
    expect(duasCasas(1.005 * 100, 'A')).toBe(100.5);
  });

  it('o percentual de desconto é o que o legado guarda em DESCONTO', () => {
    const it0 = golden.flatMap((x) => x.itens).find((i) => (i.vrdescprod ?? 0) > 0 && (i.desconto ?? 0) > 0)!;
    expect(percentualDesconto(it0)).toBeCloseTo(it0.desconto, 2);
  });
});
