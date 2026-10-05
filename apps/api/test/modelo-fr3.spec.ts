import { describe, expect, it } from 'vitest';
import { decodificarFr3, utf8ComLatin1 } from '../src/shared/relatorios/modelo-fr3';

describe('decodificação dos .fr3 da RELATORIOS', () => {
  it('UTF-8 com byte latin1 solto (o FastReport 4 grava o texto do designer em ANSI): a sequência inválida vira o latin1, o resto segue UTF-8', () => {
    const b = Buffer.concat([Buffer.from('PAGAMOS À ', 'utf8'), Buffer.from([0x4c, 0x61, 0x79, 0x6f, 0x75, 0x74, 0x20, 0x69, 0x6d, 0x70, 0x72, 0x65, 0x73, 0x73, 0xe3, 0x6f])]);
    expect(utf8ComLatin1(b)).toBe('PAGAMOS À Layout impressão');
  });
  it('o base64 da RELATORIOS decodifica e perde o BOM; XML cru passa direto', () => {
    expect(decodificarFr3(Buffer.from('﻿<TfrxReport/>', 'utf8').toString('base64'))).toBe('<TfrxReport/>');
    expect(decodificarFr3('<TfrxReport/>')).toBe('<TfrxReport/>');
  });
});
