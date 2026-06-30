import { describe, it, expect } from 'vitest';
import { statusFromCstat } from '../src/nfe-status';

/**
 * Mapeamento cStat→STATUSNFE (espelha GetStatusNFE do legado NFe.pas:2792-2820). Ancorado nos
 * conjuntos verbatim do legado — uma troca de classificação (ex.: 110 deixar de ser denegada)
 * quebra aqui.
 */
describe('statusFromCstat', () => {
  it('autorizada (P): 100/539/204', () => {
    for (const c of [100, 539, 204]) expect(statusFromCstat(c)).toBe('P');
  });
  it('cancelada (C): 101/151/155/218', () => {
    for (const c of [101, 151, 155, 218]) expect(statusFromCstat(c)).toBe('C');
  });
  it('denegada (D): 110/301/302/303', () => {
    for (const c of [110, 301, 302, 303]) expect(statusFromCstat(c)).toBe('D');
  });
  it('inutilizada (I): 102/206/256', () => {
    for (const c of [102, 206, 256]) expect(statusFromCstat(c)).toBe('I');
  });
  it('rejeições/desconhecidos → "" (não autoriza)', () => {
    for (const c of [0, 215, 225, 999]) expect(statusFromCstat(c)).toBe('');
  });
});
