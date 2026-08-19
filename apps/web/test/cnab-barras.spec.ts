import { describe, expect, it } from 'vitest';
import { codigoBarrasItf, svgCodigoBarras } from '../src/features/cnab/codigoBarrasItf';

/** ITF 2 de 5 do boleto: a estrutura é verificável sem leitor — start/stop, pares e "2 largos em cada 5". */
describe('código de barras ITF do boleto', () => {
  const codigo = '34191098200000160348109000657060303423055100';

  it('exige 44 dígitos', () => {
    expect(() => codigoBarrasItf('123')).toThrow();
    expect(() => codigoBarrasItf(codigo + '1')).toThrow();
  });

  it('start estreito + 22 pares (10 elementos cada) + stop', () => {
    const els = codigoBarrasItf(codigo.slice(0, 44));
    expect(els).toHaveLength(4 + 22 * 10 + 3);
    expect(els.slice(0, 4).every((e) => e.largura === 1)).toBe(true);
    expect(els[0].barra).toBe(true);
    expect(els[1].barra).toBe(false);
    const stop = els.slice(-3);
    expect(stop.map((e) => `${e.barra ? 'b' : 'e'}${e.largura}`)).toEqual(['b3', 'e1', 'b1']);
  });

  it('cada grupo de 5 barras (e de 5 espaços) tem exatamente 2 largos — a regra do 2 de 5', () => {
    const els = codigoBarrasItf(codigo.slice(0, 44));
    const corpo = els.slice(4, els.length - 3);
    for (let i = 0; i < corpo.length; i += 10) {
      const grupo = corpo.slice(i, i + 10);
      const barras = grupo.filter((e) => e.barra);
      const espacos = grupo.filter((e) => !e.barra);
      expect(barras).toHaveLength(5);
      expect(espacos).toHaveLength(5);
      expect(barras.filter((e) => e.largura === 3)).toHaveLength(2);
      expect(espacos.filter((e) => e.largura === 3)).toHaveLength(2);
    }
  });

  it('barras e espaços se alternam do início ao fim (nenhum elemento repetido)', () => {
    const els = codigoBarrasItf(codigo.slice(0, 44));
    for (let i = 1; i < els.length; i++) expect(els[i].barra).not.toBe(els[i - 1].barra);
  });

  it('svg tem largura proporcional aos módulos e só desenha as barras', () => {
    const svg = svgCodigoBarras(codigo.slice(0, 44));
    const els = codigoBarrasItf(codigo.slice(0, 44));
    const modulos = els.reduce((s, e) => s + e.largura, 0);
    expect(svg).toContain(`width="${(modulos * 1.2).toFixed(2)}"`);
    expect((svg.match(/<rect/g) ?? []).length).toBe(els.filter((e) => e.barra).length);
  });
});
