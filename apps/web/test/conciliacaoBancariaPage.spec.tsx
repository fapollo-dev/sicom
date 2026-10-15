import { describe, it, expect } from 'vitest';
import { mesCorrente } from '../src/features/conciliacao/ConciliacaoBancariaPage';

describe('Conciliação bancária (UFrmConciliacaoBancaria.dfm) — os períodos', () => {
  it('as duas listas abrem no mês corrente (StartOfTheMonth / EndOfTheMonth), inclusive em fevereiro e no fim do ano', () => {
    expect(mesCorrente(new Date(2026, 9, 15))).toEqual({ movIni: '2026-10-01', movFim: '2026-10-31', ofxIni: '2026-10-01', ofxFim: '2026-10-31' });
    expect(mesCorrente(new Date(2028, 1, 3)).movFim).toBe('2028-02-29');
    expect(mesCorrente(new Date(2026, 11, 31)).ofxFim).toBe('2026-12-31');
  });
});
