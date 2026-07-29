import { describe, it, expect } from 'vitest';
import { SpedArquivo } from '../src/modules/sped/sped-writer';
import { validarSped } from '../src/modules/sped/sped-validator';
import { validarSpedFiscal } from '../src/modules/sped/sped-fiscal-validator';

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

  // ── DOMÍNIO DE CAMPOS (cutover golden): regras do PVA que a contagem não pega ──
  /** arquivo mínimo com um 0110 injetável (para exercitar os domínios do regime). */
  function arquivoCom0110(campos0110: string[]): string {
    const a = new SpedArquivo();
    a.add('0000', ['006', '0', '', '', '01092026', '30092026', 'EMPRESA X', '11111111000191', 'MG', '3106200', '', '00', '2']);
    a.add('0001', ['0']);
    a.add('0110', campos0110);
    a.fecharBloco('0990', '0');
    return a.gerar();
  }

  it('0110 COD_TIPO_CONT="0" (fora do domínio {1,2}) → erro (bug ALTA que a contagem deixava passar)', () => {
    const r = validarSped(arquivoCom0110(['1', '1', '0', ''])); // o valor inválido antigo
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.includes('COD_TIPO_CONT'))).toBe(true);
  });

  it('0110 LR correto ["1","1","1",""] → sem erro de domínio', () => {
    const r = validarSped(arquivoCom0110(['1', '1', '1', '']));
    expect(r.erros.some((e) => e.includes('0110'))).toBe(false);
  });

  it('0110 cumulativo (COD_INC_TRIB=2) sem IND_REG_CUM → erro (obrigatório)', () => {
    const r = validarSped(arquivoCom0110(['2', '', '', '']));
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.includes('IND_REG_CUM'))).toBe(true);
  });

  it('M100 IND_CRED_ORI="01" (fora do domínio {0,1}) → erro (bug ALTA)', () => {
    const a = new SpedArquivo();
    a.add('0000', ['006', '0', '', '', '01092026', '30092026', 'EMPRESA X', '11111111000191', 'MG', '3106200', '', '00', '2']);
    a.add('0001', ['0']);
    a.fecharBloco('0990', '0');
    a.add('M001', ['0']);
    a.add('M100', ['101', '01', '1000,00', '1,6500', '', '', '16,50', '0,00', '0,00', '0,00', '16,50', '0', '0,00', '16,50']); // IND_CRED_ORI inválido
    a.add('M105', ['01', '50', '1000,00', '0,00', '1000,00', '1000,00', '', '', '']);
    a.fecharBloco('M990', 'M');
    const r = validarSped(a.gerar());
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.includes('IND_CRED_ORI'))).toBe(true);
  });

  it('M105 CST vazio → erro (obrigatório no detalhe de crédito)', () => {
    const a = new SpedArquivo();
    a.add('0000', ['006', '0', '', '', '01092026', '30092026', 'EMPRESA X', '11111111000191', 'MG', '3106200', '', '00', '2']);
    a.add('0001', ['0']);
    a.fecharBloco('0990', '0');
    a.add('M001', ['0']);
    a.add('M100', ['101', '0', '1000,00', '1,6500', '', '', '16,50', '0,00', '0,00', '0,00', '16,50', '0', '0,00', '16,50']);
    a.add('M105', ['01', '', '1000,00', '0,00', '1000,00', '1000,00', '', '', '']); // CST vazio
    a.fecharBloco('M990', 'M');
    const r = validarSped(a.gerar());
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.includes('CST'))).toBe(true);
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

describe('validarSpedFiscal (EFD ICMS/IPI — validador estrutural próprio)', () => {
  /** arquivo fiscal mínimo VÁLIDO (0000 layout ICMS/IPI 14 campos + E110 injetável). */
  function fiscalBase(e110: string[]): string {
    const a = new SpedArquivo();
    a.add('0000', ['020', '0', '01112026', '30112026', 'EMPRESA X', '11111111000191', '', 'MG', '123', '3106200', '', '', 'A', '1']); // 14 campos
    a.add('0001', ['0']);
    a.fecharBloco('0990', '0');
    a.add('D001', ['1']); // openers obrigatórios (sem-dados) — espelha o gerador
    a.fecharBloco('D990', 'D');
    a.add('E001', ['0']);
    a.add('E100', ['01112026', '30112026']);
    a.add('E110', e110);
    a.fecharBloco('E990', 'E');
    a.add('G001', ['1']);
    a.fecharBloco('G990', 'G');
    a.add('H001', ['1']); // bloco H sempre presente (IND_MOV=1 sem inventário) — espelha o gerador
    a.fecharBloco('H990', 'H');
    a.add('K001', ['1']);
    a.fecharBloco('K990', 'K');
    a.add('1001', ['1']);
    a.fecharBloco('1990', '1');
    return a.gerar();
  }
  // débito 0 / crédito 18 → saldo apurado 0, credor a transportar 18.
  const E110_OK = ['0,00', '0,00', '0,00', '0,00', '18,00', '0,00', '0,00', '0,00', '0,00', '0,00', '0,00', '0,00', '18,00', '0,00'];

  it('arquivo fiscal bem-formado (0000 14 campos + E110 coerente) → ok', () => {
    const r = validarSpedFiscal(fiscalBase(E110_OK));
    expect(r.ok).toBe(true);
    expect(r.erros).toEqual([]);
  });

  it('0000 IND_ATIV fora do domínio {0,1} → erro', () => {
    const a = new SpedArquivo();
    a.add('0000', ['020', '0', '01112026', '30112026', 'EMPRESA X', '11111111000191', '', 'MG', '123', '3106200', '', '', 'A', '9']); // IND_ATIV=9 inválido no fiscal
    a.add('0001', ['0']);
    a.fecharBloco('0990', '0');
    const r = validarSpedFiscal(a.gerar());
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.includes('IND_ATIV'))).toBe(true);
  });

  it('E110 VL_SLD_CREDOR_TRANSPORTAR errado (≠ saldo credor) → erro', () => {
    const bad = ['0,00', '0,00', '0,00', '0,00', '18,00', '0,00', '0,00', '0,00', '0,00', '0,00', '0,00', '0,00', '99,99', '0,00'];
    const r = validarSpedFiscal(fiscalBase(bad));
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.includes('VL_SLD_CREDOR_TRANSPORTAR'))).toBe(true);
  });

  it('E110 VL_SLD_APURADO errado (≠ max(0, débitos−créditos)) → erro', () => {
    // débito 50, crédito 18 → apurado esperado 32; injeta 99,99.
    const bad = ['50,00', '0,00', '0,00', '0,00', '18,00', '0,00', '0,00', '0,00', '0,00', '99,99', '0,00', '99,99', '0,00', '0,00'];
    const r = validarSpedFiscal(fiscalBase(bad));
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.includes('VL_SLD_APURADO'))).toBe(true);
  });

  it('C190 sem CST_ICMS → erro (obrigatório)', () => {
    const a = new SpedArquivo();
    a.add('0000', ['020', '0', '01112026', '30112026', 'EMPRESA X', '11111111000191', '', 'MG', '123', '3106200', '', '', 'A', '1']);
    a.add('0001', ['0']);
    a.fecharBloco('0990', '0');
    a.add('C001', ['0']);
    a.add('C190', ['', '1102', '18,00', '100,00', '100,00', '18,00', '0,00', '0,00', '0,00', '0,00', '']); // CST_ICMS vazio
    a.fecharBloco('C990', 'C');
    const r = validarSpedFiscal(a.gerar());
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.includes('CST_ICMS'))).toBe(true);
  });
});
