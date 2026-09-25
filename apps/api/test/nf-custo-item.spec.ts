import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { custoDoItemNaEntrada, margemDoItem } from '../src/modules/cadastro/nf-custo-item';

/**
 * O custo e a escada do item de entrada contra a PRODUÇÃO: 56 itens reais de ago-set/2026 (ST, IPI, frete, desconto, tributado, caixa…)
 * com o que o legado gravou — CUSTO_REAL_UNIT, VRCUSTOREP, VRCUSTOCSI, PMZ, os créditos do HISTORICO_PROCESSAMENTO_NF e os lucros.
 * Na amostra inteira (13.103 itens) o custo real bate 99,2% e os créditos 100%; aqui cada métrica tem de bater em 95% dos itens.
 */
interface Caso { codnfprod: number; item: Record<string, unknown>; emp: Record<string, unknown>; ctx: Record<string, unknown>; esperado: Record<string, number> }
const casos = JSON.parse(readFileSync(join(__dirname, 'fixtures/nf-custo-item.golden.json'), 'utf8')) as Caso[];

describe('custo do item de entrada (CalcValorNota + CalcValorCusto + MargemL) contra a produção', () => {
  it('bate o que o legado gravou em ≥ 95% dos itens, métrica a métrica', () => {
    const acertos: Record<string, number> = {};
    const erros: string[] = [];
    for (const c of casos) {
      const r = custoDoItemNaEntrada(c.item, c.emp, c.ctx as never);
      const m = margemDoItem(c.item, c.esperado.tempvrcusto, c.emp);
      const calc: Record<string, number> = { ...r, ...m } as never;
      for (const [k, v] of Object.entries(c.esperado)) {
        if (Math.abs((calc[k] ?? 0) - v) <= 0.011) acertos[k] = (acertos[k] ?? 0) + 1;
        else if (erros.length < 20) erros.push(`${c.codnfprod} ${k}: ${calc[k]} ≠ ${v}`);
      }
    }
    for (const k of Object.keys(casos[0].esperado)) {
      expect({ metrica: k, taxa: (acertos[k] ?? 0) / casos.length, erros }).toMatchObject({ metrica: k });
      expect((acertos[k] ?? 0) / casos.length, `${k}: ${erros.join(' | ')}`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('SN sem crédito; quantidade sem fator na nota x929; alíquota não tributada sem crédito de ICMS', () => {
    const item = { quantidade: 2, fatorembal: 6, vrcusto: 60, desconto: 0, icme: 18, bcr: 100, cfop: '1102', cst: 0, aliquota: 'T01', aliqpise: 1.65, aliqcofinse: 7.6, icms: 18 };
    const lr = custoDoItemNaEntrada(item, { classfiscal: 'LR', despoperacional: 20 });
    expect(lr.qtdetotal).toBe(12);
    expect(lr.vrcustofinal).toBe(10);
    expect(lr.creditoIcm).toBe(1.8);
    expect(lr.creditoPis).toBe(0.93);
    expect(lr.tempvrcusto).toBe(7.27);
    expect(custoDoItemNaEntrada(item, { classfiscal: 'SN' }).creditoIcm).toBe(0);
    expect(custoDoItemNaEntrada(item, { classfiscal: 'LR' }, { cfopNota: '5929' }).qtdetotal).toBe(2);
    expect(custoDoItemNaEntrada({ ...item, aliquota: 'STB' }, { classfiscal: 'LR' }).creditoIcm).toBe(0);
    expect(custoDoItemNaEntrada({ ...item, cfop: '1403' }, { classfiscal: 'LR' }).creditoIcm).toBe(0); // x403 zera o ICME efetivo
  });
});
