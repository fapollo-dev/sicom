import { argsPelosItens, type ArgHist, type ItemHistoricoContabil } from '@apollo/shared';

/**
 * O CONTEXTO DE UM LANÇAMENTO — tudo o que um histórico contábil pode querer imprimir.
 * Quem contabiliza preenche o que tem; o mapa abaixo escolhe o que entra em cada `*`, e na ordem certa.
 */
export interface CtxHistorico {
  /** documento que vira **9 dígitos com zeros à esquerda** (`000130582`): codapg, codrcb, codcx… */
  documento?: number | string | null;
  /** o mesmo documento quando o legado o imprime CRU (`DOCTO .: - 46964`). */
  documentoTexto?: string | null;
  /** o lote de baixa — sempre cru (`LOTE .: 90790`). */
  lote?: string | null;
  parceiro?: string | null;
  /** `CODPARCEIRO` cru, que o histórico 87 imprime no lugar rotulado "PARCEIRO". */
  codparceiro?: number | null;
  cnpj?: string | null;
  /** `BOLETO`, `DUPLICATA`, `RH`… */
  tipodoc?: string | null;
  notafiscal?: string | null;
  /** `OPERADORA .: ALELO ALIMENTACA - CODREDE 5`. */
  operadora?: string | null;
  /** quem deu a baixa (`BAIXADO POR .: LETICIA ADM`). */
  usuario?: string | null;
  /** o `HISTORICO` da movimentação bancária, que vários templates imprimem inteiro. */
  historicoMov?: string | null;
  /** a observação do título. */
  obs?: string | null;
  /** a descrição do centro de custo / verba / natureza. */
  verba?: string | null;
  /** o nome da conta bancária de destino (`CREDITO CONTA .: JF SUPERMERCADOS ITAU`). */
  conta?: string | null;
  cfop?: string | null;
  /** a loja com **3 dígitos** (`LOJA .: 001`), como os históricos de nota 64, 66 e 67 a imprimem. */
  loja?: string | null;
}

/**
 * OS ARGUMENTOS DE CADA HISTÓRICO CONTÁBIL — a lista que preenche os `*` do template, **na ordem**.
 *
 * ⚠️ **procedência**: quem monta essa lista no legado mora em `FuncoesApollo`, pacote que não veio no fonte
 * clonado. Cada linha abaixo saiu de confrontar o template do cadastro com o texto que o razão do cliente
 * gravou — o mesmo método que reconstruiu o motor. O comentário de cada entrada traz o texto real medido.
 *
 * O mapa é por HISTÓRICO, não por origem, porque é o histórico que define o texto: o 96 imprime a mesma
 * coisa vindo da origem 61 ou da 62, e o 88 aparece nas origens 13 e 64 com a mesma ordem de argumentos.
 *
 * Histórico sem entrada aqui imprime o template com os `*` vazios — que é exatamente o que o legado faz
 * quando o chamador não passa argumento (o razão tem `NOTA FISCAL COMPRA .: 000000000 CNPJ  FORNECEDOR `).
 */
export const ARGS_POR_HISTORICO: Record<number, (c: CtxHistorico) => ArgHist[]> = {
  // 1 · `NOTA FISCAL COMPRA .: * CNPJ * FORNECEDOR *`
  //     'NOTA FISCAL COMPRA .: 002493328 CNPJ 20.895.426/0002-49 FORNECEDOR AGUA BRANCA COM DISTR DE BEBIDAS'
  1: (c) => [c.documento, c.cnpj, c.parceiro],
  // 21 · `DOCTO.: * CNPJ.: * PARCEIRO.: * TIPO DOCTO.: *`
  //     'DOCTO.: 000045564 CNPJ.: 33.532.868/0001-91 PARCEIRO.: CEMIG DISTRIBUICAO S/A TIPO DOCTO.: BOLETO'
  21: (c) => [c.documento, c.cnpj, c.parceiro, c.tipodoc],
  // 61 · `NOTA FISCAL.: * CFOP.: *CNPJ.: *PARCEIRO.: *`
  //     'NOTA FISCAL.: 000026116 CFOP.: 1102CNPJ.: 05.351.944/0001-27PARCEIRO.: MAGNA APARECIDA CARVALHO'
  61: (c) => [c.documento, c.cfop, c.cnpj, c.parceiro],
  // 63 · `NOTA FISCAL *` → 'NOTA FISCAL 000740112'
  63: (c) => [c.documento],
  // 86 · `CREDITO CONTA .: * DA CONTA .: * LOTE .: *`
  //     'CREDITO CONTA .: JF SUPERMERCADOS ITAU DA CONTA .: TRANSF. CONTA DESTINO: 4914-7 … LOTE .: 89642'
  86: (c) => [c.conta, c.historicoMov, c.lote],
  // 87 · `ADIANT P/ PARCEIRO .: * DOCTO .: *` → 'ADIANT P/ PARCEIRO .: 3066 DOCTO .: CAIXA ECONOMICA FEDERAL'
  //     ⚠️ os rótulos não descrevem o conteúdo: o primeiro `*` recebe o CÓDIGO do parceiro (cru, sem os 9
  //     dígitos) e o rotulado "DOCTO" recebe a RAZÃO dele. Copiado como está.
  87: (c) => [c.codparceiro == null ? null : String(c.codparceiro), c.parceiro],
  // 88 · `PGTO .: * DOCTO .: * LOTE .: * *`
  //     'PGTO .: ANJOS DA GUARDA ALARMES ELET LTDA DOCTO .: 000280201 LOTE .: 90454 SEGURANCA LOJA'
  88: (c) => [c.parceiro, c.documento, c.lote, c.verba],
  // 89 · `A RECEBER DOCTO .: * VERBA .: * PARCEIRO .: *`
  //     'A RECEBER DOCTO .: 000130582 VERBA .: AÇAO DE VENDAS PARCEIRO .: NESTLE BRASIL LTDA' (5.895/5.895)
  89: (c) => [c.documento, c.verba, c.parceiro],
  // 91 · `PAGTO LOTE .: * DOCTO .: * - * NOTAFISCAL .: * PARCEIRO .: *`
  //     'PAGTO LOTE .: 90793 DOCTO .: BOLETO - 46964 NOTAFISCAL .:  PARCEIRO .: BANCO ITAU S/A'
  91: (c) => [c.lote, c.tipodoc, c.documentoTexto, c.notafiscal, c.parceiro],
  // 92 · `*` (o template é só o buraco) → 'BAIXA DO LOTE 90790 - Baixa das contas a receber realizada…'
  92: (c) => [c.historicoMov],
  // 93 · `RECEBTO LOTE .: * CLIENTE .: * BAIXADO POR .: *`
  //     'RECEBTO LOTE .: 90790 CLIENTE .: CENTRO EDUCACIONAL DONA NEUZA RESENDE BAIXADO POR .: LETICIA ADM'
  93: (c) => [c.lote, c.parceiro, c.usuario],
  // 94 · `RECEBTO CARTAO LOTE .: *` → 'RECEBTO CARTAO LOTE .: 90886' (o débito da baixa de cartão)
  94: (c) => [c.lote],
  // 95 · `RECEBTO CARTAO LOTE .: * OPERADORA .: *` (o crédito da mesma baixa)
  95: (c) => [c.lote, c.operadora],
  // 96 · `TAXA DE CARTAO BAIXADOS LOTE .: * OPERADORA .: *` — 1,33 milhão de linhas, a maior do razão
  96: (c) => [c.lote, c.operadora],
  // 101 · `RESCISAO A PAGAR .: * DOCTO .: *` → 'RESCISAO A PAGAR .: LEANDRO JOSE MENDES DOCTO .: 000051674'
  101: (c) => [c.parceiro, c.documento],
  // 102 · `FGTS RESCISORIO .: * DOCTO .: *` → 'FGTS RESCISORIO .: FGTS NORMAL DOCTO .: 000067774'
  //      ⚠️ `FGTS NORMAL` é a RAZÃO DO PARCEIRO, não uma verba: o cliente cadastra as rubricas de folha como
  //      parceiros (conferido em `APAGAR.CODPARCEIRO` dos títulos 74767 e 74769).
  102: (c) => [c.parceiro, c.documento],
  // 103 · `APAGAR DOCTO .: * * *` → 'APAGAR DOCTO .: 000074769 IRRF - FOLHA ' (o 2º é o parceiro, idem acima)
  103: (c) => [c.documento, c.parceiro, c.obs],
  // 104 · `AGRUPAMENTO CONVENIO .: *` → 'AGRUPAMENTO CONVENIO .: 000105802'
  104: (c) => [c.documento],
  // 105 · `AGRUPAMENTO CONVENIO .: *  *` → 'AGRUPAMENTO CONVENIO .: 000117847  LETICIA OLIVEIRA FREIRE'
  //      o 2º é o PARCEIRO do recebível (o funcionário), conferido em `ARECEBER.CODPARCEIRO` do 117847.
  105: (c) => [c.documento, c.parceiro],
  // 106 · `DESCONTO OBTIDO .: * * *` → 'DESCONTO OBTIDO .: 72021 BRF S.A PREVISÃO GERADA A PARTIR DO MANIFESTO…'
  //      o 3º é a OBS do título (conferida em `APAGAR.OBS` do 72021 e do 71983).
  106: (c) => [c.documentoTexto, c.parceiro, c.obs],
  // 107 · `JUROS PAGOS .* * *` → 'JUROS PAGOS .72814 UBERLANDIA REFRESCOS LTDA REFERENTE A BAIXA DO LOTE: 90767…'
  107: (c) => [c.documentoTexto, c.parceiro, c.historicoMov],
  // 112 · `NOTA FISCAL DESPESA .: *  CNPJ .: * *`
  //      'NOTA FISCAL DESPESA .: 000015349  CNPJ .: 12.680.728/0001-90 BRUNO ARANTES CARRIJO'
  112: (c) => [c.documento, c.cnpj, c.parceiro],
  // 161 · `DESCONTO CONCEDIDO LOTE.: * DOCTO.: * CLIENTE.: *`
  //      'DESCONTO CONCEDIDO LOTE.: 90408 DOCTO.: 113165 CLIENTE.: CICERO BRAZ DE LIMA'
  161: (c) => [c.lote, c.documentoTexto, c.parceiro],
  // 181 · `TROCO SOLIDARIO À PAGAR * *`
  //      'TROCO SOLIDARIO À PAGAR GRUPO LUTA PELA VIDA Conta gerada do fechamento do caixa do operador…'
  181: (c) => [c.parceiro, c.obs],
  // 182 · `A PAGAR DOCTO.: *DOCTO.: *FORNECEDOR.: *-*`
  //      'A PAGAR DOCTO.: 000059433DOCTO.: RHFORNECEDOR.: 13º SALARIO A PAGAR-GUIA INSS 13º '
  182: (c) => [c.documento, c.tipodoc, c.parceiro, c.obs],
  // 221 · `PAGTO * *` → 'PAGTO REFERENTE A BAIXA DO LOTE: 90793 - Baixa das contas a pagar… ¦'
  //      ⚠️ o segundo argumento é o caractere `¦` — constante em **5.169 de 5.169** linhas da origem 15.
  221: (c) => [c.historicoMov, '¦'],
  // 261 · `APAGAR INSS DOCTO .: * TIPO .: * *` → 'APAGAR INSS DOCTO .: 000074768 TIPO .: RH '
  261: (c) => [c.documento, c.tipodoc, c.obs],
};

/**
 * O QUE CADA CAMPO DOS ITENS DO HISTÓRICO VALE NO CONTEXTO (`ITENS_HISTORICO_CONTABIL.TABELA` + `CAMPO`, mig 294).
 *
 * ⚠️ **cada entrada tem âncora**: o mesmo par tabela/campo aparece num histórico que o mapa acima já prova contra o
 * razão, e a tradução é a que esse histórico usa — `APAGAR_BX.CODIGO_DOCUMENTO` sai CRU (91, 106, 107) e
 * `APAGAR.CODIGO` sai com 9 dígitos (21, 101-103); `ARECEBER.OBS` é a descrição do centro de custo (89, 5.895 de
 * 5.895). O teste `historico-contabil.args.spec.ts` confere que dicionário e mapa não se contradizem.
 * Par sem entrada aqui imprime vazio, como o legado quando o chamador não passa argumento. PDV fica de fora.
 */
export const CAMPO_DO_LEGADO: Record<string, (c: CtxHistorico) => ArgHist> = {
  'NF.NRO_NF': (c) => c.documento,
  'NF.CNPJ_CPF': (c) => c.cnpj,
  'NF.PARCEIRO': (c) => c.parceiro,
  'NF.CFOP': (c) => c.cfop,
  'NF.IDEMPRESA': (c) => c.loja,
  'APAGAR.CODIGO': (c) => c.documento,
  'APAGAR.FORNECEDOR': (c) => c.parceiro,
  'APAGAR.TIPO_DOCUMENTO': (c) => c.tipodoc,
  'APAGAR.OBSERVACAO': (c) => c.obs,
  'APAGAR_BX.LOTE': (c) => c.lote,
  'APAGAR_BX.TIPO_DOCUMENTO': (c) => c.tipodoc,
  'APAGAR_BX.CODIGO_DOCUMENTO': (c) => c.documentoTexto,
  'APAGAR_BX.NR_NF': (c) => c.notafiscal,
  'APAGAR_BX.FORNECEDOR': (c) => c.parceiro,
  'APAGAR_BX.OBSERVACAO': (c) => c.obs,
  'APAGAR_BX.HISTORICO': (c) => c.historicoMov,
  'ARECEBER.CODIGO': (c) => c.documento,
  'ARECEBER.OBS': (c) => c.verba,
  'ARECEBER.CLIENTE': (c) => c.parceiro,
  'ARECEBER_BX.LOTE': (c) => c.lote,
  'ARECEBER_BX.CODIGO_DOCUMENTO': (c) => c.documentoTexto,
  'ARECEBER_BX.CLIENTE': (c) => c.parceiro,
  'ARECEBER_BX.OPERADOR_BAIXA': (c) => c.usuario,
  'CARTAO_BX.LOTE': (c) => c.lote,
  'CARTAO_BX.OPERADORA': (c) => c.operadora,
  'MOV_CONTAS_BANCARIAS.TITULAR': (c) => c.conta,
  'MOV_CONTAS_BANCARIAS.HISTORICO': (c) => c.historicoMov,
  'MOV_CONTAS_BANCARIAS.IDLOTE': (c) => c.lote,
  'MOVIMENTO DE CAIXA.CODIGO': (c) => c.documento,
  'MOVIMENTO DE CAIXA.LOTE': (c) => c.lote,
  'MOVIMENTO DE CAIXA.PARCEIRO': (c) => c.parceiro,
  'MOVIMENTO DE CAIXA.CENTRO_DE_CUSTO': (c) => c.verba,
  // sem âncora no mapa, mas o 121 do cliente imprime a observação no 5º `*` ('… PARCEIRO.: SODEXO … TAXA PLUXEE')
  'MOVIMENTO DE CAIXA.OBS': (c) => c.obs,
  // cru, sem os 9 dígitos — é como o 87 o imprime ('ADIANT P/ PARCEIRO .: 3066')
  'ADIANTAMENTO PARA PARCEIROS.CODPARCEIRO': (c) => (c.codparceiro == null ? null : String(c.codparceiro)),
  'ADIANTAMENTO PARA PARCEIROS.PARCEIRO': (c) => c.parceiro,
  'ADIANTAMENTO PARA PARCEIROS.CODIGO': (c) => c.documento,
};

/**
 * os argumentos do histórico `cod` para este contexto.
 *
 * O mapa medido vence; sem entrada nele, valem os ITENS do histórico (mig 294) traduzidos por `CAMPO_DO_LEGADO`;
 * sem os dois, vazio — o template sai com os `*` em branco, como no legado quando ninguém passa argumento.
 */
export function argsDoHistorico(
  cod: number | null | undefined,
  ctx: CtxHistorico | undefined,
  itens?: readonly ItemHistoricoContabil[],
): ArgHist[] {
  if (cod == null || ctx == null) return [];
  const f = ARGS_POR_HISTORICO[Number(cod)];
  if (f) return f(ctx);
  if (!itens?.length) return [];
  return argsPelosItens(itens, (tabela, campo) => CAMPO_DO_LEGADO[`${tabela}.${campo}`]?.(ctx) ?? null);
}
