import { describe, it, expect } from 'vitest';
import { PrecoService } from '../src/modules/precificacao/preco.service';

/**
 * Paridade de CÁLCULO (não CRUD) — espelha TMargemPreco do legado.
 * Prova as duas fórmulas (markup vs margem), o round-trip, as guardas e a
 * "pegadinha" do playbook: mesmos inputs → resultados DIFERENTES por modo.
 */
const s = new PrecoService();

describe('PrecoService — regra extraída de TMargemPreco (modos D/M)', () => {
  it("Modo 'D' (markup sobre custo): custo 10, margem 30% → venda 13,00", () => {
    expect(s.calcularValorVenda(10, 30, 'D')).toBeCloseTo(13.0, 2);
  });
  it("Modo 'D' round-trip: venda 13, custo 10 → margem 30%", () => {
    expect(s.calcularMargem(13, 10, 'D')).toBeCloseTo(30, 2);
  });
  it("Modo 'M' (margem sobre venda): custo 7, margem 30% → venda 10,00", () => {
    expect(s.calcularValorVenda(7, 30, 'M')).toBeCloseTo(10.0, 2);
  });
  it("Modo 'M' round-trip: venda 10, custo 7 → margem 30%", () => {
    expect(s.calcularMargem(10, 7, 'M')).toBeCloseTo(30, 2);
  });

  it('PEGADINHA do playbook: mesmos inputs, modos diferentes → preços diferentes', () => {
    const d = s.calcularValorVenda(10, 30, 'D'); // 13,00 (markup)
    const m = s.calcularValorVenda(10, 30, 'M'); // 14,29 (margem)
    expect(d).toBeCloseTo(13.0, 2);
    expect(m).toBeCloseTo(14.29, 2);
    expect(d).not.toBeCloseTo(m, 2);
  });

  it('Guardas de divisão por zero (fiel ao legado)', () => {
    expect(s.calcularMargem(13, 0, 'D')).toBe(0); // custo 0 → 0
    expect(s.calcularMargem(0, 10, 'M')).toBe(0); // venda 0 → 0
    expect(s.calcularValorVenda(0, 30, 'D')).toBe(0); // custo 0 → 0
    expect(() => s.calcularValorVenda(10, 100, 'M')).toThrow('MARGEM_INVALIDA'); // (100-100)=0
  });
});
