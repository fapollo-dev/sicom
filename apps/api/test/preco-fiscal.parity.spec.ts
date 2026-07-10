import { describe, it, expect } from 'vitest';
import {
  FiscalPricingService,
  type TabelaTributaria,
} from '../src/modules/precificacao/preco-fiscal.service';

const s = new FiscalPricingService();

// Regime ATUAL (ICMS por dentro) — fiel ao gross-up de TMargemPreco.
const ATUAIS = {
  icmsEfetivo: 18,
  fcp: 0,
  pis: 1.65,
  cofins: 7.6,
  despOperacional: 0,
  modoMargem: 'liquido' as const,
};
// Reforma (IBS+CBS por fora). Alíquotas ilustrativas com vigência/fonte (parametrizável).
const REFORMA = { ibs: 17.7, cbs: 8.8 };

describe('FiscalPricingService — regime atual × reforma tributária (EC 132/2023)', () => {
  it('ATUAL: imposto "por dentro" (custo 10, margem 30, ICMS 18, PIS 1,65, COFINS 7,6) → ~23,39', () => {
    // fator=(1-(0.0165+0.076+0.18))*100=72.75 ; venda=1000/(72.75-30)=23.39
    expect(s.precoAtual(10, 30, ATUAIS)).toBeCloseTo(23.39, 2);
  });

  it('ATUAL + Simples Nacional zera ICMS/FCP → ~16,46', () => {
    expect(s.precoAtual(10, 30, { ...ATUAIS, simplesNacional: true })).toBeCloseTo(16.46, 2);
  });

  it('REFORMA: IBS+CBS "por fora" (base custo+margem, imposto sobre a base) → ~16,45', () => {
    // base=10*1.3=13 ; venda=13*(1+0.265)=16.45
    expect(s.precoReforma(10, 30, REFORMA)).toBeCloseTo(16.45, 2);
  });

  it('TRANSIÇÃO 2026: regime atual + IBS 0,1% / CBS 0,9% por fora (acréscimo de 1%)', () => {
    // 23.39 * 1.01 = 23.62
    expect(s.precoTransicao(10, 30, ATUAIS, { ibs: 0.1, cbs: 0.9 })).toBeCloseTo(23.62, 2);
  });

  it('mesma cesta, regimes diferentes → preços diferentes (por dentro × por fora)', () => {
    expect(s.precoAtual(10, 30, ATUAIS)).not.toBeCloseTo(s.precoReforma(10, 30, REFORMA), 1);
  });

  it('dispatcher calcular() escolhe o regime pela TabelaTributaria (pinável por vigência/fonte)', () => {
    const tabAtual: TabelaTributaria = {
      regime: 'atual',
      vigenciaInicio: '2025-01-01',
      fonte: 'RICMS/UF + Lei 10.833 (PIS/COFINS)',
      atuais: ATUAIS,
    };
    const tabTransicao: TabelaTributaria = {
      regime: 'transicao',
      vigenciaInicio: '2026-01-01',
      fonte: 'EC 132/2023 + LC 214/2025 (fase-teste 2026)',
      atuais: ATUAIS,
      reforma: { ibs: 0.1, cbs: 0.9 },
    };
    expect(s.calcular(10, 30, tabAtual)).toBeCloseTo(23.39, 2);
    expect(s.calcular(10, 30, tabTransicao)).toBeCloseTo(23.62, 2);
  });

  it('guardas: custo 0 → 0; margem que zera o denominador → erro tipado', () => {
    expect(s.calcular(0, 30, { regime: 'atual', vigenciaInicio: '', fonte: '', atuais: ATUAIS })).toBe(0);
    // denom = fator(72.75) - margem(72.75) = 0
    expect(() => s.precoAtual(10, 72.75, ATUAIS)).toThrow('MARGEM_INVALIDA');
  });
});

// Motor completo (corte precificação): custo líquido + PMZ + margem líquida (uPrecificacaoProdutos.pas).
describe('FiscalPricingService — custo líquido / PMZ / margem líquida', () => {
  it('custoLiquido: (custo + ST + IPI) − créditos (10+2+1 − 1,8 − 0,5 = 10,70)', () => {
    expect(s.custoLiquido(10)).toBe(10);
    expect(s.custoLiquido(10, { st: 2, ipi: 1, creditoIcms: 1.8, creditoPis: 0.5 })).toBeCloseTo(10.7, 2);
  });

  it('PMZ = custoFinal / (1 − saídas%/100): 10 / (1 − (1,65+7,6+18+20)/100) → ~18,96', () => {
    // saídas = 47,25% → PMZ = 10 / 0,5275 = 18,96
    expect(s.pmz(10, { pis: 1.65, cofins: 7.6, icms: 18, despOperacional: 20 })).toBeCloseTo(18.96, 2);
    // só ICMS 18% → 10 / 0,82 = 12,20
    expect(s.pmz(10, { pis: 0, cofins: 0, icms: 18, despOperacional: 0 })).toBeCloseTo(12.2, 2);
    expect(s.pmz(0, { pis: 0, cofins: 0, icms: 18, despOperacional: 0 })).toBe(0);
  });

  it('PMZ: saídas ≥ 100% (não-precificável) → erro tipado', () => {
    expect(() => s.pmz(10, { pis: 50, cofins: 50, icms: 10, despOperacional: 0 })).toThrow('PMZ_SAIDAS_INVALIDAS');
  });

  it('margemLiquida: IR/CSLL sobre o lucro APÓS despesa (dbtLucroL) — venda 25, custo líq 10', () => {
    const m = s.margemLiquida(25, 10, { pis: 1.65, cofins: 7.6, icms: 18, despOperacional: 20, irpj: 15, csll: 9 });
    // vendaLiq 18,19; lucroBruto 8,19; despesa 5; lucroApósDespesa 3,19; IR=3,19×15%=0,48; CSLL=3,19×9%=0,29;
    // lucroLíq = 3,19−0,48−0,29 = 2,42; margem = 2,42/25 = 9,68%.
    expect(m.vendaLiquida).toBeCloseTo(18.19, 2);
    expect(m.lucroBruto).toBeCloseTo(8.19, 2);
    expect(m.despesa).toBeCloseTo(5, 2);
    expect(m.irpj).toBeCloseTo(0.48, 2);
    expect(m.csll).toBeCloseTo(0.29, 2);
    expect(m.lucroLiquido).toBeCloseTo(2.42, 2);
    expect(m.margemLiquida).toBeCloseTo(9.68, 2);
  });

  it('margemLiquida: venda 0 → tudo zero (guarda)', () => {
    const m = s.margemLiquida(0, 10, { pis: 1.65, cofins: 7.6, icms: 18, despOperacional: 20 });
    expect(m).toEqual({ vendaLiquida: 0, lucroBruto: 0, despesa: 0, irpj: 0, csll: 0, lucroLiquido: 0, margemLiquida: 0 });
  });
});
