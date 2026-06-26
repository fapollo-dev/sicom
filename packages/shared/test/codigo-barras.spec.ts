import { describe, it, expect } from 'vitest';
import {
  dvEan13,
  eanValido,
  gerarCodigoInternoEan13,
  pluBalancaValido,
} from '../src/validators/codigo-barras';

/**
 * Cobertura do validador EAN/GTIN e do gerador de código interno (espelha
 * `CalculaDVCodBarra` / `MontaCodigoBarra` da tela de Produto). Os EANs "válidos"
 * são reais e seus DVs foram conferidos contra o algoritmo GS1 (mod 10):
 *   EAN-13: 7891000100103 (Nescau, DV 3), 7894900011517 (Coca-Cola, DV 7)
 *   EAN-8 : 96385074 (DV 4)
 *   UPC-A : 036000291452 (DV 2)
 *   GTIN-14: 17891000100100 (DV 0)
 */

describe('dvEan13', () => {
  it('calcula o DV dos 12 primeiros dígitos (pesos 3,1 da direita)', () => {
    expect(dvEan13('789100010010')).toBe(3); // → 7891000100103
    expect(dvEan13('789490001151')).toBe(7); // → 7894900011517
  });
  it('usa apenas os 12 primeiros dígitos da base', () => {
    expect(dvEan13('789100010010X' as string)).toBe(3); // normaliza e corta
  });
});

describe('eanValido — válidos', () => {
  it('EAN-13 reais', () => {
    expect(eanValido('7891000100103')).toBe(true); // Nescau
    expect(eanValido('7894900011517')).toBe(true); // Coca-Cola
  });
  it('EAN-8', () => {
    expect(eanValido('96385074')).toBe(true);
  });
  it('UPC-A / EAN-12', () => {
    expect(eanValido('036000291452')).toBe(true);
  });
  it('GTIN-14', () => {
    expect(eanValido('17891000100100')).toBe(true);
  });
});

describe('eanValido — contornos', () => {
  it('vazio/branco → true (caller decide obrigatoriedade)', () => {
    expect(eanValido('')).toBe(true);
    expect(eanValido('   ')).toBe(true);
  });
});

describe('eanValido — inválidos', () => {
  it('DV errado → false', () => {
    expect(eanValido('7891000100104')).toBe(false); // DV correto é 3
    expect(eanValido('7894900011518')).toBe(false); // DV correto é 7
    expect(eanValido('96385075')).toBe(false); // DV correto é 4
  });
  it('comprimento fora de {8,12,13,14} → false', () => {
    expect(eanValido('1234567')).toBe(false); // 7
    expect(eanValido('1234567890')).toBe(false); // 10
    expect(eanValido('123456789012345')).toBe(false); // 15
  });
  it('não-numérico → false', () => {
    expect(eanValido('789100010010A')).toBe(false);
    expect(eanValido('abcdefgh')).toBe(false);
    expect(eanValido('7891000-10103')).toBe(false);
  });
});

describe('gerarCodigoInternoEan13 — espelha MontaCodigoBarra', () => {
  it("gera '7' + 11 dígitos do sequencial + DV (13 dígitos)", () => {
    expect(gerarCodigoInternoEan13(1)).toBe('7000000000010');
    expect(gerarCodigoInternoEan13(42)).toBe('7000000000423');
    expect(gerarCodigoInternoEan13('99999')).toBe('7000000999994');
  });
  it('round-trip: o código gerado é um EAN-13 válido', () => {
    for (const n of [1, 2, 42, 99999, 123456789]) {
      const codigo = gerarCodigoInternoEan13(n);
      expect(codigo).toHaveLength(13);
      expect(eanValido(codigo)).toBe(true);
    }
  });
});

describe('pluBalancaValido', () => {
  it('aceita 1..9999 (1 a 4 dígitos)', () => {
    expect(pluBalancaValido('1')).toBe(true);
    expect(pluBalancaValido('0001')).toBe(true);
    expect(pluBalancaValido('9999')).toBe(true);
  });
  it('rejeita 0, fora de faixa e não-numérico', () => {
    expect(pluBalancaValido('0')).toBe(false);
    expect(pluBalancaValido('0000')).toBe(false);
    expect(pluBalancaValido('10000')).toBe(false);
    expect(pluBalancaValido('')).toBe(false);
    expect(pluBalancaValido('12a')).toBe(false);
  });
});
