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

  it('extrato e reimpressão da devolução de vendas: o endereço montado pelo script (try/iif), o item com o devolvido e o título auxiliar', () => {
    const item = { NROPEDIDO: 'P992890', NROCUPOM: 992890, CLIENTE: 'CONSUMIDOR', DTVENDA: '2026-09-10T09:00:00', CODBARRA: '7899000992890', DESCRICAO: 'DEV 288', UNIDADE: 'UN',
      QTDE_DEVOLVIDO: 2, VRVENDA: 10, TOTAL_ITEM_DEVOLVIDO: 18, DESC_ACRE_DEVOLVIDO: -2, ALIQUOTA: 'T01', ENDERECO: 'RUA A', NUMERO: 12, COMPLEMENTO: 'AP 3',
      BAIRRO: 'CENTRO', CIDADE: 'UBERLANDIA', UF: 'MG', CEP: '38400000', TELEFONE: '3432', CELULAR: '' };
    const e = texto(paginasDoModelo(modelo('ven-devolucao-vendas.fr3'), { frxDBDtsDevolucaoVendas: [item], frxDBDtsEmpresa: [empresa] }, agora,
      { USUARIO: "'OPERADOR SMOKE'", TITULO_AUXILIAR: "'Extrato de devolução de vendas'" }));
    expect(e).toContain('RUA A, 12');
    expect(e).toContain('Complemento: AP 3');
    expect(e).toContain('DEV 288');
    expect(e).toContain('18,00');
    const r = texto(paginasDoModelo(modelo('ven-itens-devolvidos.fr3'), {
      frxDBDtsItensReimpressao: [{ ...item, QTDE: 1, TOTAL_ITEM_DEVOLVIDO: 9, DATADEVOLUCAO: '2026-10-01T19:06:29', OPERADOR: 'ANGELA', NOME_VENDEDOR: 'CAIXA 1', NUMERO: 0, COMPLEMENTO: '' }],
      frxDBDtsEmpresa: [empresa],
    }, agora, { USUARIO: "'OPERADOR SMOKE'", OCULTARCAMPOS: "'N'" }));
    expect(r).toContain('DEV 288');
    expect(r).toContain('9,00');
    expect(r).not.toContain('RUA A,');
  });

  it('análise de NF (situação tributária): o detalhe de cada nota no sub-relatório (ligado ao mestre), os totalizadores e a nota em vermelho quando o total diverge do rateio', () => {
    const pgs = paginasDoModelo(modelo('nf-analise-tributaria.fr3'), {
      frxDBDatasetNF: [{ NRONF: '289001', CODNF: 1, DTEMISSAO: '2061-01-10T00:00:00', TOTALPROD: 38, TOTALNF: 38, RAZAO: 'FORN A', CODPARCEIRO: 2 }, { NRONF: '289002', CODNF: 2, DTEMISSAO: '2061-01-10T00:00:00', TOTALPROD: 30, TOTALNF: 30, RAZAO: 'FORN B', CODPARCEIRO: 2 }],
      frxDBDatasetCFOP: [{ CFOP: '1102', DESCRICAO: 'COMPRA', VALOR: 20, TOTAL: 38, __MESTRE: 0 }, { CFOP: '1403', DESCRICAO: 'COMPRA ST', VALOR: 18, TOTAL: 38, __MESTRE: 0 }, { CFOP: '1102', DESCRICAO: 'COMPRA', VALOR: 30, TOTAL: 30, __MESTRE: 1 }],
      frxDBDatasetCodCOntabil: [{ CODCONTABIL: 0, DESCRICAO: null, VALOR: 38, TOTAL: 38, __MESTRE: 0 }, { CODCONTABIL: 0, DESCRICAO: null, VALOR: 25, TOTAL: 25, __MESTRE: 1 }],
      frxDBDatasetICME: [{ ICME: 7, VALOR: 18, TOTAL: 38, __MESTRE: 0 }, { ICME: 18, VALOR: 20, TOTAL: 38, __MESTRE: 0 }, { ICME: 18, VALOR: 30, TOTAL: 30, __MESTRE: 1 }],
      frxDBDatasetCFOP_T: [{ CFOP: '1102', DESCRICAO: 'COMPRA', TOTAL: 68 }, { CFOP: '1403', DESCRICAO: 'COMPRA ST', TOTAL: 38 }],
      frxDBDatasetCodCOntabil_T: [{ CONTABIL: 0, DESCRICAO: null, TOTAL: 63 }],
      frxDBDatasetICME_T: [{ ICME: 7, TOTAL: 18 }, { ICME: 18, TOTAL: 50 }],
      frxDBDataset1: [{ CODEMPRESA: 1, RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA' }],
    }, agora, { PERIODO: "'Período de 10/01/2061 até 10/01/2061'" });
    const html = pgs.map((p) => p.html.join(' ')).join(' ');
    const t = texto(pgs);
    // a nota 1 com os 2 CFOPs dela (uma vez só — o sub-relatório percorre o detalhe e o laço de fora acaba), a nota 2 com o dela
    expect(t).toContain('289001 10/01/2061 2 - FORN A CFOP: 1102 - COMPRA 20,00 CFOP: 1403 - COMPRA ST 18,00 Cod. Contábil: 0 - 38,00');
    expect(t).toContain('289002 10/01/2061 2 - FORN B CFOP: 1102 - COMPRA 30,00 Cod. Contábil: 0 - 25,00');
    expect(t).toContain('1102 - COMPRA 68,00');
    expect(t).toContain('Total: 63,00');
    expect((html.match(/color:#ff0000/g) ?? []).length).toBe(3);
  });

  it('análise de NF (conferência): as notas alteradas com quem alterou e as empresas', () => {
    const t = texto(paginasDoModelo(modelo('nf-analise-conferencia.fr3'), {
      frxDBConsulta: [{ CODNF: 2, DTCONTABIL: '2061-01-10T00:00:00', NRONF: '289002', RAZAO: 'FORN B', TOTALNF: 30, NOME: 'OPERADOR SMOKE' }],
    }, agora, { PERIODO: "'Período de 10/01/2061 até 10/01/2061'", EMPRESAS: "'Empresa(s):1'" }));
    expect(t).toContain('289002');
    expect(t).toContain('OPERADOR SMOKE');
    expect(t).toContain('Empresa(s):1');
  });

  it('análise de precificação: o grupo por nota, o total geral das notas acumulado pelo script (<TotalNF>) e o agrupado por fornecedor', () => {
    const item = (nro: string, cod: number, tot: number, totv: number, ml2: number) => ({ NRONF: nro, CODPRODUTO: cod, DESCRICAO: `PRECO ${cod}`, VRCUSTO: 2.1, VRVENDA: 3, MARKUP: 30,
      MARKUPL2: ml2, QTDE: 5, QUANTIDADE: 2, FATOREMBAL: 6, ULTCUSTO: 2, ULTVENDA: 3, MARKUPFIXO: 0, DTEMISSAO: '2061-02-10T00:00:00', DTCONTABIL: '2061-02-10T00:00:00',
      TOTALNF: tot, CFOP: '1102', IDEMPRESA: 1, FORNECEDOR: 2, RAZAO: 'FORN A', TOTALNF_VENDA: totv });
    const t = texto(paginasDoModelo(modelo('nf-analise-preco.fr3'), {
      frxDBnfPreco: [item('290001', 992901, 50, 36, 20), item('290001', 992902, 50, 10, 40), item('290002', 992901, 12, 12, 10)],
      frxDBDataset1: [{ CODEMPRESA: 1, RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA' }],
    }, agora, { PERIODO: "'Período de 10/02/2061 até 10/02/2061   DEPTO: '", DEPARTAMENTO: "''" }));
    expect(t).toContain('Nro. NF: 000290001');
    expect(t).toContain('PRECO 992902');
    expect(t).toContain('Total geral nf: 62'); // 50 (nota 1) + 12 (nota 2), no GroupHeader
    const f = texto(paginasDoModelo(modelo('nf-analise-preco-fornecedor.fr3'), {
      frxDBFornecedor: [{ NRONF: '290001', DTEMISSAO: '2061-02-10T00:00:00', DTCONTABIL: '2061-02-10T00:00:00', RAZAO: 'FORN A', TOTALNF: 50, CODNF: 1, FORNECEDOR: 2, CFOP: '1102', IDEMPRESA: 1, TOTALNF_VENDA: 46, MARKUP_TESTE: 30 }],
      frxDBnfPreco: [{ CFOP: '1102' }],
      frxDBDataset1: [{ CODEMPRESA: 1, RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA' }],
    }, agora, { PERIODO: "'Período de 10/02/2061 até 10/02/2061'" }));
    expect(f).toContain('Nro. NF: 000290001');
    expect(f).toContain('Total Venda:46');
  });

  it('análise de NF (formas de pagamento, CST e ICMS-ST): as parcelas pelo fornecedor, o CST por nota e o ICMS-ST a recolher com os totais', () => {
    const fp = texto(paginasDoModelo(modelo('nf-analise-formas-pagamento.fr3'), {
      frxFormasPagto: [{ CODFORNECEDOR: 2, FORNECEDOR: 'FORN A', NRONF: '291001', DTEMISSAO: '2061-03-10T00:00:00', IDEMPRESA: 1, MODALIDADE: 'A PAGAR', NRO_PARCELA: '1 DE 2', TIPO: 'E', TOTALNF: 130, VALOR_FAT: 65 },
        { CODFORNECEDOR: 2, FORNECEDOR: 'FORN A', NRONF: '291001', DTEMISSAO: '2061-03-10T00:00:00', IDEMPRESA: 1, MODALIDADE: 'A PAGAR', NRO_PARCELA: '2 DE 2', TIPO: 'E', TOTALNF: 130, VALOR_FAT: 65 }],
    }, agora, { PERIODO: "'Período de 10/03/2061 até 10/03/2061'" }));
    expect(fp).toContain('FORN A');
    expect(fp).toContain('1 DE 2');
    expect(fp).toContain('2 DE 2');
    const cst = texto(paginasDoModelo(modelo('nf-analise-por-cst.fr3'), {
      frxDBConsulta: [{ IDEMPRESA: 1, CODIGO: 2, PARCEIRO: 'FORN A', NRONF: '291001', DTCONTABIL: '2061-03-10T00:00:00', VLRTOTAL: 100, TOTALNF: 130, VRBASECALCULO: 50, VLR_RED_BC: 50, VRICM: 9,
        ALIQUOTA: '18', CFOP: '1102', CST: 20, TOTALPROD: 130, TOTALACESSORIAS: 0, TOTALIPI: 0, TOTALICM_ST: 0, TOTALDESC: 0 }],
    }, agora, { PERIODO: "'Período de 10/03/2061 até 10/03/2061'", EMPRESAS: "'Empresa(s):1'" }));
    expect(cst).toContain('291001');
    expect(cst).toContain('FORN A');
    const st = texto(paginasDoModelo(modelo('nf-analise-icms-st.fr3'), {
      frxDBConsulta: [{ NRONF: '291001', DTCONTABIL: '2061-03-10T00:00:00', CNPJ_DESTINATARIO: '37954975000169', RAZAO_DESTINATARIO: 'HIPER PINHEIRAO', UF_DESTINATARIO: 'MG',
        CNPJ_REMETENTE: '04892455000110', RAZAO_REMETENTE: 'FORN A', UF_REMETENTE: 'SP', CODBARRA: '7899000992911', DESCRICAO: 'CST 291 ST', NCM: '22021000', QUANTIDADE: 3, VALOR: 30, MVA: 40,
        ALIQ_CREDITO: 12, ALIQ_INTERNA: 18, ICMS_OPERACAO_BC: 0, ICMS_OPERACAO_VALOR: 0, ICMS_ST_BC: 40, ICMS_ST_VALOR: 7, ICMS_ST_RECOLHER: 5, MVA_AJUSTADO: 0, ICMS_ST_PAGO_FONTE: 0, ICMS_ST_APAGAR: 0 }],
    }, agora, { PERIODO: "'Período de 10/03/2061 até 10/03/2061'", EMPRESAS: "'Empresa(s):1'" }));
    expect(st).toContain('CST 291 ST');
    expect(st).toContain('5,00');
  });

  it('consulta de histórico de vendas: o cupom com as finalizadoras no sub-relatório e o desconto/acréscimo no total, o pedido de balcão e o vale-troca', () => {
    const emp = [{ RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA', CNPJ: '37954975000169', FANTASIA: 'HIPER PINHEIRAO', CIDADE: 'BELO HORIZONTE', UF: 'MG' }];
    const item = (n: number, desc: string, qtde: number, vr: number, promo: number, canc = '') => ({
      NROPEDIDO: '29150362100000', NROCUPOM: 29201, NROITEM: n, CLIENTE: 'CLIENTE 292', VENDEDOR: 'VENDEDOR 292', NOME: 'OPERADOR 7', DTVENDA: '2062-03-15T10:00:00',
      CODBARRA: '7899000992920', DESCRICAO: desc, UNIDADE: 'UN', QTDE: qtde, VRVENDA: vr, TOTAL: qtde * vr, TOTAL_ITEM: qtde * vr - promo, ALIQUOTA: 'T',
      DESC_PROMOCAO: promo, CANCITEM: canc, CANC: '', DESCONTO: -0.5,
    });
    const c = texto(paginasDoModelo(modelo('rel-consulta-vendas-cupom.fr3'), {
      frxDBDtsConsVendasCupom: [item(1, 'ARROZ 292', 2, 10, 1), item(2, 'FEIJAO 292', 3, 5, 0), item(3, 'CAFE 292', 1, 7, 0, 'CANCELADO')],
      frxDBDatasetCaixa: [{ OPERACAO: 'DINHEIRO', VALOR: 34.5 }],
      frxDBDatasetEmpresa: emp,
    }, agora, { TITULO: "'VENDA'" }));
    expect(c).toContain('VENDA');
    expect(c).toContain('ARROZ 292');
    expect(c).toContain('CANCELADO');
    expect(c).toContain('OPERADOR 7');
    expect(c).toContain('DINHEIRO'); // o sub-relatório das finalizadoras, dentro da banda
    expect(c).toContain('Sub-Total Pedido: 42,00'); // SUM(TOTAL) = 20 + 15 + 7 (o cancelado entra, como no cds do legado)
    expect(c).toContain('Desconto/Acrescimo: -0,50 Total Pedido: 41,50');
    expect(c).toContain('DINHEIRO 34,50');
    const h = texto(paginasDoModelo(modelo('rel-consulta-historico-vendas.fr3'), {
      frxDBDtsConsHistVendas: [{ NROPEDIDO: '292P', NROCUPOM: 0, CLIENTE: 'CLIENTE 292', VENDEDOR: null, NOME: 'OPERADOR 7', DTVENDA: '2062-03-15T09:00:00', CODBARRA: '7899000992920',
        DESCRICAO: 'BALCAO 292', UNIDADE: 'UN', QTDE: 2, VRVENDA: 4, TOTAL: 8, TOTAL_ITEM: 8, ALIQUOTA: 'T01' }],
      frxDBDatasetEmpresa: emp,
    }, agora, { TITULO: "'PEDIDO'" }));
    expect(h).toContain('PEDIDO');
    expect(h).toContain('Nro.Pedido: 292P');
    expect(h).toContain('BALCAO 292');
    const v = texto(paginasDoModelo(modelo('rel-consulta-vendas-cupom-vale-troca.fr3'), {
      frxDBDtsConsVendasCupomTkt: [{ ...item(1, 'ARROZ 292', 2, 10, 1), QTD_TROCA: 2 }],
      frxDBDatasetEmpresa: emp,
    }, agora, { TITULO: "'VALE TROCA'" }));
    expect(v).toContain('VALE TROCA');
    expect(v).toContain('ARROZ 292');
    expect(v).not.toContain('FEIJAO 292');
  });

  it('fechamento de caixa: a análise totalizada (Σ por operação, os totais com Suprimentos/Sangrias) e a descritiva, o comprovante de quebra e o histórico', () => {
    const l = (op: string, h: string, v: number) => ({ OPERACAO: op, DATA: `2063-04-10T${h}:00`, DATA_MOV: '2063-04-10T00:00:00', CODOPERADORA: 7, NOME: 'MARIA', NROPDV: 81, VALOR: v, SANGRIAS: null, SUPRIMENTOS: null });
    const dados = [l('DINHEIRO', '08:00', 45), l('DINHEIRO', '10:00', 20), l('PIX', '09:00', 30)];
    const emp = [{ RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA', FANTASIA: 'HIPER', CNPJ: '37954975000169', INSC: '001', ENDERECO: 'RUA A', FONE1: '3433' }];
    const tot = texto(paginasDoModelo(modelo('fec-totalizado-vendas.fr3'), { frxDBDatasetDados: dados, FRXempresas: emp }, agora));
    expect(tot).toContain('RELATÓRIO DE FECHAMENTO DE CAIXA');
    expect(tot).toContain('INSC: 001');
    expect(tot).toContain('Nº do PDV : 81'); // o "000" é de um memo sem Kind: sai como texto
    expect(tot).toContain('DINHEIRO R$ 65,00 PIX R$ 30,00');
    expect(tot).toContain('Total Geral: R$ 95,00 Suprimentos: R$ 0,00 Sangrias: R$ 0,00');
    const des = texto(paginasDoModelo(modelo('fec-descritivo-vendas.fr3'), { frxDBDatasetDados: dados }, agora));
    expect(des).toContain('Operador: 7 - MARIA Caixa: 81 DINHEIRO 45,00 10/04/2063 20,00 10/04/2063 PIX 30,00 10/04/2063 Total: 95,00');
    const qb = texto(paginasDoModelo(modelo('comprovante-quebra-caixa.fr3'), { FDBComprovanteQuebra: [{ NOME: 'MARIA', CODPDV: 81, DATAFECHAMENTO: '2063-04-10T00:00:00', SALDO: -7.25 }] }, agora));
    expect(qb).toContain('Eu, MARIA, reconheço a quebra de caixa do PDV 81, no dia 10/04/2063, no valor de 7,25 reais.');
    const hi = texto(paginasDoModelo(modelo('rel-historico-finalizadoras.fr3'), { frxDBHistorico: [{ CODHIST: 1, HISTORICO: 'ALTEROU O CARTAO', NOME: 'MARIA', DATA: '2063-04-10T12:00:00' }] }, agora));
    expect(hi).toContain('10/04/2063 12:00:00 ALTEROU O CARTAO MARIA');
  });

  it('fechamento de caixa: a lista do diálogo de documentos nos layouts doc_fin (cartão, ticket com o líquido, sangria com a variável Dtfinal do layout)', () => {
    const v = { DtInicial: "'12/05/2064'", DtFinal: "'12/05/2064'", Empresa: "'HIPER PINHEIRAO LTDA'" };
    const car = texto(paginasDoModelo(modelo('fec-doc-fin-car.fr3'), { frxdbdtstDocs: [
      { CODVENDCARTAO: 11, NROCUPOM: '5', DTVENDA: '2064-05-12T09:00:00', VALOR: 50, CODOPERADOR: 7, CODPDV: 82, OPERADORA: 'VISA', CODOPERADORA: 1, IDEMPRESA: 1, NROPEDIDO: '82120564090000',
        IDPGTO: 3, LIBERADO: 'N', CONSILIADO: null, NROPARCELA: 1, CHAVE: '82120564080000', DTCADASTRO: '2064-05-12T09:01:00', USULTALTERACAO: null, DTULTIMALTERACAO: null, OBS: 'CARTAO 294 B' },
      { CODVENDCARTAO: 12, NROCUPOM: '5', DTVENDA: '2064-05-12T09:00:00', VALOR: 30, CODOPERADOR: 7, CODPDV: 82, OPERADORA: 'VISA', CODOPERADORA: 1, IDEMPRESA: 1, NROPEDIDO: '82120564090000',
        IDPGTO: 3, LIBERADO: 'N', CONSILIADO: null, NROPARCELA: 2, CHAVE: '82120564080000', DTCADASTRO: null, USULTALTERACAO: null, DTULTIMALTERACAO: null, OBS: 'CARTAO 294 A' }] }, agora, v));
    expect(car).toContain('DOCUMENTOS DA FINALIZADORA - CARTÃO');
    expect(car).toContain('Periodo: 12/05/2064 até 12/05/2064 Empresa(s): HIPER PINHEIRAO LTDA');
    expect(car).toContain('CARTAO 294 B');
    expect(car).toContain('Valor Total: 80,00');
    const tkt = texto(paginasDoModelo(modelo('fec-doc-fin-tkt.fr3'), { frxdbdtstDocs: [
      { CODTICKET: 3, DATA: '2064-05-12T00:00:00', VALOR: 25, VALORLIQ: 23.5, NROPEDIDO: '82120564100000', CODPDV: 82, IDPGTO: 5, IDEMPRESA: 1, CODOPERADOR: 7, LIBERADO: 'N' }] }, agora, v));
    expect(tkt).toContain('DOCUMENTOS DA FINALIZADORA - TICKET');
    expect(tkt).toContain('23,50');
    const san = texto(paginasDoModelo(modelo('fec-doc-fin-sangria.fr3'), { frxdbdtstDocs: [
      { CODPDV: 82, DATA: '2064-05-12T11:00:00', DESCRICAO: 'SANGRIA 294', MODALIDADE: 'DINHEIRO', NOME_RESPONSAVEL: 'MARIA', VALOR: 40 }] }, agora, v));
    expect(san).toContain('Periodo: 12/05/2064 até 12/05/2064'); // o layout lê [Dtfinal]: a variável do FastReport não diferencia caixa
    expect(san).toContain('40,00 12/05/2064 11:00:00 82 MARIA DINHEIRO SANGRIA 294');
  });
});
