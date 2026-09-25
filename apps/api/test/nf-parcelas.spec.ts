import { describe, expect, it } from 'vitest';
import { buildParcelas, duplicataDaParcela, modalidadeDaParcela, proximoMes } from '../src/modules/cadastro/nf-parcelas';

/**
 * O BuildParcelas (FuncoesApollo, fora do fonte) reconstruído do dado de produção — FATURAMENTO gerada pela tela da NF
 * (CODOPERADOR nulo), lida em 25/09/2026. Cada caso abaixo é uma nota real.
 */
describe('parcelas da nota (BuildParcelas)', () => {
  it('NF 162943: 443,19 em 10, dia fixo 28 → 9 × 44,32 + 44,31, mês a mês, sem empurrar fim de semana', () => {
    const p = buildParcelas({ valor: 443.19, numParcelas: 10, intervalo: 0, vencimento: '2026-09-28', diaVenc: 28, tipo: 'D' });
    expect(p.map((x) => x.valor)).toEqual([44.32, 44.32, 44.32, 44.32, 44.32, 44.32, 44.32, 44.32, 44.32, 44.31]);
    expect(p.map((x) => x.data)).toEqual([
      '2026-09-28', '2026-10-28', '2026-11-28', '2026-12-28', '2027-01-28', '2027-02-28', '2027-03-28', '2027-04-28', '2027-05-28', '2027-06-28',
    ]);
  });

  it('NF 161411: 3.235,74 em 10 → 9 × 323,57 + 323,61 (a sobra toda na última)', () => {
    const p = buildParcelas({ valor: 3235.74, numParcelas: 10, intervalo: 0, vencimento: '2026-09-12', diaVenc: 12, tipo: 'D' });
    expect(p.slice(0, 9).every((x) => x.valor === 323.57)).toBe(true);
    expect(p[9].valor).toBe(323.61);
    expect(Math.round(p.reduce((s, x) => s + x.valor, 0) * 100) / 100).toBe(3235.74);
  });

  it('NF 162379: 370,00 em 3 → 123,33 + 123,33 + 123,34', () => {
    expect(buildParcelas({ valor: 370, numParcelas: 3, intervalo: 0, vencimento: '2026-09-20', diaVenc: 20, tipo: 'D' }).map((x) => x.valor)).toEqual([123.33, 123.33, 123.34]);
  });

  it('NF 116598: intervalo de 30 dias corridos a partir de 28/02 → 30/03, 29/04', () => {
    expect(buildParcelas({ valor: 90, numParcelas: 3, intervalo: 30, vencimento: '2025-02-28', tipo: 'I' }).map((x) => x.data)).toEqual(['2025-02-28', '2025-03-30', '2025-04-29']);
  });

  it('dia fixo que o mês não tem vira o último dia (31 → 28/02, 31/03, 30/04)', () => {
    expect(buildParcelas({ valor: 30, numParcelas: 4, intervalo: 0, vencimento: '2030-01-31', diaVenc: 31, tipo: 'D' }).map((x) => x.data)).toEqual(['2030-01-31', '2030-02-28', '2030-03-31', '2030-04-30']);
  });

  it('0 ou negativo parcelas vira 1 (edtNumePar <= 0 → 1)', () => {
    expect(buildParcelas({ valor: 12.5, numParcelas: 0, intervalo: 30, vencimento: '2030-01-10', tipo: 'I' })).toEqual([{ data: '2030-01-10', valor: 12.5 }]);
  });

  it('IncMonth: próximo mês limitado ao último dia', () => {
    expect(proximoMes('2026-01-31')).toBe('2026-02-28');
    expect(proximoMes('2026-12-15')).toBe('2027-01-15');
  });

  it('DUPLICATA: modelo 1 = <nº><sep><aa><sep><letra> ou vazia; modelo 2 = <NRONF><sep><i+1>, salvo CHEQUE', () => {
    expect(duplicataDaParcela({ modelo: 1, separador: '', nroDup: 1081, nronf: '10952', i: 1, hoje: '2026-09-25' })).toBe('108126B');
    expect(duplicataDaParcela({ modelo: 1, separador: '/', nroDup: 7, nronf: '10952', i: 0, hoje: '2026-09-25' })).toBe('7/26/A');
    expect(duplicataDaParcela({ modelo: 1, separador: '', nroDup: null, nronf: '10952', i: 0, hoje: '2026-09-25' })).toBeNull();
    expect(duplicataDaParcela({ modelo: 2, separador: '/', nronf: '83', i: 0, hoje: '2026-09-25' })).toBe('83/1');
    expect(duplicataDaParcela({ modelo: 2, separador: '/', nronf: '83', i: 0, hoje: '2026-09-25', tipodocPedido: 'CHEQUE' })).toBeNull();
  });

  it('MODALIDADE: entrada A PAGAR; saída A RECEBER, ou o TIPODOC do vencimento do pedido no modelo 2', () => {
    expect(modalidadeDaParcela('E', 2, 'CHEQUE')).toBe('A PAGAR');
    expect(modalidadeDaParcela('S', 1, 'CHEQUE')).toBe('A RECEBER');
    expect(modalidadeDaParcela('S', 2, 'CHEQUE')).toBe('CHEQUE');
    expect(modalidadeDaParcela('S', 2, '')).toBe('A RECEBER');
  });
});
