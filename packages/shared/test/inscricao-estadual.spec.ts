import { describe, it, expect } from 'vitest';
import {
  ieIsenta,
  inscricaoEstadualValida,
} from '../src/validators/inscricao-estadual';

/**
 * Cobertura por UF (≥2 válidas + ≥2 inválidas) para SP, MG, RJ, BA, PR, RS, mais
 * os contornos: ISENTO, vazio e UF desconhecida → válidos. Os valores válidos foram
 * verificados contra os algoritmos oficiais das SEFAZ (alguns são exemplos canônicos
 * publicados: SP 110042490114, MG 0623079040081, PE 032141840, RS 2243658792).
 */

describe('ieIsenta', () => {
  it('reconhece ISENTO/ISENTA (case-insensitive, com espaços)', () => {
    expect(ieIsenta('ISENTO')).toBe(true);
    expect(ieIsenta('isenta')).toBe(true);
    expect(ieIsenta('  Isento  ')).toBe(true);
  });
  it('número comum não é isento', () => {
    expect(ieIsenta('110042490114')).toBe(false);
    expect(ieIsenta('')).toBe(false);
  });
});

describe('inscricaoEstadualValida — contornos', () => {
  it('IE vazia/branca → true (caller decide obrigatoriedade)', () => {
    expect(inscricaoEstadualValida('SP', '')).toBe(true);
    expect(inscricaoEstadualValida('SP', '   ')).toBe(true);
  });
  it('ISENTO → true', () => {
    expect(inscricaoEstadualValida('SP', 'ISENTO')).toBe(true);
    expect(inscricaoEstadualValida('RJ', 'isenta')).toBe(true);
  });
  it('UF desconhecida/vazia → true (sem como checar)', () => {
    expect(inscricaoEstadualValida('', '123456789')).toBe(true);
    expect(inscricaoEstadualValida('XX', '123456789')).toBe(true);
  });
  it('aceita máscara (normaliza dígitos)', () => {
    expect(inscricaoEstadualValida('SP', '110.042.490.114')).toBe(true);
  });
});

describe('inscricaoEstadualValida — SP (12 díg, 2 DV)', () => {
  const validas = ['110042490114', '110042490011', '012345675897'];
  const invalidas = ['110042490115', '110042490010', '12345678', '00000000000X'];
  it.each(validas)('válida %s', (ie) => expect(inscricaoEstadualValida('SP', ie)).toBe(true));
  it.each(invalidas)('inválida %s', (ie) => expect(inscricaoEstadualValida('SP', ie)).toBe(false));
});

describe('inscricaoEstadualValida — MG (13 díg, DV1 especial)', () => {
  const validas = ['0623079040081', '0123456789040'];
  const invalidas = ['0623079040082', '0623079040080', '062307904008'];
  it.each(validas)('válida %s', (ie) => expect(inscricaoEstadualValida('MG', ie)).toBe(true));
  it.each(invalidas)('inválida %s', (ie) => expect(inscricaoEstadualValida('MG', ie)).toBe(false));
});

describe('inscricaoEstadualValida — RJ (8 díg, 1 DV)', () => {
  const validas = ['99999993', '12387652', '08578001'];
  const invalidas = ['99999990', '12387650', '1238765'];
  it.each(validas)('válida %s', (ie) => expect(inscricaoEstadualValida('RJ', ie)).toBe(true));
  it.each(invalidas)('inválida %s', (ie) => expect(inscricaoEstadualValida('RJ', ie)).toBe(false));
});

describe('inscricaoEstadualValida — BA (8/9 díg, mod10|mod11)', () => {
  const validas = ['12345663', '61234557', '079876510', '012345663'];
  const invalidas = ['12345664', '61234550', '079876511', '0123456'];
  it.each(validas)('válida %s', (ie) => expect(inscricaoEstadualValida('BA', ie)).toBe(true));
  it.each(invalidas)('inválida %s', (ie) => expect(inscricaoEstadualValida('BA', ie)).toBe(false));
});

describe('inscricaoEstadualValida — PR (10 díg, 2 DV)', () => {
  const validas = ['1234567850', '9045637570', '0123456742'];
  const invalidas = ['1234567851', '9045637500', '123456785'];
  it.each(validas)('válida %s', (ie) => expect(inscricaoEstadualValida('PR', ie)).toBe(true));
  it.each(invalidas)('inválida %s', (ie) => expect(inscricaoEstadualValida('PR', ie)).toBe(false));
});

describe('inscricaoEstadualValida — RS (10 díg, 1 DV)', () => {
  const validas = ['2243658792', '2240000320', '0340250399'];
  const invalidas = ['2243658790', '2240000321', '224365879'];
  it.each(validas)('válida %s', (ie) => expect(inscricaoEstadualValida('RS', ie)).toBe(true));
  it.each(invalidas)('inválida %s', (ie) => expect(inscricaoEstadualValida('RS', ie)).toBe(false));
});

describe('inscricaoEstadualValida — PE (9 díg, 2 DV) [exemplo canônico]', () => {
  it('válida 032141840', () => expect(inscricaoEstadualValida('PE', '032141840')).toBe(true));
  it('inválida 032141841', () => expect(inscricaoEstadualValida('PE', '032141841')).toBe(false));
});
