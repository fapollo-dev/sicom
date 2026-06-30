import { describe, it, expect } from 'vitest';
import { chaveNfeValida, dvChaveNfe, montarChaveNfe } from '../src/validators/chave-nfe';

/**
 * Cobertura da chave de acesso NFe (44 díg + DV mód 11) — F6. Como o legado delega
 * ao ACBr, validamos a regra oficial por consistência: `montarChaveNfe` produz uma
 * chave válida (ida-e-volta com `chaveNfeValida`), e qualquer mutação (DV trocado,
 * comprimento errado, caractere não-numérico) reprova.
 */

const comp = {
  cuf: 31, // MG
  aamm: '2406', // 2024-06
  cnpj: '03923857000155',
  modelo: 55,
  serie: 1,
  numero: 101,
  tpEmis: 1,
  cnf: 12345678,
};

describe('montarChaveNfe', () => {
  it('produz uma chave de 44 dígitos com os campos zero-padded na ordem correta', () => {
    const chave = montarChaveNfe(comp);
    expect(chave).toHaveLength(44);
    expect(/^\d{44}$/.test(chave)).toBe(true);
    expect(chave.slice(0, 2)).toBe('31'); // cUF
    expect(chave.slice(2, 6)).toBe('2406'); // AAMM
    expect(chave.slice(6, 20)).toBe('03923857000155'); // CNPJ
    expect(chave.slice(20, 22)).toBe('55'); // modelo
    expect(chave.slice(22, 25)).toBe('001'); // série (3)
    expect(chave.slice(25, 34)).toBe('000000101'); // nNF (9)
    expect(chave.slice(34, 35)).toBe('1'); // tpEmis
    expect(chave.slice(35, 43)).toBe('12345678'); // cNF (8)
  });

  it('a chave gerada é sempre válida (ida-e-volta)', () => {
    expect(chaveNfeValida(montarChaveNfe(comp))).toBe(true);
    expect(chaveNfeValida(montarChaveNfe({ ...comp, numero: 999999999 }))).toBe(true);
    expect(chaveNfeValida(montarChaveNfe({ ...comp, serie: 0, cnf: 0 }))).toBe(true);
  });
});

describe('dvChaveNfe', () => {
  it('retorna um dígito 0..9 para uma base de 43 dígitos', () => {
    const base43 = montarChaveNfe(comp).slice(0, 43);
    const dv = dvChaveNfe(base43);
    expect(dv).toBeGreaterThanOrEqual(0);
    expect(dv).toBeLessThanOrEqual(9);
    expect(String(dv)).toBe(montarChaveNfe(comp).slice(43)); // confere com o anexado
  });

  it('retorna -1 se a base não tiver 43 dígitos', () => {
    expect(dvChaveNfe('123')).toBe(-1);
    expect(dvChaveNfe('1'.repeat(44))).toBe(-1);
  });

  it('vetor GOLDEN congelado (pega regressão de direção/peso que a ida-e-volta não pega)', () => {
    // base43 = cUF 31 | AAMM 2406 | CNPJ 03923857000155 | mod 55 | série 001 | nNF 000000101 | tpEmis 1 | cNF 12345678
    // DV oficial mód 11 (pesos 2..9 direita→esquerda) = 3 → chave completa termina em ...3.
    expect(dvChaveNfe('3124060392385700015555001000000101112345678')).toBe(3);
    expect(chaveNfeValida('31240603923857000155550010000001011123456783')).toBe(true);
  });

  it('chaves REAIS de produção (golden Oracle PINHEIRAO) — ancora o DV em dados reais', () => {
    // capturadas do legado (NF.CHAVENFE, autorizadas); DV conferido (5000/5000 passam no golden).
    expect(chaveNfeValida('31200866312653000114550010005599791528020227')).toBe(true); // CODNF 2222, DV 7
    expect(chaveNfeValida('31200861586558000608550030030145361815729057')).toBe(true); // CODNF 2246, DV 7
    expect(chaveNfeValida('31200837954975000169550010000000041045077624')).toBe(true); // CODNF 2248, DV 4
  });
});

describe('chaveNfeValida', () => {
  it('reprova chave com DV incorreto', () => {
    const chave = montarChaveNfe(comp);
    const dvErrado = (Number(chave[43]) + 1) % 10;
    const corrompida = chave.slice(0, 43) + String(dvErrado);
    expect(chaveNfeValida(corrompida)).toBe(false);
  });

  it('reprova comprimento ≠ 44', () => {
    const chave = montarChaveNfe(comp);
    expect(chaveNfeValida(chave.slice(0, 43))).toBe(false); // 43
    expect(chaveNfeValida(chave + '0')).toBe(false); // 45
  });

  it('reprova caractere não-numérico', () => {
    const chave = montarChaveNfe(comp);
    expect(chaveNfeValida('NFe' + chave)).toBe(false);
    expect(chaveNfeValida(chave.slice(0, 43) + 'X')).toBe(false);
  });

  it('tolera vazio/branco (campo opcional)', () => {
    expect(chaveNfeValida('')).toBe(true);
    expect(chaveNfeValida('   ')).toBe(true);
  });
});
