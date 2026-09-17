import { describe, expect, it } from 'vitest';
import { montarDeschist } from '../src/modules/cobranca/integracao-contabil.motor';
import { argsDoHistorico, type CtxHistorico } from '../src/modules/cobranca/historico-contabil.args';

/**
 * O TEXTO DO RAZÃO — cada caso abaixo é uma linha REAL do `DIARIO` do cliente.
 *
 * ⚠️ **procedência**: a rotina que substitui os `*` mora em `FuncoesApollo`, pacote que não veio no fonte
 * clonado. A regra foi reconstruída confrontando os 54 templates de `HISTORICO_CONTABIL` com o razão — 1,43
 * milhão de linhas. Este teste é a trava: se alguém mexer na ordem dos argumentos de um histórico, o texto
 * deixa de bater com o que o legado escreveu, e o contador percebe antes de nós.
 *
 * O `template` de cada caso é o do cadastro; o `esperado`, o texto que o cliente tem gravado.
 */
const CASOS: Array<{ hist: number; template: string; ctx: CtxHistorico; esperado: string; onde: string }> = [
  {
    hist: 96, onde: 'origem 61/62, 1.326.853 linhas — a maior população do razão',
    template: 'TAXA DE CARTAO BAIXADOS LOTE .: * OPERADORA .: *',
    ctx: { lote: '90886', operadora: 'ALELO ALIMENTACA - CODREDE 5' },
    esperado: 'TAXA DE CARTAO BAIXADOS LOTE .: 90886 OPERADORA .: ALELO ALIMENTACA - CODREDE 5',
  },
  {
    hist: 94, onde: 'origem 51, o débito da baixa de cartão (15.954 linhas)',
    template: 'RECEBTO CARTAO LOTE .: *',
    ctx: { lote: '90886', operadora: 'ALELO ALIMENTACA - CODREDE 5' },
    esperado: 'RECEBTO CARTAO LOTE .: 90886',
  },
  {
    hist: 95, onde: 'origem 51, o crédito da MESMA baixa — o mesmo contexto, outro texto',
    template: 'RECEBTO CARTAO LOTE .: * OPERADORA .: *',
    ctx: { lote: '90886', operadora: 'ALELO ALIMENTACA - CODREDE 5' },
    esperado: 'RECEBTO CARTAO LOTE .: 90886 OPERADORA .: ALELO ALIMENTACA - CODREDE 5',
  },
  {
    hist: 91, onde: 'origem 15, o débito da baixa de A PAGAR (43.121 linhas)',
    template: 'PAGTO LOTE .: * DOCTO .: * - * NOTAFISCAL .: * PARCEIRO .: *',
    ctx: { lote: '90793', tipodoc: 'BOLETO', documentoTexto: '46964', notafiscal: '', parceiro: 'BANCO ITAU S/A' },
    esperado: 'PAGTO LOTE .: 90793 DOCTO .: BOLETO - 46964 NOTAFISCAL .:  PARCEIRO .: BANCO ITAU S/A',
  },
  {
    hist: 221, onde: 'origem 15, o crédito da MESMA baixa — o `¦` é constante em 5.169/5.169 linhas',
    template: 'PAGTO * *',
    ctx: { historicoMov: 'REFERENTE A BAIXA DO LOTE: 90793 - Baixa das contas a pagar realizada pelo(a) usuário(a) LETICIA ADM.' },
    esperado: 'PAGTO REFERENTE A BAIXA DO LOTE: 90793 - Baixa das contas a pagar realizada pelo(a) usuário(a) LETICIA ADM. ¦',
  },
  {
    hist: 93, onde: 'origem 16, o crédito da baixa de A RECEBER (18.235 linhas)',
    template: 'RECEBTO LOTE .: * CLIENTE .: * BAIXADO POR .: *',
    ctx: { lote: '90790', parceiro: 'CENTRO EDUCACIONAL DONA NEUZA RESENDE', usuario: 'LETICIA ADM' },
    esperado: 'RECEBTO LOTE .: 90790 CLIENTE .: CENTRO EDUCACIONAL DONA NEUZA RESENDE BAIXADO POR .: LETICIA ADM',
  },
  {
    hist: 92, onde: 'origem 16, o débito da MESMA baixa — o template é só o buraco',
    template: '*',
    ctx: { historicoMov: 'BAIXA DO LOTE 90790 - Baixa das contas a receber realizada pelo(a) usuário(a) LETICIA ADM.' },
    esperado: 'BAIXA DO LOTE 90790 - Baixa das contas a receber realizada pelo(a) usuário(a) LETICIA ADM.',
  },
  {
    hist: 86, onde: 'origem 19, transferência entre contas (17.581 linhas) — e o CRLF virando espaço',
    template: 'CREDITO CONTA .: * DA CONTA .: * LOTE .: *',
    ctx: { conta: 'JF SUPERMERCADOS ITAU', historicoMov: 'TRANSF. CONTA DESTINO: 4914-7\r\n Lote: 89642\r\nRealizada pelo(a) usuário(a) LETICIA ADM2.', lote: '89642' },
    esperado: 'CREDITO CONTA .: JF SUPERMERCADOS ITAU DA CONTA .: TRANSF. CONTA DESTINO: 4914-7  Lote: 89642 Realizada pelo(a) usuário(a) LETICIA ADM2. LOTE .: 89642',
  },
  {
    hist: 89, onde: 'origem 14, cadastro de A RECEBER — o padding de 9 dígitos, 5.895/5.895',
    template: 'A RECEBER DOCTO .: * VERBA .: * PARCEIRO .: *',
    ctx: { documento: 130582, verba: 'AÇAO DE VENDAS', parceiro: 'NESTLE BRASIL LTDA' },
    esperado: 'A RECEBER DOCTO .: 000130582 VERBA .: AÇAO DE VENDAS PARCEIRO .: NESTLE BRASIL LTDA',
  },
  {
    hist: 105, onde: 'origem 65, agrupamento de convênio — 15.089/15.089 com o padding',
    template: 'AGRUPAMENTO CONVENIO .: *  *',
    ctx: { documento: 117847, parceiro: 'LETICIA OLIVEIRA FREIRE' },
    esperado: 'AGRUPAMENTO CONVENIO .: 000117847  LETICIA OLIVEIRA FREIRE',
  },
  {
    hist: 88, onde: 'origem 64, movimentação de caixa',
    template: 'PGTO .: * DOCTO .: * LOTE .: * *',
    ctx: { parceiro: 'ANJOS DA GUARDA ALARMES ELET LTDA', documento: 280201, lote: '90454', verba: 'SEGURANCA LOJA' },
    esperado: 'PGTO .: ANJOS DA GUARDA ALARMES ELET LTDA DOCTO .: 000280201 LOTE .: 90454 SEGURANCA LOJA',
  },
  {
    hist: 87, onde: 'origem 63, adiantamento — os rótulos do legado NÃO descrevem o conteúdo',
    template: 'ADIANT P/ PARCEIRO .: * DOCTO .: *',
    ctx: { codparceiro: 3066, parceiro: 'CAIXA ECONOMICA FEDERAL', documento: 3441 },
    esperado: 'ADIANT P/ PARCEIRO .: 3066 DOCTO .: CAIXA ECONOMICA FEDERAL',
  },
  {
    hist: 103, onde: 'origem 13, cadastro de A PAGAR — `IRRF - FOLHA` é a razão do parceiro, não uma verba',
    template: 'APAGAR DOCTO .: * * *',
    ctx: { documento: 74769, parceiro: 'IRRF - FOLHA', obs: '' },
    esperado: 'APAGAR DOCTO .: 000074769 IRRF - FOLHA ',
  },
  {
    hist: 106, onde: 'origem 55, desconto obtido — o 3º é a OBS do título, com o CRLF virando espaço',
    template: 'DESCONTO OBTIDO .: * * *',
    ctx: { documentoTexto: '71983', parceiro: 'BRF S.A', obs: ' REFERENTE A NOTA FISCAL 6412933 EMITIDA EM 31/07/2026\r\n' },
    esperado: 'DESCONTO OBTIDO .: 71983 BRF S.A  REFERENTE A NOTA FISCAL 6412933 EMITIDA EM 31/07/2026 ',
  },
  {
    hist: 161, onde: 'origem 58, desconto concedido',
    template: 'DESCONTO CONCEDIDO LOTE.: * DOCTO.: * CLIENTE.: *',
    ctx: { lote: '90408', documentoTexto: '113165', parceiro: 'CICERO BRAZ DE LIMA' },
    esperado: 'DESCONTO CONCEDIDO LOTE.: 90408 DOCTO.: 113165 CLIENTE.: CICERO BRAZ DE LIMA',
  },
  {
    hist: 1, onde: 'origem 64 — o legado imprime `000000000` e vazios quando não passa argumento',
    template: 'NOTA FISCAL COMPRA .: * CNPJ * FORNECEDOR *',
    ctx: {},
    esperado: 'NOTA FISCAL COMPRA .:  CNPJ  FORNECEDOR ',
  },
];

describe('histórico contábil — o texto do razão', () => {
  for (const c of CASOS) {
    it(`histórico ${c.hist} (${c.onde})`, () => {
      expect(montarDeschist(c.template, argsDoHistorico(c.hist, c.ctx))).toBe(c.esperado);
    });
  }

  it('número vira 9 dígitos com zeros à esquerda; texto vai cru', () => {
    expect(montarDeschist('* e *', [130582, '130582'])).toBe('000130582 e 130582');
  });

  it('`*` a mais imprime vazio, argumento a mais é ignorado', () => {
    expect(montarDeschist('[*][*]', ['só um'])).toBe('[só um][]');
    expect(montarDeschist('[*]', ['a', 'b'])).toBe('[a]');
  });

  it('sem template não há texto — contabilizar não pode parar por falta de rótulo', () => {
    expect(montarDeschist(null, ['x'])).toBeNull();
  });

  it('histórico sem regra provada imprime o template com os buracos vazios', () => {
    expect(argsDoHistorico(9999, { lote: '1' })).toEqual([]);
    expect(montarDeschist('SEM REGRA .: *', argsDoHistorico(9999, { lote: '1' }))).toBe('SEM REGRA .: ');
  });
});
