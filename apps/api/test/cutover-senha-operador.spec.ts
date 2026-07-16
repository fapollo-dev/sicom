import { describe, it, expect } from 'vitest';
import { cutoverSenhasOperador, type RawOperadorSenha } from '../scripts/cutover/senha-operador';
import { encodeSenhaLegado, verificarSenha } from '../src/shared/auth/crypto';

/**
 * CUTOVER das 157 senhas de OPERADOR — motor (decode César +13 fixo + classificação + re-hash). Cobre: senha limpa
 * migra c/ round-trip real (hashSenha↔verificarSenha), branco, codoperador inválido, e o caso de controle → suspeita.
 * Recon: 100% das 155 senhas reais decodam com shift 13 (sem re-encode cumulativo — ao contrário da EMPRESA).
 */
const hashFake = (s: string) => `H(${s})`;
function op(over: Partial<RawOperadorSenha>): RawOperadorSenha {
  return { codoperador: 1, senha: null, ...over };
}

describe('cutoverSenhasOperador', () => {
  it('senha LIMPA (César +13) migra; round-trip real hashSenha↔verificarSenha', () => {
    const { migrar, report } = cutoverSenhasOperador([op({ codoperador: 7, senha: encodeSenhaLegado('1234') })]);
    expect(migrar).toHaveLength(1);
    expect(migrar[0].codoperador).toBe(7);
    expect(verificarSenha('1234', migrar[0].hash)).toBe(true);
    expect(verificarSenha('9999', migrar[0].hash)).toBe(false);
    expect(report).toMatchObject({ operadores: 1, migradas: 1, vazias: 0 });
    expect(report.suspeitas).toHaveLength(0);
  });

  it('senha em BRANCO (null / vazio) → vazias, não migra', () => {
    const { migrar, report } = cutoverSenhasOperador([op({ codoperador: 8, senha: null }), op({ codoperador: 9, senha: '' })]);
    expect(migrar).toHaveLength(0);
    expect(report.vazias).toBe(2);
  });

  it('codoperador INVÁLIDO (0/negativo/NaN) → invalidas, não processa', () => {
    const { migrar, report } = cutoverSenhasOperador([
      op({ codoperador: 0, senha: encodeSenhaLegado('x') }),
      op({ codoperador: -1 }),
      op({ codoperador: NaN as unknown as number }),
    ]);
    expect(migrar).toHaveLength(0);
    expect(report.operadores).toBe(0);
    expect(report.invalidas).toHaveLength(3);
  });

  it('decode em byte de CONTROLE → SUSPEITA, não migra (guarda defensiva)', () => {
    // bytes que decode-13 leva à banda de controle (0x98..) — padrão emp1 real da EMPRESA; nenhum operador real cai aqui.
    const { migrar, report } = cutoverSenhasOperador([op({ codoperador: 5, senha: String.fromCharCode(165, 173, 166) })]);
    expect(migrar).toHaveLength(0);
    expect(report.suspeitas).toHaveLength(1);
    expect(report.suspeitas[0].codoperador).toBe(5);
  });

  it('hasher injetável (determinístico) p/ asserção de estrutura', () => {
    const { migrar } = cutoverSenhasOperador([op({ codoperador: 3, senha: encodeSenhaLegado('ab') })], hashFake);
    expect(migrar[0]).toMatchObject({ codoperador: 3, hash: 'H(ab)' });
  });
});
