import { describe, it, expect } from 'vitest';
import { cutoverSenhasEmpresa, type RawEmpresaSenha } from '../scripts/cutover/senha-empresa';
import { encodeSenhaLegado, verificarSenha } from '../src/shared/auth/crypto';

/**
 * CUTOVER das senhas de operação da EMPRESA — motor (decode César +13 fixo + classificação limpa/suspeita).
 * Cobre: senha limpa migra c/ round-trip real (hashSenha↔verificarSenha), a corrupção do re-encode cumulativo
 * (bytes de controle → suspeita, NÃO migra), branco, codempresa inválido e independência dos 4 tipos.
 */

// hasher determinístico p/ asserções de estrutura (não usa entropia); o round-trip real usa hashSenha de verdade.
const hashFake = (s: string) => `H(${s})`;

function empresa(over: Partial<RawEmpresaSenha>): RawEmpresaSenha {
  return { codempresa: 1, senhaadmin: null, senhadesc: null, senhacancel: null, senhagaveta: null, ...over };
}

describe('cutoverSenhasEmpresa', () => {
  it('senha LIMPA (salva 1×, shift 13) migra; round-trip real hashSenha↔verificarSenha', () => {
    // emp50 no golden: "081223" cifrada com shift 13 (encodeSenhaLegado) → decode-13 recupera a senha.
    const cifrada = encodeSenhaLegado('081223');
    const { migrar, report } = cutoverSenhasEmpresa([empresa({ codempresa: 50, senhadesc: cifrada })]);
    expect(migrar).toHaveLength(1);
    expect(migrar[0]).toMatchObject({ idempresa: 50, tipo: 'desc' });
    expect(verificarSenha('081223', migrar[0].hash)).toBe(true); // round-trip: a senha real verifica
    expect(verificarSenha('outra', migrar[0].hash)).toBe(false);
    expect(report).toMatchObject({ empresas: 1, migradas: 1, vazias: 3 }); // desc migra; admin/cancel/gaveta em branco
    expect(report.suspeitas).toHaveLength(0);
  });

  it('re-encode CUMULATIVO → decode-13 em bytes de CONTROLE (emp1 real) → SUSPEITA, não migra', () => {
    // padrão REAL de emp1 (PINHEIRAO): cifrado [165,173,166,167,167,168] (="081223" com shift 13×9=117).
    // decode-13 → [152,160,153,154,154,155] (controle 0x98..0x9B) → corrompida, não digitável.
    const cifradaEmp1 = String.fromCharCode(165, 173, 166, 167, 167, 168);
    const { migrar, report } = cutoverSenhasEmpresa([empresa({ codempresa: 1, senhaadmin: cifradaEmp1 })]);
    expect(migrar).toHaveLength(0);
    expect(report.suspeitas).toHaveLength(1);
    expect(report.suspeitas[0]).toMatchObject({ codempresa: 1, tipo: 'admin' });
    expect(report.suspeitas[0].motivo).toContain('controle');
  });

  it('re-encode CUMULATIVO → decode-13 em bytes LATIN-1 ≥160 (emp2 real) → SUSPEITA, não migra (fold auditoria)', () => {
    // padrão REAL de emp2 (PINHEIRAO): cifrado [178,186,179,180,180,181] (="081223" com shift 13×10=130).
    // decode-13 → [165,173,166,167,167,168] (todos ≥160, latin-1 estendido) → antes migrava como "limpa"; agora flag.
    const cifradaEmp2 = String.fromCharCode(178, 186, 179, 180, 180, 181);
    const { migrar, report } = cutoverSenhasEmpresa([empresa({ codempresa: 2, senhadesc: cifradaEmp2 })]);
    expect(migrar).toHaveLength(0);
    expect(report.suspeitas).toHaveLength(1);
    expect(report.suspeitas[0]).toMatchObject({ codempresa: 2, tipo: 'desc' });
    expect(report.suspeitas[0].motivo).toContain('ASCII');
  });

  it('senha em BRANCO (null e string vazia) → vazias, não migra nem vira suspeita', () => {
    const { migrar, report } = cutoverSenhasEmpresa([empresa({ codempresa: 2, senhaadmin: null, senhadesc: '' })]);
    expect(migrar).toHaveLength(0);
    expect(report.vazias).toBe(4); // 4 tipos, todos em branco
    expect(report.suspeitas).toHaveLength(0);
  });

  it('codempresa INVÁLIDO (0, negativo, NaN) → invalidas, não processa', () => {
    const { migrar, report } = cutoverSenhasEmpresa([
      empresa({ codempresa: 0, senhadesc: encodeSenhaLegado('x') }),
      empresa({ codempresa: -1 }),
      empresa({ codempresa: NaN as unknown as number }),
    ]);
    expect(migrar).toHaveLength(0);
    expect(report.empresas).toBe(0);
    expect(report.invalidas).toHaveLength(3);
  });

  it('os 4 tipos são independentes: migra só os configurados limpos', () => {
    const { migrar, report } = cutoverSenhasEmpresa(
      [empresa({ codempresa: 7, senhaadmin: encodeSenhaLegado('a1'), senhacancel: encodeSenhaLegado('c9'), senhadesc: '', senhagaveta: null })],
      hashFake,
    );
    expect(migrar).toHaveLength(2);
    expect(migrar.map((m) => m.tipo).sort()).toEqual(['admin', 'cancel']);
    expect(migrar.find((m) => m.tipo === 'admin')?.hash).toBe('H(a1)');
    expect(report).toMatchObject({ migradas: 2, vazias: 2 });
  });
});
