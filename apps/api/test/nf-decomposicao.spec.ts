import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decomporItemEntrada, cfopDeSubstituicaoTributaria } from '../src/modules/cadastro/nf-decomposicao';

/**
 * A ENTRADA DECOMPOSTA (`InsereProdutosDaDecomposicao`) contra a PRODUÇÃO: os 95 grupos consistentes das entradas de set/2026 (todos os
 * filhos no cadastro atual, soma 100 e o mesmo número de filhos — 2 grupos ficam fora: o PERNIL que o binário de set/2026 troca pelo
 * produto-pai, §10 do dossiê). Dos 95, 7 são do binário de set/2026 que grava IDPRODUTO_FILHO no PERNIL (o 215 ganhou IDPRODUTO_PAI em
 * 17/09): o custo do PERNIL sai a 4 casas e o TV muda — não portado (instável, "Não determinado" do dossiê); os outros 88 fecham. O pai é apagado pelo legado, mas a quantidade em KG e o valor total saem dos filhos: o ajuste faz
 * Σ Q = QtdKG e Σ round(Q×VRCUSTO, 2) = valor total (644 de 644 NFs de 2026). O ST do pai volta como Σ dos filhos (sem ajuste de sobra).
 */
interface FilhoGravado {
  idproduto: number; descricao: string; percentual: number; vrvenda: number; aliquota: string;
  quantidade: number; vrcusto: string; vrbasest: number; vricmst: number; cfop: number; idproduto_filho?: number;
}
interface Grupo { codnf: number; pai: number; nroitem_decomp: number; calc: string | null; filhos: FilhoGravado[] }
const grupos = JSON.parse(readFileSync(join(__dirname, 'fixtures/nf-decomposicao.golden.json'), 'utf8')) as Grupo[];
const trocaPaiFilho = (g: Grupo) => g.filhos.some((f) => f.idproduto_filho != null);
const r = (x: number, c: number) => Math.round((x + Number.EPSILON) * 10 ** c) / 10 ** c;

function entrada(g: Grupo) {
  const qt = r(g.filhos.reduce((s, f) => s + f.quantidade, 0), 3);
  const tot = r(g.filhos.reduce((s, f) => s + r(f.quantidade * Number(f.vrcusto), 2), 0), 2);
  return {
    qtdTotal: qt, valorTotal: tot, calculoCusto: g.calc, cfop: g.filhos[0].cfop,
    baseSt: r(g.filhos.reduce((s, f) => s + f.vrbasest, 0), 2), icmsSt: r(g.filhos.reduce((s, f) => s + f.vricmst, 0), 2),
    filhos: g.filhos.map(({ idproduto, descricao, percentual, vrvenda, aliquota }) => ({ idproduto, descricao, percentual, vrvenda, aliquota })),
  };
}

describe('entrada decomposta contra a produção (set/2026)', () => {
  it('quantidade e custo de cada filho — o grupo inteiro fecha em todos os grupos fora da troca pai/filho de set/2026', () => {
    let fecham = 0;
    const erros: string[] = [];
    const base = grupos.filter((g) => !trocaPaiFilho(g));
    expect(base.length).toBe(88);
    for (const g of base) {
      const out = decomporItemEntrada(entrada(g));
      const porId = new Map(out.map((f) => [f.idproduto, f]));
      const falhas = g.filhos.filter((f) => {
        const c = porId.get(f.idproduto);
        return !c || Math.abs(c.quantidade - f.quantidade) > 0.0005 || Math.abs(c.vrcusto - Number(f.vrcusto)) > 1e-8;
      });
      if (!falhas.length && out.length === g.filhos.length) fecham++;
      else if (erros.length < 8) erros.push(`NF ${g.codnf} pai ${g.pai}: ${falhas.map((f) => `${f.descricao} ${f.quantidade}/${f.vrcusto} ≠ ${porId.get(f.idproduto)?.quantidade}/${porId.get(f.idproduto)?.vrcusto}`).join('; ')}`);
    }
    expect(fecham, erros.join('\n')).toBe(base.length);
  });

  it('o ajuste cai no 1º filho em ordem de descrição e Σ fecha a quantidade e o valor', () => {
    for (const g of grupos.slice(0, 40)) {
      const e = entrada(g);
      const out = decomporItemEntrada(e);
      expect(r(out.reduce((s, f) => s + f.quantidade, 0), 3)).toBe(e.qtdTotal);
      expect(r(out.reduce((s, f) => s + r(f.quantidade * f.vrcusto, 2), 0), 2)).toBe(e.valorTotal);
      const ordenados = [...out].map((f) => f.descricao);
      expect(ordenados).toEqual([...ordenados].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    }
  });

  it('o ICMS-ST do pai rateado pelo total dos filhos: ±0,01 em ≥ 98% dos filhos com ST', () => {
    let comSt = 0;
    let batem = 0;
    for (const g of grupos) {
      const out = decomporItemEntrada(entrada(g));
      const porId = new Map(out.map((f) => [f.idproduto, f]));
      for (const f of g.filhos) {
        if (!(f.vrbasest > 0)) continue;
        comSt++;
        const c = porId.get(f.idproduto)!;
        if (Math.abs(c.vrbasest - f.vrbasest) <= 0.011 && Math.abs(c.vricmst - f.vricmst) <= 0.011) batem++;
      }
    }
    expect(comSt).toBeGreaterThan(0);
    expect(batem / comSt).toBeGreaterThanOrEqual(0.98);
  });

  it('NF 163219 (DIANTEIRO DE VACA): o ACEM absorve +0,001 kg e −R$ 0,01', () => {
    const g = grupos.find((x) => x.codnf === 163219 && x.pai === 833018)!;
    const out = decomporItemEntrada(entrada(g));
    expect(out[0].descricao.startsWith('ACEM')).toBe(true);
    expect(out[0].quantidade).toBe(51.27);
    expect(out[0].vrcusto).toBeCloseTo(22.615136954, 9);
  });

  it('o rateio (CR) com item de perda total e o valor de venda zero no modo CV', () => {
    const out = decomporItemEntrada({
      qtdTotal: 100, valorTotal: 1000, calculoCusto: 'CR', cfop: 1102, baseSt: 0, icmsSt: 0,
      filhos: [
        { idproduto: 1, descricao: 'A CARNE', percentual: 60, vrvenda: 0 },
        { idproduto: 2, descricao: 'B OSSO', percentual: 30, vrvenda: 0 },
        { idproduto: 3, descricao: 'C PERDA', percentual: 10, vrvenda: 0, percentualPerdas: 100 },
      ],
    });
    // perda = 10% × 1000 = 100, sobre os 90 kg que não são perda = 1,1111/kg → 10 + 1,1111. O teste do ARREDONDA do fonte compara o total
    // do filho com o valor do percentual + a perda POR KG (:10582), então vira 'N' e o total TRUNCA: 666,66 + 333,33 + 0,10 = 1.000,09, e o
    // −0,09 cai no 1º filho: (666,666 − 0,09)/60
    expect(out.map((f) => f.arredonda)).toEqual(['N', 'N', 'N']); // o de perda também: o teste roda antes do 0,01
    expect(out.map((f) => f.vrcusto)).toEqual([expect.closeTo((60 * 11.1111 - 0.09) / 60, 9), 11.1111, 0.01]);
    expect(out[2].item_perda_total).toBe('S');
    expect(() => decomporItemEntrada({
      qtdTotal: 10, valorTotal: 100, calculoCusto: null, cfop: 1102, baseSt: 0, icmsSt: 0,
      filhos: [{ idproduto: 9, codbarra: '0099', descricao: 'X', percentual: 100, vrvenda: 0 }],
    })).toThrow('Produto "0099 - X" com valor de venda zero. Verifique!');
    expect(cfopDeSubstituicaoTributaria(1949, 'STB')).toBe(true);
    expect(cfopDeSubstituicaoTributaria(1949, 'T18')).toBe(false);
  });
});
