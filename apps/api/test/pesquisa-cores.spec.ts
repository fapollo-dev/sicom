import { describe, it, expect } from 'vitest';
import { corDaLinha, regraCasa, type RegraDeCor } from '../src/shared/pesquisa/cores';

describe('as cores da grade da Pesquisa (cdsColoracao + GetColor)', () => {
  const RECEBER: RegraDeCor[] = [
    { coluna: 'quitada', op: '=', valor: 'S', cor: 'VERDE', legenda: 'Liquidada' },
    { coluna: 'dtvenc', op: '<', hoje: true, cor: 'VERMELHO', legenda: 'Vencida' },
  ];
  it('a 1ª regra que casa pinta: liquidada vence a vencida; vencida = vencimento antes de hoje (o dia da loja)', () => {
    expect(corDaLinha(RECEBER, { quitada: 'S', dtvenc: '2026-01-01' }, '2026-10-07')).toBe('VERDE');
    expect(corDaLinha(RECEBER, { quitada: 'N', dtvenc: '2026-10-06' }, '2026-10-07')).toBe('VERMELHO');
    expect(corDaLinha(RECEBER, { quitada: 'N', dtvenc: '2026-10-07' }, '2026-10-07')).toBeNull(); // hoje não é vencida
    expect(corDaLinha(RECEBER, { quitada: 'N', dtvenc: new Date('2026-10-07T02:00:00Z') }, '2026-10-07')).toBe('VERMELHO'); // 23h do dia 6 na loja
  });
  it('NDIAS (a última compra há mais de 35 dias), <> e nulo', () => {
    const r: RegraDeCor = { coluna: 'data_ultima_compra', op: 'ndias', opDias: '>', dias: 35, cor: 'AZUL', legenda: 'x' };
    expect(regraCasa(r, { data_ultima_compra: '2026-09-01' }, '2026-10-07')).toBe(true);
    expect(regraCasa(r, { data_ultima_compra: '2026-09-10' }, '2026-10-07')).toBe(false);
    expect(regraCasa(r, { data_ultima_compra: null }, '2026-10-07')).toBe(false);
    expect(regraCasa({ coluna: 'obs', op: '<>', valor: '', cor: 'FUSHIA', legenda: 'x' }, { obs: 'tem' })).toBe(true);
    expect(regraCasa({ coluna: 'obs', op: '<>', valor: '', cor: 'FUSHIA', legenda: 'x' }, { obs: null })).toBe(false);
    expect(regraCasa({ coluna: 'x', op: 'nulo', cor: 'AZUL', legenda: 'x' }, {})).toBe(true);
  });
});
