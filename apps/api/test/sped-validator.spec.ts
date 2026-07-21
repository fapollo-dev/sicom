import { describe, it, expect } from 'vitest';
import { SpedArquivo } from '../src/modules/sped/sped-writer';
import { validarSped } from '../src/modules/sped/sped-validator';

/** monta um arquivo mínimo VÁLIDO (bloco 0 + bloco M) via o motor escritor; `m200` permite injetar um M200 ruim. */
function arquivoBase(m200: string[]): string {
  const a = new SpedArquivo();
  a.add('0000', ['006', '0', '', '', '01092026', '30092026', 'EMPRESA X', '11111111000191', 'MG', '3106200', '', '00', '1']); // 13 campos
  a.add('0001', ['0']);
  a.fecharBloco('0990', '0');
  a.add('M001', ['0']);
  a.add('M200', m200);
  a.add('M205', ['08', '810902', m200[6] ?? '0,00']); // detalhe do a-recolher = VL_CONT_NC_REC do M200 (coerente)
  a.fecharBloco('M990', 'M');
  return a.gerar();
}

const M200_OK = ['100,00', '30,00', '0,00', '70,00', '0,00', '0,00', '70,00', '0,00', '0,00', '0,00', '0,00', '70,00'];

describe('validarSped (validador estrutural PVA-style)', () => {
  it('arquivo bem-formado (envelope + M200 consistente) → ok, sem erros', () => {
    const r = validarSped(arquivoBase(M200_OK));
    expect(r.ok).toBe(true);
    expect(r.erros).toEqual([]);
    expect(r.registros).toBeGreaterThan(0);
  });

  it('M200 com VL_TOT_CONT_NC_DEV errado (≠ NC_PER − créditos) → erro (o bug clássico do campo derivado)', () => {
    // f3 (NC_DEV) = 99,99 mas 100−30−0 = 70 → deve ser flagrado.
    const bad = ['100,00', '30,00', '0,00', '99,99', '0,00', '0,00', '70,00', '0,00', '0,00', '0,00', '0,00', '70,00'];
    const r = validarSped(arquivoBase(bad));
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.includes('VL_TOT_CONT_NC_DEV'))).toBe(true);
  });

  it('M200 com VL_CONT_NC_REC errado (≠ NC_DEV − ret − ded) → erro', () => {
    const bad = ['100,00', '30,00', '0,00', '70,00', '0,00', '0,00', '55,55', '0,00', '0,00', '0,00', '0,00', '55,55'];
    const r = validarSped(arquivoBase(bad));
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.includes('VL_CONT_NC_REC'))).toBe(true);
  });

  it('totalizador 9999 adulterado → erro de contagem do arquivo', () => {
    const arq = arquivoBase(M200_OK).replace(/\|9999\|\d+\|/, '|9999|99999|');
    const r = validarSped(arq);
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.includes('9999'))).toBe(true);
  });

  it('registro com contagem de campos errada → erro', () => {
    // M200 com 11 campos (falta 1) — deve ser flagrado pela contagem esperada (12).
    const r = validarSped(arquivoBase(M200_OK.slice(0, 11)));
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.includes('M200') && e.includes('campos'))).toBe(true);
  });

  it('coerência C100↔C175: VL_PIS do C100 de saída ≠ Σ dos C175 → erro', () => {
    const a = new SpedArquivo();
    a.add('0000', ['006', '0', '', '', '01092026', '30092026', 'EMPRESA X', '11111111000191', 'MG', '3106200', '', '00', '1']);
    a.add('0001', ['0']);
    a.fecharBloco('0990', '0');
    a.add('C001', ['0']);
    a.add('C010', ['11111111000191', '1']);
    // C100 saída (28 campos): VL_PIS(idx24)=99,99 mas o C175 traz 16,50 → incoerente.
    a.add('C100', ['1', '0', '', '65', '00', '001', '101', '3526', '05092026', '05092026', '1000,00', '0', '0,00', '0,00', '1000,00', '9', '0,00', '0,00', '0,00', '0,00', '0,00', '0,00', '0,00', '0,00', '99,99', '76,00', '0,00', '0,00']);
    a.add('C175', ['5102', '1000,00', '0,00', '01', '1000,00', '1,6500', '', '', '16,50', '01', '1000,00', '7,6000', '', '', '76,00', '', '']);
    a.fecharBloco('C990', 'C');
    const r = validarSped(a.gerar());
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.includes('C100 saída') && e.includes('VL_PIS'))).toBe(true);
  });
});
