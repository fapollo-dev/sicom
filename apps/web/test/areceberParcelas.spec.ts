import { describe, it, expect } from 'vitest';
import { planejarParcelasAreceber, duplicataAreceber } from '@apollo/shared';

/** o "&Parcelas" do uCadAReceber (btnGeraParcelasClick :700 + NumDuplicataUnicaParcela :3695), conferido com a produção de 2026 */
describe('planejarParcelasAreceber', () => {
  it('N parcelas: total/N com o resíduo na 1ª, vencimento por intervalo, duplicata VAZIA quando a digitada está vazia', () => {
    const p = planejarParcelasAreceber({ total: 100, nrodup: 3, venc1: '2026-07-10', intervalo: 30 });
    expect(p.map((x) => x.valor)).toEqual([33.34, 33.33, 33.33]);
    expect(p.map((x) => x.dtvenc)).toEqual(['2026-07-10', '2026-08-09', '2026-09-08']);
    expect(p.map((x) => x.duplicata)).toEqual([null, null, null]);
  });

  it('dia fixo (sem intervalo): mensal no dia do 1º vencimento (clampando) ou no "Dia de Venc."; a digitada vira "<NF - > 001/00N" com o espaço do FormatFloat', () => {
    expect(planejarParcelasAreceber({ total: 90, nrodup: 3, venc1: '2026-01-31' }).map((x) => x.dtvenc)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(planejarParcelasAreceber({ total: 90, nrodup: 2, venc1: '2026-01-31', diaFixo: 12 }).map((x) => x.dtvenc)).toEqual(['2026-01-12', '2026-02-12']);
    expect(planejarParcelasAreceber({ total: 90, nrodup: 2, venc1: '2026-01-31', duplicata: 'X', docnf: '744' }).map((x) => x.duplicata)).toEqual(['744 -  001/002', '744 -  002/002']);
    expect(planejarParcelasAreceber({ total: 90, nrodup: 2, venc1: '2026-01-31', duplicata: 'X' }).map((x) => x.duplicata)).toEqual([' 001/002', ' 002/002']);
  });

  it('parcela única: a duplicata digitada fica; vazia vira "<NF> - 001/001" (produção: "744 - 001/001"; sem NF " - 001/001")', () => {
    expect(duplicataAreceber(1, 1, '', '744')).toBe('744 - 001/001');
    expect(duplicataAreceber(1, 1, '', null)).toBe(' - 001/001');
    expect(duplicataAreceber(1, 1, 'FL25012026', '744')).toBe('FL25012026');
    expect(planejarParcelasAreceber({ total: 350.51, nrodup: 1, venc1: '2026-10-12', docnf: 744 })[0]).toEqual({ duplicata: '744 - 001/001', dtvenc: '2026-10-12', valor: 350.51 });
  });

  it('as validações: total obrigatório, limite de 200, total insuficiente', () => {
    expect(() => planejarParcelasAreceber({ total: 0, nrodup: 2, venc1: '2026-01-31' })).toThrow('ARECEBER_TOTAL_OBRIGATORIO');
    expect(() => planejarParcelasAreceber({ total: 10, nrodup: 201, venc1: '2026-01-31' })).toThrow('ARECEBER_PARCELAS_LIMITE');
    expect(() => planejarParcelasAreceber({ total: 0.02, nrodup: 3, venc1: '2026-01-31' })).toThrow('PARCELA_VALOR_INSUFICIENTE');
  });
});
