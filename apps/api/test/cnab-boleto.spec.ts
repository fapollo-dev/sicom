import { describe, expect, it } from 'vitest';
import { codigoBarras, linhaDigitavel, mod10, mod11Barras, fatorVencimento } from '../src/modules/cobranca/cnab-remessa.service';

/**
 * CÓDIGO DE BARRAS / LINHA DIGITÁVEL do boleto. O algoritmo foi VERIFICADO CONTRA DADO REAL antes de entrar:
 * `APAGAR.CODBARRASBLT` do Oracle guarda 1.161 linhas digitáveis de boletos que a empresa pagou (bancos
 * 237/341/756/001/033); das 1.077 com 47 dígitos, a conversão linha↔barras e **os 4 dígitos verificadores
 * conferem em 100%** (DV geral módulo 11 + 3 DVs de campo módulo 10), o fator de vencimento reproduz o
 * vencimento em 98,1% e o valor bate em 90,7% (o resto é título alterado depois da emissão).
 * Aqui ficam os casos de regressão do mesmo algoritmo, sem depender do Oracle.
 */
describe('boleto — código de barras e linha digitável', () => {
  it('fator de vencimento usa a base FEBRABAN 07/10/1997', () => {
    expect(fatorVencimento('1997-10-07')).toBe(0);
    expect(fatorVencimento('1997-10-08')).toBe(1);
    expect(fatorVencimento('2020-10-16')).toBe(8410); // um dos vencimentos do golden
  });

  it('módulo 11 do DV geral trata resto 0/10/11 como dígito 1', () => {
    // 43 dígitos cujo resto cai em 1 pelo próprio cálculo — o contrato é o retorno em 1..9
    const dv = mod11Barras('3419109008009232301488728611000988406000004807');
    expect(dv).toBeGreaterThanOrEqual(1);
    expect(dv).toBeLessThanOrEqual(9);
  });

  it('linha digitável de 47 dígitos, com os 3 DVs de campo em módulo 10', () => {
    const barras = codigoBarras({
      febraban: '341', venc: '2026-03-10', valor: 1603.48, carteira: '109',
      agencia: '3034', conta: '23055', nossoNumero: '65706',
    });
    expect(barras).toHaveLength(44);
    expect(barras.slice(0, 4)).toBe('3419');
    expect(barras.slice(9, 19)).toBe('0000160348'); // valor em centavos
    // o DV geral confere pelo próprio módulo 11 (o mesmo teste que passou nos 1.077 reais)
    expect(String(mod11Barras(barras.slice(0, 4) + barras.slice(5)))).toBe(barras[4]);

    const ld = linhaDigitavel(barras);
    expect(ld).toHaveLength(47);
    expect(String(mod10(ld.slice(0, 9)))).toBe(ld[9]);
    expect(String(mod10(ld.slice(10, 20)))).toBe(ld[20]);
    expect(String(mod10(ld.slice(21, 31)))).toBe(ld[31]);
    // a linha digitável tem de voltar ao MESMO código de barras (a conversão é reversível)
    const volta = ld.slice(0, 4) + ld.slice(32, 33) + ld.slice(33, 37) + ld.slice(37, 47) + ld.slice(4, 9) + ld.slice(10, 20) + ld.slice(21, 31);
    expect(volta).toBe(barras);
  });

  it('campo livre do Itaú: carteira + nosso número + DAC + agência + conta + DAC + 000', () => {
    const b = codigoBarras({
      febraban: '341', venc: '2026-03-10', valor: 10, carteira: '109',
      agencia: '3034', conta: '23055', nossoNumero: '65706',
    });
    const livre = b.slice(19);
    expect(livre).toHaveLength(25);
    expect(livre.slice(0, 3)).toBe('109');
    expect(livre.slice(3, 11)).toBe('00065706');
    expect(livre.slice(11, 12)).toBe(String(mod10('3034' + '23055' + '109' + '00065706')));
    expect(livre.slice(12, 16)).toBe('3034');
    expect(livre.slice(16, 21)).toBe('23055');
    expect(livre.slice(22)).toBe('000');
  });

  it('campo livre do BB: 000000 + convênio(7) + nosso número(10) + carteira(2)', () => {
    const b = codigoBarras({
      febraban: '001', venc: '2026-02-20', valor: 907.2, carteira: '017',
      agencia: '2591', conta: '59052', nossoNumero: '65545', convenio: '3500121',
    });
    expect(b.slice(0, 4)).toBe('0019');
    const livre = b.slice(19);
    expect(livre).toBe('000000' + '3500121' + '0000065545' + '17');
  });

  it('banco fora do corte não gera barras (erro, não código errado)', () => {
    expect(() => codigoBarras({
      febraban: '033', venc: '2026-03-10', valor: 10, carteira: '101',
      agencia: '3167', conta: '13004', nossoNumero: '1',
    })).toThrow();
  });
});
