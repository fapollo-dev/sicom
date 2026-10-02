import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { paginasDoModelo } from '../src/shared/fr3/render';

/** os modelos PERSONALIZADOS da RELATORIOS da produção (as conferências do menu da NF, uNF.pas:13541-13635) */
const modelo = (arq: string) => readFileSync(resolve(__dirname, 'fixtures/relatorios', arq), 'utf8');
const agora = new Date(2026, 8, 30, 10, 5, 0);
const texto = (paginas: Array<{ html: string[] }>) => paginas.map((p) => p.html.join(' ')).join(' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const nota = { NRONF: '162189', TITULAR_RAZAO: 'LATICINIOS TREVO LTDA', TITULAR_CNPJ: '04892455000110', TITULAR_UF: 'MG', DTEMISSAO: '2026-09-08T00:00:00', CHAVENFE: '31260937954975000169550010000043561000000011' };
const empresa = { RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA', CNPJ: '37954975000169', UF: 'MG', FANTASIA: 'HIPER PINHEIRAO' };

describe('relatórios do legado com vários datasets', () => {
  it('conferência de devolução de compra: o pedido 10244 da produção, com as somas e a contagem do rodapé', () => {
    // sqqRelPedDevCompra do pedido 10244 (produção, 30/09/2026): 7 itens de 4 notas de entrada da Trevo
    const itens = [
      ['1511212', '2026-05-08T00:00:00', 6, '7896791905487', 'IOG TREVO KIDS HK TREVO MOR 480G', 9, 44.01, 5, 24.45],
      ['1524760', '2026-06-26T00:00:00', 3, '7896791904138', 'BEB LACT FERM PULSI FRUTAS 1,100G', 18, 107.82, 4, 23.96],
      ['1524760', '2026-06-26T00:00:00', 4, '7896791902615', 'IOG TREVINHO BALL PRETO/BANCO 130G', 12, 35.88, 4, 11.96],
      ['1528459', '2026-07-10T00:00:00', 1, '7896791904183', 'BEB LACT FERM PULSI TRI SAL/MOR/COCO 480G', 90, 234, 8, 20.8],
      ['1528459', '2026-07-10T00:00:00', 2, '7896791904176', 'BEB LAC FERMENTADA PULSI 480G MOR', 90, 234, 11, 28.6],
      ['1531276', '2026-07-22T00:00:00', 5, '7896791904039', 'TREVINHO PETIT SUISSE MOR 320G', 12, 58.68, 3, 14.67],
      ['1531276', '2026-07-22T00:00:00', 7, '7896791905272', 'IOG GREGO TREVO TRAD 400G', 12, 64.68, 3, 16.17],
    ].map(([NRONF, DTEMISSAO, NROITEM, CODBARRA, DESCRICAO_PRODUTO, QTD_NOTA_FISCAL, TOTAL_PRODUTO_NOTA, QTD_DEVOLVIDA, TOTAL_PRODUTO_DEVOLVIDO]) => ({
      NRONF, DTEMISSAO, NROITEM, CODBARRA, DESCRICAO_PRODUTO, QTD_NOTA_FISCAL, TOTAL_PRODUTO_NOTA, QTD_DEVOLVIDA, TOTAL_PRODUTO_DEVOLVIDO, CHAVENFE: `3126${NRONF}`,
    }));
    const pgs = paginasDoModelo(modelo('conf-pedido-devolucao-compra.fr3'), { dbdNota: [nota], dbeEmpresa: [empresa], frxDBRelPedDevCompra: itens }, agora);
    const t = texto(pgs);
    expect(pgs[0].larguraMm).toBe(297); // paisagem
    expect(t).toContain('Conferência de Devoluções de Compra');
    expect(t).toContain('HIPER PINHEIRAO LTDA'); // dbeEmpresa."RAZAOSOCIAL"
    expect(t).toContain('LATICINIOS TREVO LTDA'); // dbdNota."TITULAR_RAZAO", o cursor parado no 1º registro
    expect(t).toContain('IOG GREGO TREVO TRAD 400G');
    expect(t).toContain('08/05/2026'); // a data de cada nota de entrada (dd/mm/yyyy)
    expect(t).toContain('779,07'); // SUM(TOTAL_PRODUTO_NOTA)
    expect(t).toContain('140,61'); // SUM(TOTAL_PRODUTO_DEVOLVIDO)
    expect(t).toContain('38,00'); // SUM(QTD_DEVOLVIDA)
    expect(t).toContain('Registros: 7'); // COUNT(MasterData1)
  });

  it('conferência de impostos: a MasterData do "frmNF.dbdItensNota" percorre os itens e o rodapé soma', () => {
    const itens = [
      { CODBARRA: '7891000100103', DESCRICAO: 'LEITE COND MOCA 395G', CFOP: '1102', VRCUSTO: 5.5, QUANTIDADE: 2, FATOREMBAL: 24, VRBASECALCULO: 100, VRICM: 18, ICME: 18, CST: 0, DESCONTO: 0, VRDESCONTO: 0, VRBASEST: 0, VRICMST: 0, VRIPI: 0, DEPSACESS: 0 },
      { CODBARRA: '7891000053508', DESCRICAO: 'NESCAU 400G', CFOP: '1403', VRCUSTO: 10, QUANTIDADE: 3, FATOREMBAL: 12, VRBASECALCULO: 50.25, VRICM: 0, ICME: 0, CST: 60, DESCONTO: 0, VRDESCONTO: 0, VRBASEST: 40, VRICMST: 7.2, VRIPI: 0, DEPSACESS: 0 },
    ];
    const t = texto(paginasDoModelo(modelo('conf-impostos-nf.fr3'), { dbdNota: [nota], dbdItensNota: itens }, agora));
    expect(t).toContain('Conferencia de Impostos');
    expect(t).toContain('162189');
    expect(t).toContain('NESCAU 400G');
    expect(t).toContain('1403');
    expect(t).toContain('41,00'); // SUM(QUANTIDADE * VRCUSTO) = 11 + 30
    expect(t).toContain('150,25'); // SUM(VRBASECALCULO)
    expect(t).toContain('Registros: 2');
  });

  it('conferência de preço completa: as médias do rodapé (AVG) e o lucro calculado na linha', () => {
    const itens = [
      { CODBARRA: '1', DESCRICAO: 'A', TEMPVRCUSTO: 10, MARKUP: 30, VRVENDA: 20, DEBITOICM: 3.6, DEBITOPISCOFINS: 1.85, VRCUSTOCSI: 8, DESPOPV: 1, VRCUSTOFINALC: 10, VRCUSTOREP: 10, ULTVENDA: 19.9, ESTOQUE: 12, MARKUPL2: 25 },
      { CODBARRA: '2', DESCRICAO: 'B', TEMPVRCUSTO: 5, MARKUP: 50, VRVENDA: 10, DEBITOICM: 0, DEBITOPISCOFINS: 0, VRCUSTOCSI: 5, DESPOPV: 0, VRCUSTOFINALC: 5, VRCUSTOREP: 5, ULTVENDA: 9.9, ESTOQUE: 3, MARKUPL2: 45 },
    ];
    const t = texto(paginasDoModelo(modelo('conf-preco-nf.fr3'), { dbdNota: [nota], dbdItensNota: itens }, agora));
    expect(t).toContain('Média: 40,00%'); // AVG(MARKUP)
    expect(t).toContain('Média: 35,00%'); // AVG(MARKUPL2)
    expect(t).toContain('5,55'); // lucro final da linha A: 20 - 3,6 - 1,85 - 8 - 1
  });

  it('lista de conferência: Nota, Empresa e Itens da unit de conferência', () => {
    const t = texto(paginasDoModelo(modelo('rel-lista-conferencia-nf.fr3'), {
      Nota: [{ NRONF: '4356', RAZAO: 'LATICINIOS TREVO LTDA', CHAVENFE: nota.CHAVENFE }], Empresa: [empresa],
      Itens: [{ CODBARRA: '7896791905487', DESCRICAO: 'IOG TREVO KIDS HK TREVO MOR 480G' }],
    }, agora));
    expect(t).toContain('Lista para Conferência');
    expect(t).toContain('HIPER PINHEIRAO');
    expect(t).toContain('Número NF: 4356');
    expect(t).toContain('IOG TREVO KIDS HK TREVO MOR 480G');
  });

  it('lista de conferência usuários: o Footer vem depois do último item, com quem coletou e quem aprovou', () => {
    const pgs = paginasDoModelo(modelo('conferencia-nf-operadores.fr3'), {
      Nota: [{ NRONF: '4356', RAZAO: 'LATICINIOS TREVO LTDA', CHAVENFE: nota.CHAVENFE }], Empresa: [empresa],
      Itens: [{ CODBARRA: '7896791905487', DESCRICAO: 'IOG TREVO KIDS', NOME: 'JOAO COLETOR', OPERADORAPROVACAO: 'MARIA SUPERVISORA' }],
    }, agora);
    const t = texto(pgs);
    expect(t).toContain('JOAO COLETOR');
    expect(t).toContain('MARIA SUPERVISORA');
    expect(t.indexOf('Conferente:')).toBeGreaterThan(t.indexOf('IOG TREVO KIDS')); // o Footer1, depois dos itens
  });

  it('diferença de entradas por fornecedor: a variável Empresa e o "Página 1 de N" (TotalPages#)', () => {
    const linhas = Array.from({ length: 80 }, (_, i) => ({ RAZAO: `FORNECEDOR ${String(i + 1).padStart(2, '0')}`, QUANTIDADE_NOTA: 10, QUANTIDADE_RECEBIDA: 9, DIFERENCA: -1 }));
    const pgs = paginasDoModelo(modelo('rel-diferenca-entradas-for.fr3'), { frxDBDataset1: linhas }, agora, { Empresa: "'HIPER PINHEIRAO LTDA'" });
    const t = texto(pgs);
    expect(pgs.length).toBeGreaterThan(1);
    expect(t).toContain('Empresa(s): HIPER PINHEIRAO LTDA');
    expect(t).toContain(`Página 1 de ${pgs.length}`);
    expect(t).toContain('FORNECEDOR 80');
  });

  const notaCompleta = {
    ...nota, SERIE: '1', TIPO: 'S', CFOP: '5202', DESCCFOP: 'DEVOLUCAO DE COMPRA', DTCONTABIL: '2026-09-08T00:00:00', HORASAIDA: '10:30', STATUSNFE: 'P',
    PROTOCOLO_NFE: '131260000000001', TIPOFRETE: '9', TITULAR_TIPO: 'J', TITULAR_LOGRADOURO: 'ROD BR 050', TITULAR_CIDADE: 'UBERLANDIA', OBS: 'DEVOLUCAO PARCIAL',
    TOTALPROD: 140.61, TOTALNF: 140.61, TOTALNOTA: 140.61, TOTALBASEICM: 0, TOTALICM: 0, TOTALIPI: 0, TOTALFRETE: 0, TOTALSEGURO: 0, TOTALACESSORIAS: 0,
    TOTALICM_ST: 0, TOTALBASEICMT: 0, TOTALDESCFINAL: 0, QTDE: 38,
  };
  const empresaNf = { ...empresa, INSC: '0012345670011', NUMEITENSNOTA: 30, CLASSFISCAL: 'LR', ALQSIMPLESNAC: 0 };
  const itensNf = (qtd: number) => Array.from({ length: qtd }, (_, i) => ({ CODBARRA: String(7896791900000 + i), DESCRICAO: `ITEM DEVOLVIDO ${i + 1}`, NCMSH: '04039000',
    CST: 60, CFOP: '5202', UNIDADE: 'UN', QUANTIDADE: 1, FATOREMBAL: 1, VRCUSTO: 3.7, VRTOTALPRODUTOS: 3.7, VRBASECALCULO: 0, VRICM: 0, VRIPI: 0, ICMS: 0, IPI: 0, TOTALDESCONTOS: 0 }));

  it('imprimir nota (uRptNF da loja 2): o script compila (o typecast do SetaVisible), a chave em Code-128C, o ColumnHeader só na 1ª página e a folha N de M', () => {
    const pgs = paginasDoModelo(modelo('urptnf2.fr3'), { dbdNota: [notaCompleta], dbdItensNota: itensNf(60), dbeEmpresa: [empresaNf], frxDBDatasetAnimal: [] }, agora);
    const t = texto(pgs);
    expect(pgs.length).toBeGreaterThan(1);
    expect(t).toContain('ITEM DEVOLVIDO 60');
    expect(t).toContain(`Página 1 / ${pgs.length}`);
    expect(t).toContain('LATICINIOS TREVO LTDA');
    expect(pgs[0].html.join('')).toContain('<svg'); // o código de barras da chave
    // o ColumnHeader (natureza da operação, destinatário, impostos, transporte) só na 1ª página (ColumnHeader1OnBeforePrint)
    expect(texto([pgs[0]])).toContain('DEVOLUCAO DE COMPRA');
    expect(texto(pgs.slice(1))).not.toContain('DEVOLUCAO DE COMPRA');
    // mmTipoOnBeforePrint: saída imprime 1
    expect(t).toMatch(/\b1\b/);
  });

  it('espelho da nota: as linhas em branco completam a folha e os totais só saem na última (MasterData1.DataSet.Eof); nas outras, ----', () => {
    const pgs = paginasDoModelo(modelo('urpt-espelho-nf.fr3'), { dbdNota: [notaCompleta], dbdItensNota: itensNf(35), dbeEmpresa: [empresaNf] }, agora);
    const t1 = texto([pgs[0]]);
    const tn = texto([pgs[pgs.length - 1]]);
    expect(pgs.length).toBe(2);
    expect(t1).toContain('----');
    expect(tn).toContain('140,61');
    expect(tn).toContain('ITEM DEVOLVIDO 35');
  });

  const agendaA = { CODAGENDA: 1201, NOMEPROMO: 'OFERTAS DE OUTUBRO', FLAGPROMOCAO: 'A', DTINICIOPROMOCAO: '2026-10-01T07:00:00', DTFIMPROMOCAO: '2026-10-15T23:59:00' };

  it('imprimir a agenda (ListagemAgendaPromocao): o script põe o texto da flag e os itens saem com o preço da promoção', () => {
    const itens = [{ CODAGENDA: 1201, CODBARRA: '7891000100103', DEPTO: 'MERCEARIA', DESCRICAO: 'LEITE COND MOCA 395G', EMPRESAS: '1,2', PRECO2: 0, UNIDADE: 'UN', VLRPROMOCAO: 5.99, VRCUSTOREP: 4.1, VRVENDA: 7.49 }];
    const t = texto(paginasDoModelo(modelo('listagem-agenda-promocao.fr3'), { frxDBDatasetA: [agendaA], frxDBDatasetB: itens }, agora));
    expect(t).toContain('Flag agenda: ABERTA');
    expect(t).toContain('OFERTAS DE OUTUBRO');
    expect(t).toContain('LEITE COND MOCA 395G');
    expect(t).toContain('5,99');
  });

  it('vendidos por loja: com mais de 5 caracteres de lojas o script esconde a página do pivô e a lista agrupa por produto, com a soma de cada grupo', () => {
    const lista = [
      { CODPRODUTO: 10, CODBARRA: '1', DESCRICAO: 'ARROZ 5KG', IDEMPRESA: 1, QTDE: 3, VRVENDA: 60, VRCUSTO: 40 },
      { CODPRODUTO: 10, CODBARRA: '1', DESCRICAO: 'ARROZ 5KG', IDEMPRESA: 52, QTDE: 2, VRVENDA: 40, VRCUSTO: 26 },
      { CODPRODUTO: 11, CODBARRA: '2', DESCRICAO: 'FEIJAO 1KG', IDEMPRESA: 2, QTDE: 5, VRVENDA: 45, VRCUSTO: 30 },
    ];
    const pgs = paginasDoModelo(modelo('agenda-vendidos-por-loja.fr3'), { dbdPorLoja: lista }, agora, { QtdEmpresa: '7', Empresa: "'1,2,52'" });
    const t = texto(pgs);
    expect(t).not.toContain('Loja 3'); // a página do pivô (Page1) ficou invisível
    expect(t.match(/ARROZ 5KG/g)?.length).toBe(1); // o GroupHeader sai uma vez por produto
    expect(t).toContain('100,00'); // a soma da venda do grupo do arroz (60 + 40)
    expect(t).toContain('Empresa(s): 1,2,52');
  });

  it('vendidos por loja: com até 5 caracteres, o pivô Q/C/V das lojas 1 a 3 e o total por loja no resumo', () => {
    const pivo = [{ IDPRODUTO: 10, CODBARRAS: '1', DESCRICAO: 'ARROZ 5KG', Q1: 3, C1: 40, V1: 60, Q2: 1, C2: 13, V2: 20, Q3: 0, C3: 0, V3: 0 },
      { IDPRODUTO: 11, CODBARRAS: '2', DESCRICAO: 'FEIJAO 1KG', Q1: 0, C1: 0, V1: 0, Q2: 5, C2: 30, V2: 45, Q3: 0, C3: 0, V3: 0 }];
    const t = texto(paginasDoModelo(modelo('agenda-vendidos-por-loja.fr3'), { dbdPorLoja: pivo }, agora, { QtdEmpresa: '3', Empresa: "'1,2'" }));
    expect(t).toContain('Loja 3');
    expect(t).toContain('65,00'); // SUM(V2) = 20 + 45
  });

  it('produtos inativos: o CheckBox de mídia segue o campo pelo script', () => {
    const pgs = paginasDoModelo(modelo('agenda-produtos-inativos.fr3'), { dbdRelProdAtivo: [{ CODBARRA: '1', DESCRICAO: 'ARROZ 5KG', DEPTO: 'MERCEARIA', UNIDADE: 'UN', VRVENDA: 20, VLRPROMOCAO: 17.9, TV: 'T', RADIO: 'F', TABLOIDE: 'F', INTERNO: 'F', ATUALIZACAO_GRUPO: 'N' }] }, agora, {}, { Agenda: 'Agenda: 1201 - OFERTAS DE OUTUBRO', Empresas: 'Empresa: 1' });
    const html = pgs.map((p) => p.html.join('')).join('');
    expect(texto(pgs)).toContain('Agenda: 1201 - OFERTAS DE OUTUBRO');
    expect(html.match(/✓/g)?.length).toBe(1); // só a TV marcada
  });

  it('produtos vendidos (ven2_01): o HasField do OnStartReport mantém o total de descontos, as variáveis do CalculaTotais e o % pela config', () => {
    const linhas = [{ IDEMPRESA: 1, CODBARRA: '1', DESCRICAO: 'ARROZ 5KG', QTDE: 10, UNIDADE: 'UN', TOTAL_VENDA: 200, TOTAL_CUSTO: 150, DESC_PROMOCAO: 12.5, MARGEM: 33.33, VRVENDA_UNI: 21.25, VRCUSTO_UNI: 15, DEPTO: 'MERCEARIA', GRUPO: 'GRAOS', SUBGRUPO: 'ARROZ' }];
    const t = texto(paginasDoModelo(modelo('ven2-01-produtos-vendidos.fr3'), { dbdConsulta: linhas }, agora,
      { DtInicial: "'01/10/2026'", DtFinal: "'15/10/2026'", HrInicial: "'07:00'", HrFinal: "'23:59'", Empresa: "'1'", TOTAL_VENDA: '200', LUCRO_BRUTO: '50', MARGEM_BRUTA: '75', LUCRO_BRUTO_PERC: '25' },
      { SysMemo10: '[iif(<dbdConsulta."TOTAL_CUSTO"> > 0, ((<dbdConsulta."TOTAL_VENDA"> / <dbdConsulta."TOTAL_CUSTO">) - 1) * 100, 0)]%' }));
    expect(t).toContain('Total Descontos:');
    expect(t).toContain('12,50');
    expect(t).toContain('Periodo: 01/10/2026 até 15/10/2026 das 07:00 às 23:59');
    expect(t).toContain('33,33'); // o markup da linha pelo SysMemo10 trocado (200/150 − 1)
  });

  it('scrap (extr - Scrap): a DetailData dos itens roda sob o mestre e o grupo soma a quantidade e o total', () => {
    const pgs = paginasDoModelo(modelo('extr-scrap.fr3'), {
      frxDBScrap: [{ CODSCRAP: 42, DT_CADASTRO: '2026-09-30T00:00:00', DESCCODPLC: '3.1', DESCRICAO: 'PERDAS HORTIFRUTI', OBS: 'VENCIDOS' }],
      frxDBScrapitem: [
        { IDPRODUTO: 10, CODBARRA: '1', DESCRICAO: 'BANANA KG', QTDE: 3, ORIGEM: 'L', MOTIVO: 'V', VR_CUSTO: 2, TOTAL: 6.3 },
        { IDPRODUTO: 11, CODBARRA: '2', DESCRICAO: 'TOMATE KG', QTDE: 2, ORIGEM: 'L', MOTIVO: 'V', VR_CUSTO: 4, TOTAL: 8.2 },
      ],
      frxDBEmpresa: [{ FANTASIA: 'HIPER PINHEIRAO', CNPJ: '37954975000169', CIDADE: 'UBERLANDIA', UF: 'MG' }],
    }, agora);
    const t = texto(pgs);
    expect(t).toContain('PERDAS HORTIFRUTI');
    expect(t).toContain('BANANA KG');
    expect(t).toContain('TOMATE KG');
    expect(t).toContain('14,50'); // SUM(TOTAL, DetailData1) no rodapé do grupo
  });

  it('ficha kardex (Rel_FichaKardex): a data com a HORA do movimento, a saída negativa e a empresa do login no cabeçalho', () => {
    const pgs = paginasDoModelo(modelo('rel-ficha-kardex.fr3'), {
      frxDBDtsHistoricoProd: [
        { DATA: '2026-09-25T07:05:45', HISTORICO: 'BAIXA DE ESTOQUE DERIVADO DO PDV PEDIDO: 21250926070426 NFC-e 9282--Serie 21', ENTRADA: 0, SAIDA: -0.126, QTDE_ATUAL: 18242.123, CODBARRA: '2000001', DESCRICAO: 'BANANA PRATA KG', UNIDADE: 'KG' },
        { DATA: '2026-09-25T10:00:00', HISTORICO: 'ENTRADA DE ESTOQUE; REF. NOTA COD: 5 NF-E 162189--SERIE 1', ENTRADA: 120, SAIDA: 0, QTDE_ATUAL: 18362.123, CODBARRA: '2000001', DESCRICAO: 'BANANA PRATA KG', UNIDADE: 'KG' },
      ],
      frxDBDtsEmpresa: [{ ...empresa, INSC: '0012345', FONE1: '3432293291', ENDERECO: 'AV BRASIL', BAIRRO: 'CENTRO', CIDADE: 'UBERLANDIA' }],
    }, agora, { DtInicial: "'25/09/2026'", DtFinal: "'25/09/2026'" });
    const t = texto(pgs);
    expect(t).toContain('25/09/2026 07:05:45');
    expect(t).toContain('-0,13');
    expect(t).toContain('NFC-e 9282--Serie 21');
    expect(t).toContain('HIPER PINHEIRAO LTDA');
    expect(t).toContain('BANANA PRATA KG');
  });

  it('histórico de vendas/pedidos e de entradas: o período e a Empresa do botão, a data-hora da venda e o total de itens do rodapé', () => {
    const v = texto(paginasDoModelo(modelo('rel-historico-vendas-pedidos.fr3'), {
      frxDBDtsVendas: [
        { DTVENDA: '2026-09-10T10:00:00', NROPEDIDO: '285A', VRVENDA: 5, QTDE: 2, TOTAL: 10, PROMOCAO: 'N', RAZAO: 'CONSUMIDOR', RAZAO_1: 'VENDEDOR 1', CODBARRA: '7899000992850', DESCRICAO: 'HIST285 KIT' },
        { DTVENDA: '2026-09-11T11:00:00', NROPEDIDO: '285B', VRVENDA: 7, QTDE: 1, TOTAL: 7, PROMOCAO: 'S', RAZAO: 'CONSUMIDOR', RAZAO_1: null, CODBARRA: '7899000992850', DESCRICAO: 'HIST285 KIT' },
      ],
    }, agora, { DtInicial: "'01/09/2026'", DtFinal: "'30/09/2026'", Empresa: '1' }));
    expect(v).toContain('01/09/2026 até 30/09/2026');
    expect(v).toContain('Empresa(s): 1');
    expect(v).toContain('10/09/2026 10:00:00');
    expect(v).toContain('VENDEDOR 1');
    expect(v).toContain('3,00'); // Total Itens: SUM(QTDE) %2.2f
    const e = texto(paginasDoModelo(modelo('rel-historico-entradas.fr3'), {
      frxDBDtsEntradas: [{ DTEMISSAO: '2026-09-05T00:00:00', NRONF: '285001', QUANTIDADE: 2, QTDEMBAL: 12, VRCUSTO: 10, TOTAL: 20, RAZAO: 'LATICINIOS TREVO LTDA', PROC: 'PROCESSADA', CODBARRA: '7899000992850', DESCRICAO: 'HIST285 KIT' }],
    }, agora, { DtInicial: "'01/09/2026'", DtFinal: "'30/09/2026'", Empresa: '1' }));
    expect(e).toContain('285001');
    expect(e).toContain('12,00'); // o qtdEmbal do layout casa com o QTDEMBAL do servidor
    expect(e).toContain('PROCESSADA');
  });

  it('inventário rotativo do produto e composição: o frxDBPadrao com a diferença do lote, e os memos do cabeçalho trocados pelo produto', () => {
    const i = texto(paginasDoModelo(modelo('rel-cad-prod-hist-invrot.fr3'), {
      frxDBPadrao: [{ LOTE: 73, DIFERENCA_QTD: -3, DATA: '2026-05-28T00:00:00', CODBARRA: '7899000992850', DESCRICAO: 'HIST285 KIT' }],
    }, agora, { DtInicial: "'01/05/2026'", DtFinal: "'31/05/2026'", Empresa: '1' }));
    expect(i).toContain('HISTÓRICO DE INVENTÁRIO ROTATIVO');
    expect(i).toContain('7899000992850 - HIST285 KIT');
    expect(i).toContain('28/05/2026');
    expect(i).toContain('-3');
    const c = texto(paginasDoModelo(modelo('rel-composicao-produto.fr3'), {
      frxDBDComposicao: [{ CODBARRA: '7899000992849', DESCRICAO: 'HIST285 FILHO', QTDE: 2 }],
    }, agora, {}, { memoCodBarra: '7899000992850', memoDescricao: 'HIST285 KIT' }));
    expect(c).toContain('HIST285 KIT');
    expect(c).toContain('7899000992850');
    expect(c).not.toContain('Produto Teste');
    expect(c).toContain('HIST285 FILHO');
  });

  it('trocas do pedido de compra (PedCompraTrocas): o script lista os campos do dataset (GetFieldList), acha as colunas EMP (FindObject) e as liga', () => {
    const pgs = paginasDoModelo(modelo('pedcompra-trocas.fr3'), {
      FDBTrocas: [{ IDPRODUTO: 992861, CODIGOBARRA: '7899000992861', DESCRICAO: 'PROD 286', DATA: '2026-09-20T00:00:00', EMP1: 3, EMP2: 2 }],
      FDBPedidoCompra: [{ CODPEDCOMP: 4321, DATA: '2026-09-30T00:00:00', DT_VENCIMENTO: '2026-10-30T00:00:00', RAZAO: 'FORNECEDOR 286' }],
    }, agora);
    const t = texto(pgs);
    expect(t).toContain('TROCAS PENDENTES');
    expect(t).toContain('Pedido de compra: 4321');
    expect(t).toContain('FORNECEDOR 286');
    expect(t).toContain('PROD 286');
    expect(t).toContain('Emp 1');
    expect(t).toContain('Emp 2');
    expect(t).not.toContain('Emp 3');
    // as quantidades das lojas saem nos memos que o script ligou
    expect(t).toContain('20/09/2026 3,00 2,00');
  });

  it('pendências do fornecedor e conferência de preço do pedido: as grades com o cabeçalho da tela', () => {
    const p = texto(paginasDoModelo(modelo('pedcompra-pendencias-fornecedor.fr3'), {
      FDBPendenciasFornecedor: [{ CODRCB: 1, DUPLICATA: 'DUP286', DTVENDA: '2026-09-01T00:00:00', DTVENC: '2026-09-29T00:00:00', VALOR: 50, CODEMPRESA: 2, CENTRO_CUSTO: 'CLIENTES' }],
      FDBPedidoCompra: [{ CODPEDCOMP: 4321, DATA: '2026-09-30T00:00:00', DT_VENCIMENTO: '2026-10-30T00:00:00', RAZAO: 'FORNECEDOR 286' }],
    }, agora));
    expect(p).toContain('DUP286');
    expect(p).toContain('FORNECEDOR 286');
    expect(p).toContain('29/09/2026');
    const c = texto(paginasDoModelo(modelo('conf-preco-pedcomp.fr3'), {
      frxDBDataset2: [{ CODBARRA: '7899000992861', DESCRICAO: 'PROD 286', VRVENDA: 4.99 }],
      frxDBDataset3: [{ CODPEDCOMP: 4321, DATA: '2026-09-30T00:00:00', RAZAO: 'FORNECEDOR 286' }],
    }, agora));
    expect(c).toContain('Conferencia de preço');
    expect(c).toContain('PROD 286');
    expect(c).toContain('4321');
  });

  it('ficha cadastral do parceiro: os sub-relatórios (Page2 endereços, Page3 referências) saem dentro das bandas, não como páginas soltas', () => {
    const pgs = paginasDoModelo(modelo('ficha-cadastral-parceiro.fr3'), {
      frxDBDatasetParceiro: [{ RAZAO: 'CLIENTE 287', FANTASIA: 'C287', DTNASCIMENTO: '1980-02-29T00:00:00', CREDITO: 500, OBS: 'BOM PAGADOR', EMPRESATRABALHA: 'FIRMA X', CODREF: 'R1' }],
      frxDBDatasetEnd: [
        { ENDERECO: 'RUA PADRAO', BAIRRO: 'CENTRO', CIDADE: 'CIDADE A', UF: 'MG', CEP: '38400000', CNPJ_CPF: '111.444.777-35', RG_INSC: 'MG123', TELEFONE: '3432', FAX: '' },
        { ENDERECO: 'RUA DOIS', BAIRRO: 'BAIRRO B', CIDADE: 'CIDADE B', UF: 'MG', CEP: '38400001', CNPJ_CPF: '222.555.888-46', RG_INSC: '', TELEFONE: '', FAX: '' },
      ],
      frxDBDatasetRel: [{ TIPOREL: 'AVALISTA', NOME: 'FULANO AVALISTA', DOC1: 'DOC-1', DOC2: '', TELEFONE: '', CELULAR: '' }],
      frxDBDataset1: [empresa],
    }, agora);
    const t = texto(pgs);
    expect(pgs.length).toBe(1);
    expect(t).toContain('Razao: CLIENTE 287');
    expect(t).toContain('Empresa em que trabalha: FIRMA X');
    expect(t).toContain('RUA PADRAO');
    expect(t).toContain('RUA DOIS');
    expect(t).toContain('FULANO AVALISTA');
    expect(t.indexOf('RUA DOIS')).toBeLessThan(t.indexOf('FULANO AVALISTA'));
  });

  it('histórico financeiro: o grupo por TIPO com o total do grupo, e o SALDO vazio como o dataset da consulta do legado', () => {
    const t = texto(paginasDoModelo(modelo('historico-financeiro.fr3'), {
      frxDBDatasetDados: [
        { TIPO: 'ARECEBER', CODPARCEIRO: 992887, RAZAO: 'CLIENTE 287', DTVENDA_COMPRA: '2026-08-01T00:00:00', DTVENC: '2026-08-23T00:00:00', VALOR: 100, TXJUROS: 3, TOTAL_COM_JUROS: 104, DUPLICATA: 'D1', SALDO: null, SALDO_COM_JURO: null, VALOR_COM_JURO: null, CODNOVORCB: 0 },
        { TIPO: 'ARECEBER', CODPARCEIRO: 992887, RAZAO: 'CLIENTE 287', DTVENDA_COMPRA: '2026-08-02T00:00:00', DTVENC: '2026-10-12T00:00:00', VALOR: 50, TXJUROS: 0, TOTAL_COM_JUROS: 50, DUPLICATA: 'D2', SALDO: null, SALDO_COM_JURO: null, VALOR_COM_JURO: null, CODNOVORCB: 0 },
        { TIPO: 'APAGAR', CODPARCEIRO: 992887, RAZAO: 'CLIENTE 287', DTVENDA_COMPRA: '2026-08-03T00:00:00', DTVENC: '2026-10-07T00:00:00', VALOR: -40, TXJUROS: 0, TOTAL_COM_JUROS: 0, DUPLICATA: 'AP287', SALDO: null, SALDO_COM_JURO: null, VALOR_COM_JURO: null, CODNOVORCB: 0 },
      ],
      frxDBDataset1: [empresa],
    }, agora));
    expect(t).toContain('992887 - CLIENTE 287');
    expect(t).toContain('Total ARECEBER');
    expect(t).toContain('150');
    expect(t).toContain('Total APAGAR');
    expect(t).toContain('AP287');
  });

  it('cartão do cliente: a razão, o CPF do endereço e o código de barras Code-128A do CODPARCEIRO', () => {
    const pgs = paginasDoModelo(modelo('cliente-cartao.fr3'), {
      frxDBDatasetParceiro: [{ RAZAO: 'CLIENTE 287' }],
      frxDBDatasetEnd: [{ CODPARCEIRO: 992887, CNPJ_CPF: '111.444.777-35' }],
    }, agora);
    const html = pgs.map((p) => p.html.join('')).join('');
    expect(texto(pgs)).toContain('CLIENTE 287');
    expect(texto(pgs)).toContain('CPF: 111.444.777-35');
    expect(html).toContain('<svg');
  });
});
