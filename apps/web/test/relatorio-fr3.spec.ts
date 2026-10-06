import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clicarNoDialogo, dialogoDoModelo, paginasDoModelo, type Registro } from '../src/shared/fr3/render';

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

  it('fechamento de caixa (FechamentoCaixa.fr3 da produção): um grupo por operador + PDV + CHAVE, o rodapé com a sangria negativa e os totais por recurso no sub-relatório (com mais de um grupo); [DATA] é a variável, não a página "Data"', () => {
    const linha = (chave: string, rec: string, venda: number, caixa: number, div: number, san = 0) => ({ CODOPERADORA: 7, NOME: 'MARIA', RECURSO_VENDA: rec, VALOR_VENDA: venda, CHAVE: chave, NROPDV: '79',
      OPERADORA_NROPDV: 779, OPERADORA_NROPDV_CHAVE: `779${chave}`, RECURSO_CAIXA: rec, VALOR_CAIXA: caixa, DIV_VENDA_CAIXA: div, RECURSO_TES: rec, VALOR_TES: 0, DIV_TES_CAIXA: 0, DIV_TES_VENDA: 0,
      CX_OBS: 'QUEBRA', ORDEM: 1, TOTAL_DESCONTO: 0, TOTAL_CANCELAMENTOS: 314.86, VALOR_SANGRIA: san, VALOR_SUPRIMENTO: 0 });
    const doc = [linha('A', 'CARTOES', 5383.03, 5383.03, 0, 1753.7), linha('A', 'DINHEIRO', 1764.26, 1753.7, -10.56), linha('B', 'DINHEIRO', 50, 0, -50)];
    const tot = [{ CODOPERADORA: 1, NOME: 'MARIA', RECURSO_VENDA: 'CARTOES', VALOR_VENDA: 5383.03, RECURSO_CAIXA: 'CARTOES', VALOR_CAIXA: 5383.03, DIV_VENDA_CAIXA: 0 },
      { CODOPERADORA: 1, NOME: 'MARIA', RECURSO_VENDA: 'DINHEIRO', VALOR_VENDA: 1814.26, RECURSO_CAIXA: 'DINHEIRO', VALOR_CAIXA: 1753.7, DIV_VENDA_CAIXA: -60.56 }];
    const t = texto(paginasDoModelo(modelo('fechamento-caixa.fr3'), { frxDBDatasetDoc: doc, frxDBDatasetTotais: tot, frxDBDataset2: [{ RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA', FANTASIA: 'HIPER', CNPJ: '1', INSC: '2', FONE1: '3' }] },
      agora, { DATA: "'19/03/2038'" }, { Memo24: 'Vendas', Memo39: 'Divergência Vendas p/ Caixa' }));
    expect(t).toContain('Caixa(s) do dia: 19/03/2038');
    expect(t).toContain('Operador(a): 7 - MARIA - PDV: 79 - Chave&gt; A');
    expect(t).toContain('Operador(a): 7 - MARIA - PDV: 79 - Chave&gt; B');
    expect(t).toContain('7.147,29 -10,56 Divergência Vendas p/ Caixa 7.136,73'); // Σvenda, Σ(caixa − venda), Σcaixa do turno A
    expect(t).toContain('-1.753,70 Sangria:');
    expect(t).toContain('Totais');
    expect(t).toContain('1.814,26 DINHEIRO 1.753,70 -60,56');
    expect(t).toContain('Cancelamentos: 629,72'); // o TotalCancelamento do script soma o do operador + PDV de cada grupo, como o legado
    expect(t.match(/-1\.753,70 Sangria:/g)?.length).toBe(2); // o SUM(MasterData2) do sub-relatório de totais acumula desde o começo
  });

  it('pedido de compra (ped_compra.fr3 da produção): uma folha por loja com os dados dela, os prazos pelo script (30-60), a situação do item e os totais da loja; o agrupado soma as lojas', () => {
    const item = (loja: number, desc: string, qt: number, emb: number, sit = '', bon = 0) => ({ CODPEDCOMP: 295, FORNECEDOR: 'FORN A', OBS: 'ENTREGAR CEDO', CODPGTO: 'A PRAZO', DT_VENCIMENTO: '2065-01-30T00:00:00',
      DATA: '2065-01-10T00:00:00', CODBARRA: '789', DESCRICAO: desc, UNIDADE: 'CX', QTDE: qt, QTDTOTAL: qt * 12, FATOREMBALAGEM: 12, VRCUSTO: emb / 12, VLREMBALAGEM: emb, BONIFICACAO: bon,
      IDEMPRESA: loja, RAZAOSOCIAL: `LOJA ${loja} LTDA`, FANTASIA: `LOJA ${loja}`, ENDERECO: 'RUA A', CNPJ: '1', INSC: '2', FONE1: '3', CD1: 30, CD2: 60, CD3: 0, CD4: 0, CD5: 0, CD6: 0, CD7: 0, CD8: 0,
      EMAIL: null, OPERADOR: 'COMPRADOR', DESCPADRAO: 5, DESCRICAO_SITUACAO: sit, ICM_EFETIVO: 18, IDPRODUTO: 1, CODREF: null });
    const pags = paginasDoModelo(modelo('ped-compra.fr3'), { frxDBPedidoCompra: [item(1, 'ARROZ', 2, 120, 'TRIBUTADO', 10), item(1, 'FEIJAO', 1, 60), item(2, 'ARROZ', 3, 120)] }, agora);
    const t = texto(pags);
    expect(pags.length).toBe(2);
    expect(t).toContain('PEDIDO DE COMPRA 295');
    expect(t).toContain('30-60'); // o script troca a descrição da condição pelos prazos
    expect(t).toContain('Fornecedor com desconto de 5 %');
    expect(t).toContain('Razão: LOJA 1 LTDA');
    expect(t).toContain('ARROZ 2,0000 CX 10,0000 240,00 12,00 24,0000 120,00 TRIBUTADO 18');
    expect(t).toContain('Total da compra: 300,00 Total bonificado: 24,00 2 produto(s)');
    expect(t).toContain('Razão: LOJA 2 LTDA');
    expect(t).toContain('Total da compra: 360,00');
    const { IDEMPRESA: _l, RAZAOSOCIAL: _r, FANTASIA: _f, ENDERECO: _e, CNPJ: _c, INSC: _i, FONE1: _o, ...base } = item(1, 'ARROZ', 5, 120);
    const ag = texto(paginasDoModelo(modelo('ped-compra-agrupado.fr3'), { FDBPedidoAgrupado: [{ ...base, IDEMPRESA: 2, QTDTOTAL: 60 }] }, agora));
    expect(ag).toContain('ARROZ');
    expect(ag).toContain('600,00');
  });

  it('recibos das baixas (Config\\recibopagar.fr3 com o diálogo "Layout de impressão" e Config\\recibo.fr3): o diálogo lista as opções, o OnClick do check desmarca o outro, o botão escolhe a página (recibo por fornecedor × lista)', () => {
    const x = modelo('recibopagar-config.fr3');
    const dlg = dialogoDoModelo(x);
    expect(dlg?.titulo).toBe('Layout de impressão');
    expect(dlg?.controles.map((c) => `${c.nome}:${c.marcado}`).join(',')).toBe('chkRecibo:true,chkLista:false');
    expect(dlg?.botoes[0]?.nome).toBe('btnVisualizar');
    expect(clicarNoDialogo(x, 'chkLista', { chkRecibo: true, chkLista: true })).toEqual({ chkRecibo: false, chkLista: true });
    const emp = [{ RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA', ENDERECO: 'RUA A', BAIRRO: 'CENTRO', CIDADE: 'BH', UF: 'MG', CNPJ: '1', INSC: '2', FONE1: '3' }];
    const doc = (f: string, dup: string, v: number) => ({ FORNECEDOR: f, DUPLICATA: dup, DATA_PAGAMENTO: '2066-02-10T00:00:00', DATA_VENCEU: '2066-02-05T00:00:00', VALOR_DOCUMENTO: v,
      VALOR_PAGO: v, JUROS: 0, ACRES_DESC: 0, HISTORICO: 'PAGTO', OBSERVACAO: 'OBS', CNPJ_CPF: '99', NR_NF: '123', CODIGO_DOCUMENTO: 7, CLIENTE: 'CLI' });
    const dados = { dbdRecibo: [doc('FORN A', 'D1', 100), doc('FORN A', 'D2', 50), doc('FORN B', 'D3', 30)], dbdEmpresa: emp };
    const rec = paginasDoModelo(x, dados, agora, { VARIOS_FORNECEDORES: "'S'" }, {}, { marcados: { chkRecibo: true, chkLista: false }, botao: 'btnVisualizar' });
    expect(rec.length).toBe(2); // um recibo por fornecedor
    expect(texto(rec)).toContain('PAGAMOS À .: FORN A');
    expect(texto(rec)).toContain('FORN A 150,00');
    const lst = texto(paginasDoModelo(x, dados, agora, { VARIOS_FORNECEDORES: "'S'" }, {}, { marcados: { chkRecibo: false, chkLista: true }, botao: 'btnVisualizar' }));
    expect(lst).toContain('LISTA DE RECIBOS');
    expect(lst).toContain('A QUANTIA DE.: R$ 180,00');
    const rcb = texto(paginasDoModelo(modelo('recibo-config.fr3'), { dbdRecibo: [doc('', 'D9', 80)], dbdEmpresa: emp }, agora));
    expect(rcb).toContain('RECEBEMOS DO(A) SR(A)(S).: CLI');
    expect(rcb).toContain('A QUANTIA DE.: R$ 80,00');
    expect(rcb).toContain('GUARDAR ESTE RECIBO POR 12 MESES');
  });

  it('agrupamento (layouts da produção): o extrato de convênio com a taxa administrativa, o extrato por funcionário com os totais dos grupos no cabeçalho (DoublePass: a 1ª passada guarda numa TStringList, a final escreve) e o A Pagar agrupado', () => {
    const emp = [{ RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA', FANTASIA: 'HIPER', CNPJ: '1' }];
    const mb = (cli: string, cup: string, v: number) => ({ CODRCB: 1, NROCUPOM: cup, DTVENDA: '2066-03-01T10:00:00', DTVENC: '2066-04-10T00:00:00', VALOR: v, CODPDV: 3, OPERADORA: 'CAIXA 1', CODEMPRESA: 1, RAZAO: cli });
    const cons = [{ NOMECLIENTE: 'CONVENIO X', DTVENDA: '2066-03-31T00:00:00', DTVENC: '2066-04-10T00:00:00', TOTAL: 160, TXADM: 10 }];
    const an = texto(paginasDoModelo(modelo('agrupamento.fr3'), { FDBAgrupamentoRCB: [mb('ANA', '11', 50), mb('ANA', '12', 30), mb('BETO', '13', 70)], frxDBDataset3: cons, frxDBDataset2: emp }, agora));
    expect(an).toContain('EXTRATO DE CONVÊNIO');
    expect(an).toContain('Convênio: CONVENIO X');
    expect(an).toContain('ANA 1 11 01/03/2066 10/04/2066 R$ 50,00 3 CAIXA 1');
    expect(an).toContain('R$ 80,00 BETO'); // o subtotal do cliente
    expect(an).toContain('Taxa Administrativa R$ 10,00'); // o ColumnFooter só com TXADM > 0
    const ex = (nome: string, tipo: string, v: number) => ({ NOME: nome, TIPO: tipo, DATA: '2066-03-01T00:00:00', VALOR: -v, DOCUMENTO: 5, PARCELAS: '1', TIPODOC: 'CV', OBS: 'X' });
    const fu = texto(paginasDoModelo(modelo('agrupamento-extrato-funcionario.fr3'), { frxDBConsulta: [ex('ANA', 'CONVENIOS DE FUNCIONARIOS', 50), ex('ANA', 'FARMACIA', 30), ex('BETO', 'CONVENIOS DE FUNCIONARIOS', 70)] }, agora));
    expect(fu).toContain('ANA -80,00 CONVENIOS DE FUNCIONARIOS -50,00');
    expect(fu).toContain('FARMACIA -30,00');
    expect(fu).toContain('BETO -70,00');
    expect(fu).toContain('Total geral -150,00');
    const cp = texto(paginasDoModelo(modelo('agrupamentocp.fr3'), { DbdAgrupamento: [{ CODAPG: 1, CODPARCEIRO: 2, RAZAO: 'FORN A', DUPLICATA: 'X1', DTCOMPRA: '2066-03-01T00:00:00', DTVENC: '2066-04-01T00:00:00', VALOR: 40 }],
      DbdApagar: [{ RAZAO: 'CONSOLIDADO', RAZAOSOCIAL: 'HIPER', DTCOMPRA: '2066-03-31T00:00:00', DTVENC: '2066-04-10T00:00:00', VALOR: 40 }] }, agora));
    expect(cp).toContain('CONTAS À PAGAR AGRUPADAS');
    expect(cp).toContain('Parceiro : FORN A 1 X1 01/03/2066 01/04/2066 40,00');
  });

  it('manifesto (Manifesto_Destinatario_Itens.fr3): os itens da nota na ordem do item, com a nota da grade e a empresa', () => {
    const t = texto(paginasDoModelo(modelo('manifesto-destinatario-itens.fr3'), {
      frxDBDatasetProdManifesto: [{ NROITEM: 1, CODPROD: 'A1', EAN: '789', DESCRICAO: 'ARROZ 5KG', NCM: '10063021', CFOP: 5102, QUANTIDADE: 10, VRUNITARIO: 20.5, VRTOTAL: 205 }],
      frxDBDatasetDadosNota: [{ NUMERO_NF: '123', DATA_EMISSAO: '2066-05-01T00:00:00', CHAVE: '3166', CNPJ_CPF: '04892455000110', RAZAO: 'FORN A', TOTAL_NF: 205 }],
      frxDBDatasetDadosEmpresa: [{ RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA', FANTASIA: 'HIPER', CNPJ: '1' }],
    }, agora));
    expect(t).toContain('Relatório de produtos da nota fiscal - manifesto destinatário');
    expect(t).toContain('NroNF: 123');
    expect(t).toContain('Parceiro: 04892455000110 - FORN A');
    expect(t).toContain('ARROZ 5KG');
  });

  it('relatórios de caixa (Caixa1 - Divergências, esquema do TFrmRelMaster): os níveis expandidos abrem os grupos recolhíveis pelo script (case … of), os totais de cada grupo saem no cabeçalho (DoublePass) e o resumo por recurso soma a banda da própria página', () => {
    const l = (dia: string, rec: string, cx: number, pdv: number) => ({ IDEMPRESA: 1, FANTASIA: 'HIPER', OPERADOR: 7, NOME: 'MARIA', DATA: `2039-05-${dia}T00:00:00`, TIPORECURSO: rec, CODPDV: 7, VALOR_CAIXA: cx, VALOR_CX_VENDAS: pdv, DIVERGENCIA: cx - pdv });
    const dados = (n: number) => ({ DBDRelatorio: [l('10', 'CARTAO', 250, 300), l('10', 'PIX', 10, 0), l('11', 'DINHEIRO', 0, 100)],
      DbdAuxiliar: [{ TIPORECURSO: 'CARTAO', VALOR_CAIXA: 250, VALOR_CX_VENDAS: 300, DIVERGENCIA: -50 }, { TIPORECURSO: 'DINHEIRO', VALOR_CAIXA: 0, VALOR_CX_VENDAS: 100, DIVERGENCIA: -100 }],
      DBDVariaveisAdicionais: [{ IDEmpresas: '1', DataInicial: '2039-05-01T00:00:00', DataFinal: '2039-05-31T00:00:00', NiveisExpandidos: n, Tabela: 0 }] });
    const n0 = texto(paginasDoModelo(modelo('caixa1-divergencias.fr3'), dados(0), agora));
    expect(n0).toContain('Período: 01/05/2039 à 31/05/2039 Empresas: 1');
    expect(n0).toContain('HIPER -140,00 400,00 260,00');
    expect(n0).not.toContain('Operador: MARIA'); // nível em branco: só a loja
    const n2 = texto(paginasDoModelo(modelo('caixa1-divergencias.fr3'), dados(2), agora));
    expect(n2).toContain('Operador: MARIA -140,00 260,00 400,00 Data: 10/05/2039 -40,00 260,00 300,00 Data: 11/05/2039 -100,00 0,00 100,00');
    expect(n2).not.toContain('PIX'); // o dia fica recolhido no padrão (2 níveis)
    const n3 = texto(paginasDoModelo(modelo('caixa1-divergencias.fr3'), dados(3), agora));
    expect(n3).toContain('CARTAO -50,00 250,00 300,00 PIX 10,00 10,00 0,00');
    expect(n3).toContain('Total -150,00 400,00 250,00'); // o resumo soma o DbdAuxiliar (a banda da página 2)
    const ab = texto(paginasDoModelo(modelo('caixa4-abertos.fr3'), {
      DBDRelatorio: [{ IDEMPRESA: 1, NROPDV: 7, NOME: 'MARIA', CODOPERADORA: 7, DATA: '2039-05-10T00:00:00', HORAENTRADA: '2039-05-10T08:00:00', HORASAIDA: null }],
      DBDVariaveisAdicionais: [{ IDEmpresas: '1', DataInicial: '2039-05-01T00:00:00', DataFinal: '2039-05-31T00:00:00', NiveisExpandidos: 1, Tabela: 0 }],
    }, agora));
    expect(ab).toContain('MARIA');
  });

  it('DRE contábil (DRE Contabil.fr3, esquema do TFrmRelMaster): os níveis da árvore com os totais F (DoublePass), os lançamentos com histórico, data e empresa no nível 3, e a linha da fórmula', () => {
    const r = (valor: number, data: string, hist: string) => ({ CFGDRE_CODEXPANDIDO: '04.001.0001', CFGDRE_DESCRICAO: 'ALUGUEIS', CFGDRE_TIPO_CALCULO: 'P', CFGDRE_CODEXPANDIDO_NIVEL1: '04', CFGDRE_DESCRICAO_NIVEL1: 'DESPESAS OPERACIONAIS',
      CFGDRE_TIPO_CALCULO_NIVEL1: 'F', CFGDRE_CODEXPANDIDO_NIVEL2: '04.001', CFGDRE_DESCRICAO_NIVEL2: 'DESPESAS ADM', VALOR: valor, VALOR_NIVEL1: -250, VALOR_NIVEL2: -250, DATA_LANCAMENTO: data, HISTORICO: hist, CODEMPRESA: 1 });
    const rows = [r(-200, '2030-03-15T00:00:00', 'ALUGUEL MARCO'), r(-50, '2030-03-20T00:00:00', 'ALUGUEL EXTRA'),
      { ...r(0, '1899-12-30T00:00:00', ''), CFGDRE_CODEXPANDIDO: '08', CFGDRE_DESCRICAO: 'LUCRO BRUTO', CFGDRE_TIPO_CALCULO: 'E', CFGDRE_CODEXPANDIDO_NIVEL1: '08', CFGDRE_DESCRICAO_NIVEL1: 'LUCRO BRUTO', CFGDRE_TIPO_CALCULO_NIVEL1: 'E', CFGDRE_CODEXPANDIDO_NIVEL2: '08', VALOR_NIVEL1: 100, VALOR_NIVEL2: 0 }];
    const v = (n: number) => [{ IDEmpresas: '1', DataInicial: '2030-01-01T00:00:00', DataFinal: '2030-12-31T00:00:00', NiveisExpandidos: n, Tabela: 0 }];
    const n3 = texto(paginasDoModelo(modelo('dre-contabil.fr3'), { DBDRelatorio: rows, DBDVariaveisAdicionais: v(3) }, agora));
    expect(n3).toContain('Período: 01/01/2030 à 31/12/2030 Empresas: 1');
    expect(n3).toContain('04 - DESPESAS OPERACIONAIS -250,00 04.001 - DESPESAS ADM -250,00 04.001.0001 - ALUGUEIS -250,00');
    expect(n3).toContain('ALUGUEL MARCO -200,00 15/03/2030 1 ALUGUEL EXTRA -50,00 20/03/2030 1');
    expect(n3).toContain('08 - LUCRO BRUTO 100,00');
    const n1 = texto(paginasDoModelo(modelo('dre-contabil.fr3'), { DBDRelatorio: rows, DBDVariaveisAdicionais: v(1) }, agora));
    expect(n1).not.toContain('ALUGUEL MARCO'); // 1 nível: os lançamentos ficam recolhidos
  });

  it('relatórios de compras (Compras1 e ComprasVendasPorDepartamento, esquema do TFrmRelMaster): os níveis abrem a árvore de categorias; "apenas vendas" troca os títulos pelo Tabela', () => {
    const v = (n: number, tab = 0) => [{ IDEmpresas: '1', DataInicial: '2045-03-01T00:00:00', DataFinal: '2045-03-31T00:00:00', NiveisExpandidos: n, Tabela: tab }];
    // cada grupo com o seu código: o script do layout acha o total do grupo pela chave dos CÓDIGOS (subgrupo|grupo|depto|seção|data|empresa)
    const l = (gr: string, cg: number, sg: string, csg: number, tot: number) => ({ IDEMPRESA: 1, FANTASIA: 'HIPER', DATA: '2045-03-10T00:00:00', DESC_SECAO: 'MERCEARIA', CODSECAO: 1, DESCRICAO_DEPARTAMENTO: 'BEBIDAS', CODDPTO: 2,
      DESC_GRUPO: gr, CODGRUPO: cg, DESC_SUBGRUPO: sg, CODSUBGRUPO: csg, TOTAL_COMPRA: tot, TOTAL_PORC: 0 });
    const linhas = [l('REFRIGERANTES', 3, 'COLA', 4, 100), l('SUCOS', 5, 'LARANJA', 6, 50)];
    const c0 = texto(paginasDoModelo(modelo('compras1-categoria.fr3'), { DBDRelatorio: linhas, DBDVariaveisAdicionais: v(0) }, agora));
    expect(c0).toContain('Periodo: 01/03/2045 até 31/03/2045 Empresa(s): 1');
    expect(c0).toContain('Total Geral: 150,00');
    expect(c0).not.toContain('Subgrupo: COLA');
    const c5 = texto(paginasDoModelo(modelo('compras1-categoria.fr3'), { DBDRelatorio: linhas, DBDVariaveisAdicionais: v(5) }, agora));
    // os totais nos CABEÇALHOS dos grupos (o Add/SetTotal do script nas duas passadas, com o IndexOf da TStringList)
    expect(c5).toContain('Seção: MERCEARIA 150,00 Departamento: BEBIDAS 150,00 Grupo: REFRIGERANTES 100,00 Subgrupo: COLA 100,00');
    expect(c5).toContain('Grupo: SUCOS 50,00 Subgrupo: LARANJA 50,00');
    const ve = texto(paginasDoModelo(modelo('compras-vendas-depto.fr3'), { DBDRelatorio: [{ CODDPTO: 2, DESCRICAO_DEPARTAMENTO: 'BEBIDAS', TOTAL_COMPRA: 200 }], DBDVariaveisAdicionais: v(0, 1) }, agora));
    expect(ve).toContain('Total Vendas');
    expect(ve).toContain('2 BEBIDAS 200,00');
  });
});

describe('dias de estoque (esquema do TFrmRelMaster, uDDE.pas)', () => {
  const v = (emp: string, n = 0) => [{ IDEmpresas: emp, DataInicial: '2026-09-30T00:00:00', DataFinal: '2026-09-30T00:00:00', NiveisExpandidos: n, Tabela: 0 }];
  const p = (id: number, desc: string, est: number, vend: number, cob: number, emp = 1) => ({ IDPRODUTO: id, IDEMPRESA: emp, CODBARRA: `789${id}`, DESCRICAO: desc,
    QTDE_ESTOQUE: est, QTDE_VENDIDA: vend, COBERTURA: cob, FANTASIA: emp === 1 ? 'HIPER' : 'FILIAL', RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA' });

  it('uma loja (Dias_de_estoque_1_empresa.fr3): a cobertura com duas casas e o −999999 escrito "Sem vendas"', () => {
    const t = texto(paginasDoModelo(modelo('dias-estoque-1-empresa.fr3'), { DBDRelatorio: [p(11, 'ARROZ 5KG', 100, 300, 10), p(12, 'FEIJAO 1KG', 40, 0, -999999)], DBDVariaveisAdicionais: v('1') }, agora));
    expect(t).toContain('RELATÓRIO DE DIAS DE ESTOQUE');
    expect(t).toContain('Empresas: 1');
    expect(t).toContain('ARROZ 5KG');
    expect(t).toContain('10,00');
    expect(t).toContain('Sem vendas');
    expect(t).not.toContain('-999999');
  });

  it('várias lojas (Dias_de_estoque_varias_empresas.fr3): o produto agrupa as lojas', () => {
    const t = texto(paginasDoModelo(modelo('dias-estoque-varias-empresas.fr3'), { DBDRelatorio: [p(11, 'ARROZ 5KG', 100, 300, 10, 1), p(11, 'ARROZ 5KG', 20, 0, -999999, 2)], DBDVariaveisAdicionais: v('1,2') }, agora));
    expect(t).toContain('Empresas: 1,2');
    expect(t).toContain('HIPER');
    expect(t).toContain('FILIAL');
    expect(t.match(/ARROZ 5KG/g)?.length).toBe(1);
    expect(t).toContain('Sem vendas');
  });

  it('ruptura (Dias_de_estoque_ruptura.fr3): fornecedor › produto › fornecedores secundários, recolhidos pelos níveis expandidos', () => {
    const r = (sec: number, nome: string) => ({ CODFOR: 7, FORNECEDOR: 'CAMIL ALIMENTOS', IDEMPRESA: 1, IDPRODUTO: 11, CODBARRA: '78911', DESCRICAO: 'ARROZ 5KG',
      QTDE_ESTOQUE: 6, QTDE_VENDIDA: 90, COBERTURA: 2, FANTASIA: 'HIPER', RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA', CODFOR_SEC: sec, FORNECEDOR_SECUNDARIO: nome });
    const linhas = [r(31, 'DISTRIBUIDORA A'), r(32, 'DISTRIBUIDORA B')];
    const n2 = texto(paginasDoModelo(modelo('dias-estoque-ruptura.fr3'), { DBDRelatorio: linhas, DBDVariaveisAdicionais: v('1', 2) }, agora));
    expect(n2).toContain('RELATÓRIO DIAS DE ESTOQUE - RUPTURA');
    expect(n2).toContain('Fornecedor : CAMIL ALIMENTOS');
    expect(n2).toContain('ARROZ 5KG');
    expect(n2).toContain('FORNECEDOR :31 | DISTRIBUIDORA A');
    expect(n2).toContain('FORNECEDOR :32 | DISTRIBUIDORA B');
    const n0 = texto(paginasDoModelo(modelo('dias-estoque-ruptura.fr3'), { DBDRelatorio: linhas, DBDVariaveisAdicionais: v('1', 0) }, agora));
    expect(n0).toContain('Fornecedor : CAMIL ALIMENTOS');
    expect(n0).not.toContain('DISTRIBUIDORA A');
  });
});

describe('troca de mercadorias (esquema do TFrmRelMaster, uRelTrocaMercadoriaFor.pas)', () => {
  const v = [{ IDEmpresas: '1', DataInicial: '2025-11-01T00:00:00', DataFinal: '2025-11-30T00:00:00', NiveisExpandidos: 0, Tabela: 0 }];
  const r = (troca: number, forn: number, razao: string, desc: string, qtde: number, custo: number) => ({ CODTROCA: troca, CODPARCEIRO: forn, DATA: '2025-11-24T00:00:00', RAZAO: razao,
    CODEMPRESA: 1, DESCRICAO_TROCA: 'AVARIA', EMPRESA: 'HIPER', CODITENSTROCA: troca * 10, IDPRODUTO: 5, QTDE: qtde, VRCUSTO: custo, CODBARRA: '7891', DESCRICAO: desc,
    QTDE_EDICAO: qtde, STATUS: 'F', CODNF: null, NRONF: null, TOTAL: qtde * custo, VRVENDA: custo * 2 });
  const linhas = [r(101, 7, 'LATICINIOS TREVO', 'IOGURTE 170G', 3, 2.5), r(101, 7, 'LATICINIOS TREVO', 'BEBIDA LACTEA 1L', 2, 4), r(102, 8, 'CAMIL', 'ARROZ 5KG', 1, 20)];

  it('analítico agrupado: o fornecedor no cabeçalho do grupo, os itens e os totais do grupo e gerais', () => {
    const t = texto(paginasDoModelo(modelo('troca-mercadoria-analitico-agrup.fr3'), { DBDRelatorio: linhas, DBDVariaveisAdicionais: v }, agora));
    expect(t).toContain('RELATÓRIO TROCA DE MERCADORIA');
    expect(t).toContain('Fornecedor: 7 - LATICINIOS TREVO');
    expect(t).toContain('Troca: 101');
    expect(t).toContain('IOGURTE 170G');
    expect(t).toContain('15,50'); // 7,50 + 8,00 no grupo do fornecedor 7
    expect(t).toContain('35,50'); // total geral
  });

  it('analítico e sintético: a linha do item com troca, fornecedor e empresa; os totais gerais', () => {
    const a = texto(paginasDoModelo(modelo('troca-mercadoria-analitico.fr3'), { DBDRelatorio: linhas, DBDVariaveisAdicionais: v }, agora));
    expect(a).toContain('LATICINIOS TREVO');
    expect(a).toContain('ARROZ 5KG');
    expect(a).toContain('35,50');
    const s = texto(paginasDoModelo(modelo('troca-mercadoria-sintetico.fr3'), { DBDRelatorio: linhas, DBDVariaveisAdicionais: v }, agora));
    expect(s).toContain('BEBIDA LACTEA 1L');
    expect(s).toContain('6,00'); // qtde total
    expect(s).toContain('35,50');
  });
});

describe('análise de comportamento por período (RelAnaliseComportamentoPeriodo.fr3) e o TfrxChartView', () => {
  it('os blocos dos períodos, a comparação com o percentual do legado e um gráfico de barras por métrica (o CdsGrafico como detalhe do CdsGrupos)', () => {
    const grupos = ['Faturamento', 'CMV', 'Lucro', 'Rentabilidade', 'Quantidade de tickets', 'Valor ticket médio'];
    const tit = ['Set/2026', 'Ago/2026'];
    const vals: Record<string, number[]> = { Faturamento: [1000, 800], CMV: [700, 600], Lucro: [300, 200], Rentabilidade: [30, 25], 'Quantidade de tickets': [50, 40], 'Valor ticket médio': [20, 20] };
    const rel: Registro[] = [];
    tit.forEach((t, ti) => { for (const g of grupos) rel.push({ TITULOVISIVEL: g === 'Faturamento' ? t : null, TITULO: t, DESCRICAO: g, VALOR: vals[g][ti], PORCENTAGEM: null }); rel.push({ TITULO: null, DESCRICAO: null, VALOR: null }); });
    for (const g of grupos) rel.push({ TITULO: 'Comparação entre Set/2026 e Ago/2026', DESCRICAO: g, VALOR: vals[g][0] - vals[g][1], PORCENTAGEM: vals[g][0] ? Math.round(((vals[g][0] - vals[g][1]) / vals[g][0]) * 10000) / 100 : 0 });
    const graf = grupos.flatMap((g, gi) => tit.map((t, ti) => ({ DESCRICAO: t, VALOR: vals[g][ti], GRUPO: g, __MESTRE: gi })));
    const pgs = paginasDoModelo(modelo('analise-comportamento-periodo.fr3'), { DBDRelatorio: rel, DbdAuxiliar: grupos.map((g) => ({ GRUPO: g })), DBDGrafico: graf,
      DBDVariaveisAdicionais: [{ IDEmpresas: '1,2' }] }, agora);
    const t = texto(pgs);
    expect(t).toContain('ANÁLISE DO COMPORTAMENTO DA LOJA POR PERÍODOS');
    expect(t).toContain('Empresas: 1,2');
    expect(t).toContain('Comparação entre Set/2026 e Ago/2026');
    expect(t).toContain('20,00'); // o percentual do faturamento: (1000 − 800) ÷ 1000
    // a página dos gráficos: um SVG por métrica, a legenda com o valor à direita (ltsRightValue) e as barras de cada período
    const svgs = pgs.flatMap((p) => p.html).join('').match(/<svg xmlns/g) ?? [];
    expect(svgs.length).toBe(6);
    expect(t).toContain('Set/2026 1.000 Ago/2026 800');
    expect(pgs.flatMap((p) => p.html).join('')).toMatch(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="#ff0000"/);
  });
});

describe('análises de pedidos × notas fiscais (AnalisesPedidoNF.fr3)', () => {
  const rel = [
    { APN_ID: 501, APN_DATA_ANALISE: '2026-09-10T10:00:00', CODEMPRESA: 1, CODCOMPRADOR: 8, COMPRADOR: 'MARIA', CODPARCEIRO: 22, FORNECEDOR: 'CAMIL', PEDIDOS: '36257', NOTAS_FISCAIS: '770001, 770002',
      APN_STATUS_STR: 'Finalizado', APN_TOTAL_PARCIAL_STR: 'Total', APN_DIFERENCA_VALOR: 15.4, APN_STATUS_FINALIZACAO: 'FEP', USUARIO_LIBERACAO: 'JOAO' },
  ];
  const div = [{ APN_ID: 501, IDPRODUTO: 11, CODBARRA: '7891', DESCRICAO: 'ARROZ 5KG', UNIDADE: 'UN', APND_QUANTIDADE_NF: 10, APND_QUANTIDADE_PC: 8, APND_VALOR_NF: 12.5, APND_VALOR_PC: 11, __MESTRE: 0 }];
  const ine = [{ APN_ID: 501, IDPRODUTO: 12, CODBARRA: '7892', DESCRICAO: 'FEIJAO 1KG', APNIN_VALOR: 7.9, __MESTRE: 0 }];
  const inp = [{ APN_ID: 501, IDPRODUTO: 13, CODBARRA: '7893', DESCRICAO: 'OLEO 900ML', APNIP_VALOR: 4.2, __MESTRE: 0 }];
  const v = (exp: string) => [{ IDEmpresas: '1, 2', DataInicial: '2026-09-01T00:00:00', DataFinal: '2026-09-30T00:00:00', NiveisExpandidos: 0, Tabela: 0, Expandido: exp }];

  it('loja › comprador › fornecedor › pedidos › análise; o "Expandido" abre os três detalhes da análise', () => {
    const t = texto(paginasDoModelo(modelo('analises-pedido-nf.fr3'), { DBDRelatorio: rel, DbdProdutosDiv: div, DbdProdutosIneNF: ine, DbdProdutosInePedido: inp, DBDVariaveisAdicionais: v('S') }, agora));
    expect(t).toContain('ANÁLISES DE PEDIDOS X NOTAS FISCAIS');
    expect(t).toContain('Comprador: MARIA');
    expect(t).toContain('Fornecedor: CAMIL');
    expect(t).toContain('Pedidos: 36257');
    expect(t).toContain('Notas fiscais: 770001, 770002');
    expect(t).toContain('Usuário que editou os pedidos:'); // FEP
    expect(t).toContain('ARROZ 5KG');
    expect(t).toContain('FEIJAO 1KG');
    expect(t).toContain('OLEO 900ML');
    const n = texto(paginasDoModelo(modelo('analises-pedido-nf.fr3'), { DBDRelatorio: rel, DbdProdutosDiv: div, DbdProdutosIneNF: ine, DbdProdutosInePedido: inp, DBDVariaveisAdicionais: v('N') }, agora));
    expect(n).toContain('Análise: 501');
    expect(n).not.toContain('ARROZ 5KG');
  });
});

describe('extrato de funcionários (UFuncionario.pas)', () => {
  const v = (n: number) => [{ IDEmpresas: '', DataInicial: '2026-09-01T00:00:00', DataFinal: '2026-09-30T00:00:00', NiveisExpandidos: n, Tabela: 0 }];
  it('1 - Extrato: por funcionário com o total no cabeçalho (o Set/Get da 1ª passada) e o total geral', () => {
    const l = (nome: string, tipo: string, data: string, sinal: string, valor: number) => ({ CODPARCEIRO: nome === 'ANA' ? 1 : 2, CODOPERADOR: 10, NOME: nome, TIPO: tipo, DATA: data, SINAL: sinal, VALOR: valor });
    const rows = [l('ANA', 'Adiantamento', '2026-09-05T00:00:00', '+', 100), l('ANA', 'Compras', '2026-09-06T00:00:00', '-', 40), l('BETO', 'Quebra', '2026-09-07T00:00:00', '-', 15)];
    const t1 = texto(paginasDoModelo(modelo('funcionario1-extrato.fr3'), { DBDRelatorio: rows, DBDVariaveisAdicionais: v(1) }, agora));
    expect(t1).toContain('EXTRATO DE FUNCIONÁRIOS');
    expect(t1).toContain('ANA');
    expect(t1).toContain('Total : 140,00');
    expect(t1).toContain('Adiantamento');
    expect(t1).toContain('155,00');
    const t0 = texto(paginasDoModelo(modelo('funcionario1-extrato.fr3'), { DBDRelatorio: rows, DBDVariaveisAdicionais: v(0) }, agora));
    expect(t0).not.toContain('Adiantamento');
  });

  it('2 - analítico e 3 - sintético: as linhas com documento, parcela e tipo de documento', () => {
    const l = (nome: string, tipo: string, valor: number, doc: number) => ({ CODPARCEIRO: 1, CODOPERADOR: 10, NOME: nome, DESCCODPLC: '01.01', TIPO: tipo, DATA: '2026-09-05T00:00:00', VALOR: valor, DOCUMENTO: doc, PARCELAS: '1/1', TIPODOC: 'DP', OBS: 'CONTA ORIGINADA DE VENDAS' });
    const rows = [l('ANA', 'CONVENIO', -40, 9001), l('ANA', 'ADIANTAMENTO', 100, 9002)];
    const a = texto(paginasDoModelo(modelo('funcionario2-analitico.fr3'), { DBDRelatorio: rows, DBDVariaveisAdicionais: v(2) }, agora));
    expect(a).toContain('9001');
    expect(a).toContain('ANA');
    const s = texto(paginasDoModelo(modelo('funcionario2-sintetico.fr3'), { DBDRelatorio: rows, DBDVariaveisAdicionais: v(1) }, agora));
    expect(s).toContain('9002');
    expect(s).toContain('60,00');
  });
});

describe('construtor de relatórios (o MontaRelatorio sobre o RelatorioGeral_ComGrupo.fr3 do cliente)', () => {
  it('o cabeçalho do grupo com o valor, as colunas, o subtotal "Total:" do grupo, o total geral e o total de registros', () => {
    // o .fr3 que o montador da API gera (test/relatorio-geral-fr3.spec.ts, caso "com grupo")
    const l = (forn: string, venc: string, valor: number) => ({ C0: forn, C1: venc, C2: valor, G0: forn });
    const pgs = paginasDoModelo(modelo('construtor-comgrupo-gerado.fr3'), { frxDBDatasetDados: [l('CAMIL', '2026-09-10T00:00:00', 100), l('CAMIL', '2026-09-20T00:00:00', 50.5), l('NESTLE', '2026-09-15T00:00:00', 30)], frxDBDataset1: [{}] }, agora);
    const t = texto(pgs);
    expect(t).toContain('HIPER');
    expect(t).toContain('CONTAS PAGAS NO MES');
    expect(t).toContain('Data Pagamento: 01/09/2026 à 30/09/2026');
    expect(t).toContain('Vencimento');
    expect(t).toContain('CAMIL');
    expect(t).toContain('10/09/2026');
    expect(t).toContain('150,50'); // o subtotal do grupo CAMIL
    expect(t).toContain('180,50'); // o total geral
    expect(t).toContain('Total de Registros: 2');
  });
});

describe('total por cartão (Rel_Total_Cartao.fr3, uRelCartoes.pas)', () => {
  it('agrupado por loja, com bruto/líquido por tipo, a participação no líquido (o script) e as variáveis do período', () => {
    const l = (emp: number, op: string, tipo: 'C' | 'D' | 'A', valor: number, tx: number) => {
      const liq = valor - (valor * tx) / 100;
      return { OPERADORA: op, FANTASIA: 'REDE', CODADM: 2, DIASCOMP: 30, IDEMPRESA: emp, TXADM: tx, VALOR: valor, VALOR_LIQUIDO: liq,
        VALOR_CREDITO: tipo === 'C' ? liq : 0, VALOR_DEBITO: tipo === 'D' ? liq : 0, VALOR_ALIMENTACAO: tipo === 'A' ? liq : 0,
        VALOR_CREDITO_BRUTO: tipo === 'C' ? valor : 0, VALOR_DEBITO_BRUTO: tipo === 'D' ? valor : 0, VALOR_ALIMENTACAO_BRUTO: tipo === 'A' ? valor : 0 };
    };
    const t = texto(paginasDoModelo(modelo('rel-total-cartao.fr3'), { frxDBDataset1: [l(1, 'CRED DEMO', 'C', 1300, 3), l(1, 'DEB DEMO', 'D', 500, 1), l(2, 'DEB DEMO', 'D', 80, 1)] }, agora,
      { DtInicial: "'01/07/2041'", DtFinal: "'31/07/2041'", Empresa: "'1,2'" }));
    expect(t).toContain('CRED DEMO');
    expect(t).toContain('1.261,00');
    expect(t).toContain('01/07/2041');
    expect(t).toContain('79,20');
  });
});

describe('rentabilidade por categorias (at&m_rentabilidade_da_familia*.fr3)', () => {
  const linha = (sg: string, id: number, desc: string, venda: number, lucrofinal: number, indice: number) => ({
    SUBGRUPO: sg, IDPRODUTO: id, CODBARRA: `789${id}`, DESCRICAO: desc, TOTCUSTO: venda * 0.6, TOTVENDA: venda, VRUNIT: 5, TOTQTDE: 10, VRCUSTO: 3, DCTOR: 0, PROMOCAO: 'N',
    VRCUSTOREAL: venda * 0.55, CREDITOICMS: 3.6, DEBITOICMS: 9, CREDITOPISCOFINS: 0, DEBITOPISCOFINS: 0, VENDALIQUIDA: venda * 0.82, LUCROBRUTO: 14.6, LUCRO: 14.6,
    MARGEMBRUTA: 35.61, ICME: 12, ICMS: 18, ICM: 5.4, ST: 0, VRFCPST: 0, FRETE: 0, FRETE2: 0, DESPACESS: 0, IPI: 0, PISCOFINS: 0, DESPOPERACIONAL: 5, BONIFICACAO: 0,
    SEGURO: 0, ACRESCIMO: 0, DESC_PROMOCAO: 0, VRPERDA: 0, ADICIONAISCUSTO: 0, LUCROLIQ: 9.6, IMPRENDA: 1.44, CONTSOCIAL: 0.86, LUCROFINAL: lucrofinal, MARGEMFINAL: 14.59,
    DPTO: 'MERCEARIA', GRUPO: 'GRAOS', QTDE_PERDA: 0, PERC_IMPRENDA: 15, PERC_CONTSOCIAL: 9, INDICE: indice, PARTICIPACAO: 50, ACUMULADO: 50 });
  const emp = [{ CNPJ: '37954975000169', INSC: '123', RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA' }];
  const vars = { DATAI: "'01/04/2049'", DATAF: "'30/04/2049'" };

  it('completo e simplificado: o subgrupo no cabeçalho do grupo, os produtos com o lucro final; os totais numa linha', () => {
    const rows = [linha('GRAOS A', 11, 'ARROZ 5KG', 50, 7.3, 2), linha('GRAOS A', 12, 'FEIJAO 1KG', 50, 1.5, 2)];
    const c = texto(paginasDoModelo(modelo('rentabilidade-familia.fr3'), { frxDBDataset1: rows, frxDBDataset2: emp }, agora, vars));
    expect(c).toContain('GRAOS A');
    expect(c).toContain('ARROZ 5KG');
    expect(c).toContain('HIPER PINHEIRAO LTDA');
    const s = texto(paginasDoModelo(modelo('rentabilidade-familia-simp.fr3'), { frxDBDataset1: rows, frxDBDataset2: emp }, agora, vars));
    expect(s).toContain('FEIJAO 1KG');
    const t = texto(paginasDoModelo(modelo('rentabilidade-familia-totais.fr3'), { frxDBDataset1: rows, frxDBDataset2: emp, frxDBDataset3: [{ TOTCUSTO: 60, DESPACESS: 0, FRETE: 0, FRETE2: 0, ST: 0, VRFCPST: 0,
      IPI: 0, SEGURO: 0, BONIFICACAO: 0, CREDITOICMS: 7.2, CREDITOPISCOFINS: 0, TOTVENDA: 100, DEBITOICMS: 18, DEBITOPISCOFINS: 0, VRPERDA: 0, LUCRO: 29.2, DESPOPERACIONAL: 10,
      LUCROLIQ: 19.2, PERC_IMPRENDA: 15, PERC_CONTSOCIAL: 9 }] }, agora, vars));
    expect(t).toContain('100,00');
  });
});

describe('relatórios de produtos (FRMPRODUTOSREL) nos layouts do cliente', () => {
  const emp = [{ ...empresa, ENDERECO: 'AV BRASIL 100', BAIRRO: 'CENTRO', CIDADE: 'UBERLANDIA' }];
  const vars = { FILTRO: "' Todos '", EMPRESAS: "'1,2'", DEP_ESTOQUE: "'Estoque e Depósito'", EXPANDIDO: "'N'", RELATORIO: '0' };
  const prod = (o: Record<string, unknown>) => ({ IDEMPRESA: 1, IDPRODUTO: 10, CODBARRA: '7891000100103', DESCRICAO: 'ARROZ 5KG', UNIDADE: 'UN', VRVENDA: 25.9, QTDE: 30,
    MINIMO: 10, MAXIMO: 50, RAZAO: 'CEREALISTA SUL', DESCDEPTO: 'MERCEARIA', DESCGRUPO: 'GRAOS', DESCSUBGRUPO: 'ARROZ', QTDE_DEP: 12, MAXIMO_DEP: 20, CODDPTO: 3,
    TOTALCUSTO: 150, TOTALVENDA: 777, ...o });

  it('análise (prod_Posicao_estoque_produtos.fr3): departamento › grupo › subgrupo, o filtro e o "disponível em"', () => {
    const t = texto(paginasDoModelo(modelo('produtos-analise.fr3'), { frxDataSetProdutos: [prod({}), prod({ IDPRODUTO: 11, DESCRICAO: 'FEIJAO 1KG', QTDE: -5 })], frxDatasetEmpresas: emp }, agora, vars));
    expect(t).toContain('RELATÓRIO POSIÇÃO DE ESTOQUE');
    expect(t).toContain('Departamento : MERCEARIA');
    expect(t).toContain('Sub-Grupo : ARROZ');
    expect(t).toContain('FEIJAO 1KG');
    expect(t).toContain('CEREALISTA SUL');
    expect(t).toContain('Filtro : Todos');
    expect(t).toContain('Disponível em : Estoque e Depósito');
    expect(t).toContain('HIPER PINHEIRAO');
  });

  it('ruptura (prod_Posicao_Estoque_Dep_produtos.fr3): quantidade do depósito e da loja', () => {
    const t = texto(paginasDoModelo(modelo('produtos-ruptura.fr3'), { frxDataSetProdutos: [prod({ QTDE: -5, QTDE_DEP: 12 })], frxDatasetEmpresas: emp }, agora,
      { ...vars, FILTRO: "' Qtde. estoque negativa ou zerada '" }));
    expect(t).toContain('RELATÓRIO POSIÇÃO DE ESTOQUE DEPOSITO');
    expect(t).toContain('Qtd. Loja');
    expect(t).toContain('-5');
    expect(t).toContain('12');
    expect(t).toContain('Filtro : Qtde. estoque negativa ou zerada');
  });

  it('estoque atual (Rel_Posicao_Estoque.fr3): os totais e a 2ª página com o resumo por departamento (dbdSubConsulta)', () => {
    const pgs = paginasDoModelo(modelo('produtos-estoque-atual.fr3'), {
      frxDBDatasetEstoque: [prod({ TOTALCUSTO: 150, TOTALVENDA: 300 }), prod({ IDPRODUTO: 11, DESCRICAO: 'FEIJAO 1KG', QTDE: 7, QTDE_DEP: 0, TOTALCUSTO: 42, TOTALVENDA: 70 })],
      dbdSubConsulta: [{ CODDPTO: 3, DESCDEPTO: 'MERCEARIA', QTDE: 37, QTDE_DEP: 12, TOTALCUSTO: 192, TOTALVENDA: 370 }],
    }, agora, vars);
    const t = texto(pgs);
    expect(t).toContain('RESUMO DE ESTOQUE POR DEPARTAMENTO');
    expect(t).toContain('192,00'); // SUM(TOTALCUSTO) do relatório e do resumo
    expect(t).toContain('370,00');
    expect(t).toContain('MERCEARIA');
    expect(pgs.length).toBeGreaterThanOrEqual(2);
  });

  it('estoque por data (Rel_Posicao_Estoque_Por_Data.fr3): SALDO/CUSTO/VENDA são EXPRESSÕES reavaliadas a cada registro, e os totais da coluna escolhida', () => {
    const linhas = [
      { IDEMPRESA: 1, IDPRODUTO: 10, CODDPTO: 3, CODBARRA: '7891000100103', DESCRICAO: 'ARROZ 5KG', TOTAL_ESTOQUE: 30, CUSTO_TOTAL: 150, VENDA_TOTAL: 777, QTDE_ESTOQUE: 30, CUSTO_ESTOQUE: 150, VENDA_ESTOQUE: 777 },
      { IDEMPRESA: 1, IDPRODUTO: 11, CODDPTO: 3, CODBARRA: '7891000100110', DESCRICAO: 'FEIJAO 1KG', TOTAL_ESTOQUE: 8, CUSTO_TOTAL: 48.5, VENDA_TOTAL: 79.2, QTDE_ESTOQUE: 8, CUSTO_ESTOQUE: 48.5, VENDA_ESTOQUE: 79.2 },
    ];
    const t = texto(paginasDoModelo(modelo('produtos-estoque-por-data.fr3'), { frxDBDProd: linhas }, agora, {
      ...vars, DtInicial: "''", DtFinal: "'30/09/2026'", EMPRESAS: "'1'",
      SALDO: '<frxDBDProd."TOTAL_ESTOQUE">', CUSTO: '<frxDBDProd."CUSTO_TOTAL">', VENDA: '<frxDBDProd."VENDA_TOTAL">',
      TOTSALDO: '<SUM(<frxDBDProd."TOTAL_ESTOQUE">,MasterData1)>', TOTCUSTO: '<SUM(<frxDBDProd."CUSTO_TOTAL">,MasterData1)>', TOTVENDA: '<SUM(<frxDBDProd."VENDA_TOTAL">,MasterData1)>',
    }));
    expect(t).toContain('RELATÓRIO POSIÇÃO DO ESTOQUE POR DATA');
    expect(t).toContain('até 30/09/2026');
    expect(t).toContain('48.5'.replace('.', ',')); // o custo do 2º registro, não o do 1º
    expect(t).toContain('856,20'); // TOTVENDA = 777 + 79,20
    expect(t).toContain('198,50'); // TOTCUSTO
    expect(t).toContain('38,00'); // TOTSALDO
  });

  it('lista para conferência (prod_Lista_Conferencia.fr3): por fornecedor, as colunas de contagem em branco; recolhida sem "expandir"', () => {
    const lin = [prod({ CODFOR: 7 }), prod({ CODFOR: 7, IDPRODUTO: 11, DESCRICAO: 'FEIJAO 1KG' })];
    const aberto = modelo('produtos-lista-conferencia.fr3').replace(/(<TfrxGroupHeader Name="GroupHeader1"[^>]*?) DrillDown="True"/, '$1 DrillDown="False"');
    const t = texto(paginasDoModelo(aberto, { frxDataSetProdutos: lin, frxDatasetEmpresas: emp }, agora, vars));
    expect(t).toContain('CEREALISTA SUL Fornecedor 7');
    expect(t).toContain('FEIJAO 1KG');
    expect(t).toContain('Qtd. Cont. Dep');
    const fechado = texto(paginasDoModelo(modelo('produtos-lista-conferencia.fr3'), { frxDataSetProdutos: lin, frxDatasetEmpresas: emp }, agora, vars));
    expect(fechado).toContain('CEREALISTA SUL');
    expect(fechado).not.toContain('FEIJAO 1KG');
  });

  it('alterações de preço (Alteracoes_preco.fr3): por código de barras; o EXPANDIDO abre o grupo (o script do layout)', () => {
    const lin = [
      { CODBARRA: '7891000100103', DESCRICAO: 'ARROZ 5KG', CODEMPRESA: 1, DATA: '2026-09-10T09:00:00', VALOR_ANTERIOR: '10,00', VALOR_ATUAL: '12,50', NOME: 'MARIA', HISTORICO: 'Cadastro de produtos' },
      { CODBARRA: '7891000100103', DESCRICAO: 'ARROZ 5KG', CODEMPRESA: 1, DATA: '2026-09-12T14:30:00', VALOR_ANTERIOR: '12.50', VALOR_ATUAL: '9.90', NOME: 'JOAO', HISTORICO: 'Alteracao do Valor de Venda' },
    ];
    const t = texto(paginasDoModelo(modelo('produtos-alteracoes-preco.fr3'), { FrxRelGeral: lin }, agora, { ...vars, EXPANDIDO: "'S'" }));
    expect(t).toContain('ALTERAÇÕES DE PREÇOS DOS PRODUTOS');
    expect(t).toContain('Empresas: 1,2');
    expect(t).toContain('ARROZ 5KG');
    expect(t).toContain('Cadastro de produtos');
    expect(t).toContain('12.50'); // o texto como foi gravado (o %2.2n do layout não formata texto)
    expect(t).toContain('10,00 10,00'); // o layout do cliente imprime VALOR_ANTERIOR também na coluna "Valor novo" (defeito do .fr3)
    expect(t).toContain('JOAO');
    const fechado = texto(paginasDoModelo(modelo('produtos-alteracoes-preco.fr3'), { FrxRelGeral: lin }, agora, vars));
    expect(fechado).toContain('ARROZ 5KG');
    expect(fechado).not.toContain('JOAO');
  });

  it('percas, lotes, inativos, vendas no período, por fornecedor e os dois comparativos de mix', () => {
    const percas = texto(paginasDoModelo(modelo('produtos-percas.fr3'), { frxDBDPercas: [{ IDPRODUTO: 10, CODBARRA: '7891000100103', DESCRICAO: 'ARROZ 5KG', ENTRADAS: 100, SAIDAS: 80, QTD_PERCAS: 5, VALOR_PERCAS: 25, PERC_PERCAS: 5 }] }, agora, vars));
    expect(percas).toContain('RELATÓRIO DE PERCAS');
    expect(percas).toContain('5,00 %');
    const lotes = texto(paginasDoModelo(modelo('produtos-lotes-validades.fr3'), { frxDBDPrdutosLoteVal: [{ IDEMPRESA: 1, IDPRODUTO: 10, CODBARRA: '7891000100103', DESCRICAO: 'ARROZ 5KG', UNIDADE: 'UN', FATORCX: 1, LOTE: 'L123', DTVALIDADE: '2026-12-31', FORNECEDOR: 'CEREALISTA SUL', ESTOQUE_ATUAL: 30 }] }, agora,
      { ...vars, FORNECEDOR: "'Todos'", DEPTO: "'MERCEARIA'", GRUPO: "'Todos'", SUBGRUPO: "'Todos'" }));
    expect(lotes).toContain('L123');
    expect(lotes).toContain('31/12/2026');
    expect(lotes).toContain('MERCEARIA');
    const inat = texto(paginasDoModelo(modelo('produtos-inativos-agenda.fr3'), { dbdRelProdAtivo: [{ CODBARRA: '7891000100103', DESCRICAO: 'ARROZ 5KG', UNIDADE: 'UN', DEPTO: 'MERCEARIA', VRVENDA: 25.9, VLRPROMOCAO: 22.9, CODAGENDA: 77, NOMEPROMO: 'SEMANA DO ARROZ', TV: 'T', ATUALIZACAO_GRUPO: 'N', RADIO: 'N', TABLOIDE: 'N', INTERNO: 'N' }] }, agora, vars, { Empresas: 'Empresa: 1' }));
    expect(inat).toContain('SEMANA DO ARROZ');
    expect(inat).toContain('Empresa: 1');
    expect(inat).toContain('Qtde. Registros: 1');
    const vp = texto(paginasDoModelo(modelo('produtos-estoque-vendas-periodo.fr3'), { FrxRelGeral: [{ ...prod({}), QTDE_VENDIDA: 40, VRCUSTO_UNI: 4.9, VRVENDA_UNI: 9.9, VRCUSTO: 5, VRVENDA: 10 }] }, agora, vars));
    expect(vp).toContain('ESTOUE ATUAL/VENDAS NO PERÍODO');
    expect(vp).toContain('40,00');
    const pf = texto(paginasDoModelo(modelo('produtos-por-fornecedor.fr3'), { dbdConsulta: [{ FANTASIA: 'CEREALISTA SUL', CODPRODNOTA: 'A-77', DESCRICAO: 'ARROZ TIPO 1 5KG', ULT_CODNF: 15433, ULT_DATA: '2026-09-02', ULT_QTDE: 50, QTD_VENDIDA: 20, ESTOQUE_ATUAL: 30, ESTOQUE_DT_ENTRADA: 50, VRCUSTO: 21.5, FATOREMBAL: 1 }], dbdEmpresa: emp }, agora, vars));
    expect(pf).toContain('Fornecedor : CEREALISTA SUL');
    expect(pf).toContain('A-77');
    expect(pf).toContain('Empresa(s): HIPER PINHEIRAO');
    const ml = texto(paginasDoModelo(modelo('produtos-mix-estoque-loja.fr3'), { dbdConsulta: [{ IDPRODUTO: 10, CODBARRA: '7891000100103', DESCRICAO: 'ARROZ 5KG', QTDE: 30, LOJA_SEM_ESTOQUE: '2, 51' }] }, agora, vars));
    expect(ml).toContain('2, 51');
    const mg = texto(paginasDoModelo(modelo('produtos-mix-estoque-giros.fr3'), { dbdConsulta: [{ IDEMPRESA: 2, RAZAOSOCIAL: 'PINHEIRAO LOJA 2', IDPRODUTO: 10, CODBARRA: '7891000100103', DESCRICAO: 'ARROZ 5KG', TOTAL_ESTOQUE: 30 }] }, agora, vars));
    expect(mg).toContain('Empresa : 2 - PINHEIRAO LOJA 2');
  });
});

describe('pedidos de compra — previsão de pagamentos (Pedidos_Compra_Previsao_Financeira*.fr3)', () => {
  const parc = (o: Record<string, unknown>) => ({ IDEMPRESA: 1, CODPARCEIRO: 22, NROPEDIDO: 31837, FORNECEDOR: 'CEREALISTA SUL', DATA_PEDIDO: '2026-09-10', DT_VENCIMENTO: '2026-10-10',
    DT_FATURAMENTO: '2026-09-12', DT_VENC_PARC: '2026-10-12', CONDPAG: 30, VALOR_PARCELA: 18, STATUS: 'Aberto', ...o });
  const vars = { PERIODO: "'Data do Pedido  de 01/09/2026 até 30/09/2026'", STATUS: "'Status dos Pedidos:  Abertos e Fechados.'", EMPRESAS: "'Empresa(s): 1,2'" };
  it('por fornecedor: as parcelas, o total do fornecedor e o geral; por faturamento: a quebra pela data', () => {
    const linhas = [parc({}), parc({ DT_VENC_PARC: '2026-11-11', CONDPAG: 60 }), parc({ CODPARCEIRO: 23, FORNECEDOR: 'LATICINIOS TREVO', NROPEDIDO: 31840, VALOR_PARCELA: 30.5 })];
    const t = texto(paginasDoModelo(modelo('pedidos-compra-previsao.fr3'), { frxDBVencimentos: linhas }, agora, vars));
    expect(t).toContain('PEDIDOS DE COMPRA - PREVISÃO DE PAGAMENTOS');
    expect(t).toContain('Data do Pedido de 01/09/2026 até 30/09/2026'.replace('Pedido de', 'Pedido  de').replace(/\s+/g, ' '));
    expect(t).toContain('CEREALISTA SUL');
    expect(t).toContain('12/10/2026');
    expect(t).toContain('Total Fornecedor: 36,00');
    expect(t).toContain('Total Geral : 66,50');
    expect(t).toContain('Empresa(s): 1,2');
    const f = texto(paginasDoModelo(modelo('pedidos-compra-previsao-datafatu.fr3'), { frxDBVencimentos: linhas }, agora, vars));
    expect(f).toContain('12/09/2026 Data Faturamento:');
    expect(f).toContain('Total Fornecedor: 66,50'); // os cinco layouts rotulam o total do grupo como "Total Fornecedor"
    expect(f).toContain('LATICINIOS TREVO');
  });
});

describe('apuração PIS/COFINS (ApuracaoPis_Cofins.fr3)', () => {
  it('as variáveis numéricas do btnImprimirClick no layout, com a empresa do login e a competência', () => {
    const vars: Record<string, string> = { REFERENCIA: "'Competencia: 01/05/2040 até 31/05/2040'", TOTRECNF: '7.89', TOTRECECF: '1234.5', BASEAPURACAO: '1242.39',
      TOTDEBSAIPIS: '-0.13', TOTDEBSAICOF: '-0.6', TOTBENSREV: '632', TOTVALCREENTPIS: '9.93', TOTVALRECPIS: '9.8', TOTVALRECCOF: '45.12' };
    const t = texto(paginasDoModelo(modelo('apuracao-pis-cofins.fr3'), { frxDBDataset2: [{ ...empresa, INSC: '0012345', FONE1: '3433334444' }] }, agora, vars));
    expect(t).toContain('Apuração PIS / COFINS');
    expect(t).toContain('Competencia: 01/05/2040 até 31/05/2040');
    expect(t).toContain('HIPER PINHEIRAO LTDA');
    expect(t).toContain('1.234,50');
    expect(t).toContain('-0,13');
    expect(t).toContain('9,80');
    // o [Date] com 'dd de mmmm, yyyy': no FormatDateTime do Delphi o "d" de "de" também é o dia (o layout não pôs o texto entre aspas)
    expect(t).toContain('30 30e setembro, 2026');
  });
});

describe('consulta de baixas: dados do pagamento / recebimento (DadosPagamentoCP.fr3, DadosRecebimentoCR.fr3)', () => {
  const emp = [{ CODEMPRESA: 1, FANTASIA: 'HIPER PINHEIRAO' }];
  const recursos = [{ NROCONTA: '12345-6', TITULAR: 'CAIXA LOJA 1', MODALIDADE: 'DINHEIRO', VALOR: -150 }];
  it('o pagamento: títulos, recursos (o valor sem sinal), cheques de terceiros vazios e os próprios', () => {
    const t = texto(paginasDoModelo(modelo('dados-pagamento-cp.fr3'), {
      DbdEmpresa: emp, DbdRecursos: recursos, DbdChequesRepassados: [],
      DbdTitulos: [{ CODIGO_DOCUMENTO: 9001, FORNECEDOR: 'CEREALISTA SUL', VALOR_PAGO: 100, DATA_COMPRA: '2026-09-01', DATA_VENCEU: '2026-09-30', DATA_PAGAMENTO: '2026-10-01' },
        { CODIGO_DOCUMENTO: 9002, FORNECEDOR: 'LATICINIOS TREVO', VALOR_PAGO: 50, DATA_COMPRA: '2026-09-02', DATA_VENCEU: '2026-09-30', DATA_PAGAMENTO: '2026-10-01' }],
      DbdChequesProprios: [{ NROCHEQUE: 4455, RAZAO: 'CEREALISTA SUL', VALOR: 30, DTEMISSAO: '2026-10-01', DTVENC: '2026-11-01' }],
    }, agora));
    expect(t).toContain('Dados do pagamento');
    expect(t).toContain('Empresa: 1 - HIPER PINHEIRAO');
    expect(t).toContain('LATICINIOS TREVO');
    expect(t).toContain('150,00'); // SUM(VALOR_PAGO) e o recurso de −150 sem o sinal
    expect(t).toContain('CAIXA LOJA 1');
    expect(t).toContain('Cheques próprios');
    expect(t).toContain('4455');
  });
  it('o recebimento: o cliente, os cheques recebidos e as permutas', () => {
    const t = texto(paginasDoModelo(modelo('dados-recebimento-cr.fr3'), {
      DbdEmpresa: emp, DbdRecursos: [{ ...recursos[0], VALOR: 80 }], DbdPermutas: [],
      DbdTitulos: [{ CODIGO_DOCUMENTO: 7001, CLIENTE: 'JOSE DA SILVA', VALOR_PAGO: 80, DATA_VENDA: '2026-09-10', DATA_VENCEU: '2026-10-05', DATA_PAGAMENTO: '2026-10-05' }],
      DbdChequesRepassados: [{ NROCHEQUE: '000777', TITULAR: 'JOSE DA SILVA', VALOR: 80, DTEMISSAO: '2026-10-04', BOMPARA: '2026-11-04' }],
    }, agora));
    expect(t).toContain('Dados do recebimento');
    expect(t).toContain('JOSE DA SILVA');
    expect(t).toContain('000777');
    expect(t).toContain('04/11/2026');
  });
});

describe('análise de entrada × saída (extr - AnaliseEntradaXSaida*.fr3)', () => {
  const rows = [
    { CODFOR: 2, FORNECEDOR: 'CEREALISTA SUL', CODBARRA: '7891000100103', PRODUTO: 'ARROZ 5KG', CODGRUPO: 10, DESC_GRUPO: 'GRAOS', QTD_ENTRADA: 100, QTD_SAIDA: 0, CODDPTO: 3, DEPTO: 'MERCEARIA' },
    { CODFOR: 2, FORNECEDOR: 'CEREALISTA SUL', CODBARRA: '7891000100103', PRODUTO: 'ARROZ 5KG', CODGRUPO: 10, DESC_GRUPO: 'GRAOS', QTD_ENTRADA: 0, QTD_SAIDA: 70, CODDPTO: 3, DEPTO: 'MERCEARIA' },
    { CODFOR: 2, FORNECEDOR: 'CEREALISTA SUL', CODBARRA: '7891000100110', PRODUTO: 'FEIJAO 1KG', CODGRUPO: 10, DESC_GRUPO: 'GRAOS', QTD_ENTRADA: 40, QTD_SAIDA: 0, CODDPTO: 3, DEPTO: 'MERCEARIA' },
  ];
  const vars = { DtIncial: "'01/09/2026'", DtFinal: "'30/09/2026'", Titulo: "'Análise Entradas X Saídas'" };
  const emp = [{ ...empresa, ENDERECO: 'AV BRASIL 100', BAIRRO: 'CENTRO', CIDADE: 'UBERLANDIA' }];
  it('com itens: o produto em duas linhas (entrada e saída) e os totais por fornecedor, grupo e departamento', () => {
    const t = texto(paginasDoModelo(modelo('analise-entrada-saida-itens.fr3'), { frxDBAnalise: rows, frxDBEmpresa: emp }, agora, vars));
    expect(t).toContain('Análise Entradas X Saídas');
    expect(t).toContain('01/09/2026');
    expect(t).toContain('Departamento: MERCEARIA');
    expect(t).toContain('FEIJAO 1KG');
    expect(t).toContain('140,000'); // SUM(QTD_ENTRADA)
    expect(t).toContain('70,000');
  });
  it('sem itens: só os totais (a banda dos produtos é invisível)', () => {
    const t = texto(paginasDoModelo(modelo('analise-entrada-saida.fr3'), { frxDBAnalise: rows, frxDBEmpresa: emp }, agora, vars));
    expect(t).not.toContain('FEIJAO 1KG');
    expect(t).toContain('140,000');
    expect(t).toContain('CEREALISTA SUL');
  });
});

describe('vendas e finalizadoras (Rel_Finalizadoras[_Vertical].fr3)', () => {
  const emp = [{ RAZAOSOCIAL: 'HIPER PINHEIRAO LTDA', CNPJ: '37954975000169' }];
  const vars = { PERIODO: "'Periodo: 20/08/2026 até 21/08/2026'", V_TOTAL_VENDA: '67' };
  it('horizontal: as colunas por forma que o legado cria no layout, com os totais e a participação', () => {
    // o que o servidor faz (rel-finalizadoras.service.ts): um memo por forma no PageHeader1 e no MasterData1, de Left 398 em 90
    const memo = (nome: string, left: number, top: number, h: number, texto: string) =>
      `<TfrxMemoView Name="${nome}" Left="${left}" Top="${top}" Width="90" Height="${h}" Font.Charset="1" Font.Color="0" Font.Height="-11" Font.Name="Courier New" Font.Style="0" HAlign="haRight" ParentFont="False" WordWrap="False" Text="${texto}"/>`;
    let xml = modelo('finalizadoras.fr3');
    xml = xml.replace(/(<TfrxPageHeader[^>]*Name="PageHeader1"[^>]*>)/, `$1${memo('MemoTituloP1', 398, 3.45671, 26.45671, 'DINHEIRO')}`);
    xml = xml.replace(/(<TfrxMasterData[^>]*Name="MasterData1"[^>]*>)/, `$1${memo('MemoCampo1', 398, -0.48, 18.51968504, "[formatFloat(',0.00',&lt;FrxFinalizadoras.&quot;DINHEIRO&quot;&gt;)]")}`);
    const rows = [
      { DATA: '2026-08-20T00:00:00', TOTAL_VENDA: 46, DESCONTO: 4, ACRESCIMO: 0, CANCELAMENTO: 0, DINHEIRO: 1046 },
      { DATA: '2026-08-21T00:00:00', TOTAL_VENDA: 21, DESCONTO: 0, ACRESCIMO: 1, CANCELAMENTO: 99, DINHEIRO: 0 },
      { DATA: null, TOTAL_VENDA: 67, DESCONTO: 4, ACRESCIMO: 1, CANCELAMENTO: 99, DINHEIRO: 1046 },
      { DATA: null, TOTAL_VENDA: null, DESCONTO: null, ACRESCIMO: null, CANCELAMENTO: null, DINHEIRO: 1561.19 },
    ];
    const t = texto(paginasDoModelo(xml, { FrxFinalizadoras: rows, FrxEmpresas: emp }, agora, vars));
    expect(t).toContain('RELATÓRIO DE FINALIZADORAS DIÁRIO');
    expect(t).toContain('Periodo: 20/08/2026 até 21/08/2026');
    expect(t).toContain('DINHEIRO');
    expect(t).toContain('1.046,00');
    expect(t).toContain('1.561,19');
    expect(t).toContain('20/08/2026');
    expect(t).toContain('99,00');
  });
  it('vertical: a lista por dia sem as quatro medidas (o script as tira e usa nos totais) e a página dos totais com o % do total', () => {
    const lin = (dia: string, f: string, v: number) => ({ DATA: `${dia}T00:00:00`, FORMA_PGTO: f, VALOR: v });
    const rows = [
      lin('2026-08-20', 'Total venda', 46), lin('2026-08-20', 'Descontos', 4), lin('2026-08-20', 'Acréscimos', 0), lin('2026-08-20', 'Cancelamentos', 0), lin('2026-08-20', 'Dinheiro', 46),
      lin('2026-08-21', 'Total venda', 21), lin('2026-08-21', 'Descontos', 0), lin('2026-08-21', 'Acréscimos', 1), lin('2026-08-21', 'Cancelamentos', 99), lin('2026-08-21', 'Cartoes', 15),
    ];
    const tot = [{ FORMA_PGTO: 'Total venda', VALOR: 67 }, { FORMA_PGTO: 'Descontos', VALOR: 4 }, { FORMA_PGTO: 'Acréscimos', VALOR: 1 }, { FORMA_PGTO: 'Cancelamentos', VALOR: 99 }, { FORMA_PGTO: 'Dinheiro', VALOR: 46 }, { FORMA_PGTO: 'Cartoes', VALOR: 15 }];
    const t = texto(paginasDoModelo(modelo('finalizadoras-vertical.fr3'), { FrxFinalizadoras: rows, FrxDBTotais: tot, FrxEmpresas: emp }, agora, vars));
    expect(t).toContain('Dinheiro');
    expect(t).toContain('Cartoes');
    expect(t).not.toContain('Total venda');
    expect(t).toContain('Total: 46,00'); // o TotalVendas do script, tirado da linha "Total venda" do dia
    expect(t).toContain('Cancelamentos: 99,00');
    expect(t).toContain('22,39 %'); // 15 ÷ V_TOTAL_VENDA 67
  });
});

describe('recibo de adiantamento (ReciboAdiantamentoParceiro.fr3) e o NumeroExtenso', () => {
  it('o extenso do português: centenas, milhares, milhões e o "e" de ligação; com moeda, reais e centavos', async () => {
    const { numeroExtenso } = await import('@apollo/shared');
    expect(numeroExtenso(150)).toBe('cento e cinquenta');
    expect(numeroExtenso(100)).toBe('cem');
    expect(numeroExtenso(1100)).toBe('mil e cem');
    expect(numeroExtenso(1234)).toBe('mil duzentos e trinta e quatro');
    expect(numeroExtenso(2500000)).toBe('dois milhões e quinhentos mil');
    expect(numeroExtenso(21)).toBe('vinte e um');
    expect(numeroExtenso(1.5, true)).toBe('um real e cinquenta centavos');
    expect(numeroExtenso(150.25)).toBe('cento e cinquenta vírgula vinte e cinco');
  });
  it('o texto do script do layout: devedor (D) e credor (C), com o valor por extenso', () => {
    const r = (tipo: string) => [{ CODADIANTAMENTO: 77, DTADIANTAMENTO: '2026-09-22T00:00:00', RAZAO: 'CEREALISTA SUL', FANTASIA: 'HIPER PINHEIRAO', VALOR: 1500, TIPO: tipo }];
    const d = texto(paginasDoModelo(modelo('recibo-adiantamento.fr3'), { DbdRelatorio: r('D') }, agora));
    expect(d).toContain('RECIBO DE ADIANTAMENTO DE PARCEIROS');
    expect(d).toContain('Eu, CEREALISTA SUL recebi um adiantamento da empresa HIPER PINHEIRAO, no dia 22/09/2026, no valor de 1500,00 (mil e quinhentos) reais.');
    const c = texto(paginasDoModelo(modelo('recibo-adiantamento.fr3'), { DbdRelatorio: r('C') }, agora));
    expect(c).toContain('Eu, HIPER PINHEIRAO recebi um adiantamento de CEREALISTA SUL');
  });
});

describe('boleto (BoletoFR.fr3, datasets do ACBr) e duplicata (dup_Duplicata001_1.fr3) do FRMCONFBOLETO', () => {
  const banco = [{ Numero: '341', Digito: '7', Nome: 'Banco Itau', DirLogo: '', OrientacoesBanco: '', CIP: '' }];
  const cedente = [{ Nome: 'JF SUPERMERCADOS LTDA', CodigoCedente: '23055-1', Agencia: '3034', CNPJCPF: '37.954.975/0001-69', Logradouro: 'AVENIDA SACRAMENTO', NumeroRes: '1817', Complemento: '', Bairro: 'MARTINS', Cidade: 'UBERLANDIA', UF: 'MG', CEP: '38400466' }];
  const titulo = (cod: number, nn: string) => ({
    NossoNum: nn, NumeroDocumento: String(cod), Vencimento: '2026-10-20', DataDocumento: '2026-10-01', DataProcessamento: '2026-10-06T00:00:00',
    EspecieDoc: 'DM', EspecieMod: 'R$', Aceite: 'N', Carteira: '109', UsoBanco: '', ValorDocumento: 1234.5,
    LocalPagamento: 'Pagável em qualquer banco até o vencimento', Mensagem: 'APOS VENCIMENTO NAO DISPENSAR JUROS E MULTA\nMORA DIA/COM. PERMANÊNCIA: R$ 1,23',
    CodBarras: '34191123400001234501090013473720303423055100', LinhaDigitavel: '34191.09008 13473.720306 34230.551009 1 12340000123450', CodCedente: '23055-1',
    Sacado_NomeSacado: '81 - CLIENTE BOLETO LTDA', Sacado_CNPJCPF: '12.345.678/0001-90', Sacado_Logradouro: 'RUA A', Sacado_Numero: '10', Sacado_Complemento: '',
    Sacado_Bairro: 'CENTRO', Sacado_Cidade: 'UBERLANDIA', Sacado_UF: 'MG', Sacado_CEP: '38400000', Sacado_Avalista: '', Sacado_Avalista_CNPJCPF: '',
  });

  it('um boleto por página: banco-dígito, o código do beneficiário que o script põe no lugar da agência, a linha digitável e o código de barras', () => {
    const pgs = paginasDoModelo(modelo('boleto-fr.fr3'), { Banco: banco, Cedente: cedente, Titulo: [titulo(134737, '109/00134737-2'), titulo(134732, '109/00134732-3')] }, agora);
    const t = texto(pgs);
    expect(pgs.length).toBe(2);
    expect(t).toContain('341-7');
    expect(t).toContain('JF SUPERMERCADOS LTDA');
    expect(t).toContain('109/00134737-2');
    expect(t).toContain('109/00134732-3');
    expect(t).toContain('34191.09008 13473.720306 34230.551009 1 12340000123450');
    expect(t).toContain('1.234,50');
    expect(t).toContain('20/10/2026');
    expect(t).toContain('81 - CLIENTE BOLETO LTDA');
    expect(t).toContain('MORA DIA/COM. PERMANÊNCIA: R$ 1,23');
    expect(t).toContain('Pagável em qualquer banco até o vencimento');
    // MDOnBeforePrint: fora da Caixa (104), "Agência / Código do Beneficiário" recebe só o Cedente.CodigoCedente
    expect(t).toContain('23055-1');
    expect(t).not.toContain('3034/23055-1');
    expect(pgs[0].html.join('')).toContain('<svg');
  });

  it('a duplicata: o cliente, o vencimento e o valor por extenso com moeda', async () => {
    const { numeroExtenso } = await import('@apollo/shared');
    const reg = { CODRCB: 501, DUPLICATA: '4356/1', DOCNF: '4356', OBS: 'INCLUSAO AUTOMATICA FINANCEIRO', DTVENDA: '2026-10-01T00:00:00', DTVENC: '2026-10-31T00:00:00',
      VALOR: 1500.25, NOMECLIENTE: 'CLIENTE DUPLICATA LTDA', ENDERECO: 'RUA B', BAIRRO: 'CENTRO', CIDADE: 'UBERLANDIA', UF: 'MG', CEP: '38400-000',
      CNPJ_CPF: '12.345.678/0001-90', RG_INSC: 'ISENTO', VALOR_EXTENSO: numeroExtenso(1500.25, true) };
    const t = texto(paginasDoModelo(modelo('duplicata-001-1.fr3'), { dbdDuplicata: [reg] }, agora));
    expect(reg.VALOR_EXTENSO).toBe('mil e quinhentos reais e vinte e cinco centavos');
    expect(t).toContain('mil e quinhentos reais e vinte e cinco centavos');
    expect(t).toContain('CLIENTE DUPLICATA LTDA');
    expect(t).toContain('31/10/26');
    expect(t).toContain('1.500,25');
    expect(t).toContain('4356/1');
    expect(numeroExtenso(1000000, true)).toBe('um milhão de reais');
  });
});

describe('livro de apuração do ICMS (Notas_fiscais_Registro_Apuracao.fr3, FRMRELREGISTROS_ES)', () => {
  const d = (TIPO: string, CFOP: number, TOTALNF: number, BASE: number, VALOR_ICMS: number, ISENTAS_NAOTRIB: number, OUTRAS: number) =>
    ({ TIPO, CFOP, ESPECIE: 'NF', CODIGO: `${CFOP}NF`, CST: 0, ICMS: 18, ICMS_EFETIVO: 100, TOTALNF, BASE, VALOR_ICMS, ISENTAS_NAOTRIB, OUTRAS });
  const seta = (n: number) => ({ TIPO: '000', CFOP: n * 1000, ESPECIE: '000', CODIGO: '000', CST: 0, ICMS: 0, ICMS_EFETIVO: 0, TOTALNF: 0, BASE: 0, VALOR_ICMS: 0, ISENTAS_NAOTRIB: 0, OUTRAS: 0 });
  const det = [d('E', 1102, 1000, 800, 96, 200, 0), d('E', 1102, 500, 500, 60, 0, 0), d('E', 1403, 300, 0, 0, 0, 300), d('S', 5102, 2000, 2000, 360, 0, 0), d('S', 5405, 700, 0, 0, 0, 700)];
  const ds = {
    frxDBDatasetTemp: det,
    frxDBDatasetCFOP: [seta(5), det[3], det[4], seta(6), seta(7)],
    frxDBDatasetCFOPE: [seta(1), det[0], det[1], det[2], seta(2), seta(3)],
    frxDBDataset2: [{ RAZAOSOCIAL: 'JF SUPERMERCADOS LTDA', CNPJ: '37.954.975/0001-69', INSC: '0037992540050' }],
  };
  const vars = { LIVRO: "'3'", FOLHA: "'1'", MES: "'MES OU PERÍODO: 01/01/2026 até 31/01/2026'", DEBITOS: '360', OUTROSDEBITOS: '0', ESTORNOCREDITOS: '0',
    TOTALDEBITOS: '360', CREDITOS: '156', OUTROSCREDITOS: '10', ESTORNODEBITOS: '0', SUBTOTALCREDITOS: '166', SALDOCREDPERANT: '7', TOTALCREDITOS: '173',
    SALDODEVEDOR: '187', DEDUCOES: '0', ARECOLHER: '187', SALDOCREDPERSEG: '0' };

  it('os rodapés por CFOP somam o detalhe, o sub-relatório dá os subtotais por dígito e a última página traz o quadro do E110', () => {
    const pgs = paginasDoModelo(modelo('registro-apuracao.fr3'), ds, agora, vars);
    const t = texto(pgs);
    expect(t).toContain('LIVRO REGISTRO DE APURAÇÃO DO ICMS');
    expect(t).toContain('JF SUPERMERCADOS LTDA');
    expect(t).toContain('MES OU PERÍODO: 01/01/2026 até 31/01/2026');
    expect(t).toContain('1.500,00'); // 1102: 1000 + 500 de valor contábil
    expect(t).toContain('1.300,00'); // 1102: base 800 + 500
    expect(t).toContain('156,00');   // 1102: ICMS 96 + 60
    expect(t).toContain('2.000,00'); // 5102
    expect(t).toContain('1.800,00'); // subtotal das entradas do dígito 1 (1500 + 300)
    expect(t).toContain('2.700,00'); // subtotal das saídas do dígito 5 (2000 + 700)
    expect(t).toContain('001 - POR SAIDAS / PRESTACOES COM CREDITO DE IMPOSTO');
    expect(t).toContain('360,00');
    expect(t).toContain('173,00');
    expect(t).toContain('187,00');
    // o script do cabeçalho troca o título das colunas por tipo (o arquivo mistura UTF-8 e latin-1, como a API decodifica)
    expect(t).toContain('Operação com crédito de imposto');
    expect(t).toContain('Operação com débito de imposto');
    // Memo31OnBeforePrint: `Pagina: Integer` recebe a FOLHA ('1') — a local tipada converte, e a folha da página do E110 é 1 (não '11')
    expect(texto([pgs[pgs.length - 1]])).toMatch(/FOLHA\.+: 1 /);
  });
});

describe('livro de Registro de Entradas (Notas_fiscais_Registro_Entrada.fr3, FRMRELREGISTROS_ES menu 186)', () => {
  it('cada nota com o seu resultado por CFOP no sub-relatório, os totais e as alíquotas no fim', () => {
    const notas = [
      { NRONF: 4356, CODIGO: '101NF', DTEMISSAO: '2026-09-02T00:00:00', TOTAL: 1500, DTCHEGADA: '2026-09-03T00:00:00', SERIE: '1', RAZAO: 'LATICINIOS TREVO LTDA', CODPARCEIRO: 77, UF: 'MG', ESPECIE: 'NF' },
      { NRONF: 812, CODIGO: '102NF', DTEMISSAO: '2026-09-04T00:00:00', TOTAL: 300, DTCHEGADA: '2026-09-05T00:00:00', SERIE: '2', RAZAO: 'CEREALISTA SUL', CODPARCEIRO: 88, UF: 'GO', ESPECIE: 'NF' },
    ];
    const det = [
      { CODIGO: '101NF', CFOP: 1102, ICMS: 12, ICMS_EFETIVO: 12, CST: 0, BASE: 1000, VALOR_ICMS: 120, ISENTAS_NAOTRIB: 0, OUTRAS: 0, TOTALNF: 1000, __MESTRE: 0 },
      { CODIGO: '101NF', CFOP: 1403, ICMS: 0, ICMS_EFETIVO: 0, CST: 60, BASE: 0, VALOR_ICMS: 0, ISENTAS_NAOTRIB: 0, OUTRAS: 500, TOTALNF: 500, __MESTRE: 0 },
      { CODIGO: '102NF', CFOP: 2102, ICMS: 7, ICMS_EFETIVO: 7, CST: 0, BASE: 300, VALOR_ICMS: 21, ISENTAS_NAOTRIB: 0, OUTRAS: 0, TOTALNF: 300, __MESTRE: 1 },
    ];
    const pgs = paginasDoModelo(modelo('registro-entrada.fr3'), {
      frxDBDatasetNF: notas, frxDBDatasetCFOP_ICMS: det, frxDBDatasetICMS: [{ ICMS: 12, VALOR: 120 }, { ICMS: 0, VALOR: 0 }, { ICMS: 7, VALOR: 21 }],
      frxDBDataset2: [{ RAZAOSOCIAL: 'JF SUPERMERCADOS LTDA', CNPJ: '37.954.975/0001-69', INSC: '0037992540050' }],
    }, agora, { LIVRO: "'2'", FOLHA: "'5'", MES: "'MES OU PERÍODO: 01/09/2026 até 30/09/2026'" });
    const t = texto(pgs);
    expect(t).toContain('LIVRO REGISTRO DE ENTRADAS - RE - MODELO P1');
    expect(t).toContain('REGISTRO DE ENTRADAS Nr 2');
    expect(t).toContain('000004356');            // FormatFloat('000000000', NRONF)
    expect(t).toContain('LATICINIOS TREVO LTDA');
    expect(t).toContain('1102');
    expect(t).toContain('1403');
    expect(t).toContain('2102');
    expect(t).toContain('1.000,00');
    expect(t).toContain('1.800,00');             // o total contábil das notas (SUM do frxDBDatasetNF.TOTAL)
    expect(t).toContain('1.300,00');             // a base somada do sub-relatório (1000 + 300)
    expect(t).toContain('141,00');               // as alíquotas no fim: 120 + 21
    expect(t).toMatch(/FOLHA\.+: 5 /);
  });
});

describe('livro de Registro de Saídas (Notas_fiscais_Registro_Saida.fr3, menu 187)', () => {
  it('o número da nota com 9 dígitos quando a espécie é NF e o CFOP/OUTRAS que o script do detalhe escreve', () => {
    const pgs = paginasDoModelo(modelo('registro-saida.fr3'), {
      frxDBDatasetNF: [{ NRONF: 77, CODIGO: '201NF', DTEMISSAO: '2026-09-02T00:00:00', TOTAL: 250, DTCHEGADA: '2026-09-02T00:00:00', SERIE: '1', RAZAO: 'CLIENTE SAIDA', CODPARCEIRO: 20, UF: 'MG', ESPECIE: 'NF' }],
      frxDBDatasetCFOP_ICMS: [{ CODIGO: '201NF', CFOP: 5102, ICMS: 18, ICMS_EFETIVO: 18, CST: 0, BASE: 200, VALOR_ICMS: 36, ISENTAS_NAOTRIB: 0, OUTRAS: 50, TOTALNF: 250, ESPECIE: 'NF', __MESTRE: 0 }],
      frxDBDataset2: [{ RAZAOSOCIAL: 'JF SUPERMERCADOS LTDA', CNPJ: '37.954.975/0001-69', INSC: '0037992540050' }],
    }, agora, { LIVRO: "'1'", FOLHA: "'1'", MES: "'MES OU PERÍODO: 01/09/2026 até 30/09/2026'" });
    const t = texto(pgs);
    expect(t).toContain('CLIENTE SAIDA');
    expect(t).toContain('000000077');
    expect(t).toContain('5102');
    expect(t).toContain('50,00');
    expect(t).toContain('36,00');
  });
});

describe('precificação NF (PrecificacaoNF.fr3, FRMPRECIFICACAONF)', () => {
  it('a grade como está, o grupo por empresa com a margem média e a contagem, e a margem média geral do agregado', () => {
    const l = (CODPRODNOTA: string, DESCRICAO: string, MARKUP: number, PRECO_VENDA: number) => ({
      IDEMPRESA: 1, CODPRODNOTA, DESCRICAO, QUANTIDADE: 12, VRCUSTO: 4.5, ULTCUSTO: 4.3, VRVENDA: 6.49, PMZ: 5.1, VRVENDASUG: 6.79, MARKUP, PRECO_VENDA, MEDIAMARGEM: 40,
    });
    const t = texto(paginasDoModelo(modelo('precificacao-nf.fr3'), { frxDBDataset1: [l('049800035324', 'CHANTILLY AMERICA', 50, 6.75), l('7891000', 'ACHOCOLATADO 400G', 30, 5.85)] },
      agora, { DtInicial: "'02/09/2026'", DtFinal: "'06/10/2026 10:05:00'" }));
    expect(t).toContain('PRECIFICAÇÃO NF');
    expect(t).toContain('Período: 02/09/2026 até 06/10/2026 10:05:00');
    expect(t).toContain('CHANTILLY AMERICA');
    expect(t).toContain('049800035324');
    expect(t).toContain('Empresa: 1');
    expect(t).toContain('40,00');          // AVG(MARKUP) do grupo com %2.2f
    expect(t).toContain('PRODUTOS LISTADOS:');
    expect(t).toContain('TOTAL DE PRODUTOS LISTADOS:');
  });
});

describe('precificação pela NF bruta (PrecificacaoNFBruta.fr3, FRMPRECIFICACAONFBRUTA)', () => {
  it('o MARGEM (markup fixo da grade) com 2 casas, o período digitado e a média do grupo e geral', () => {
    const l = (CODPRODNOTA: string, MARGEM: number) => ({ IDEMPRESA: 1, CODPRODNOTA, DESCRICAO: `ITEM ${CODPRODNOTA}`, QUANTIDADE: 10, VRCUSTO: 3.456, ULTCUSTO: 3.2,
      VRVENDA: 4.99, PMZ: 4.1, VRVENDASUG: 5.19, MARGEM, PRECO_VENDA: 5.19, MEDIAMARGEM: 32.5 });
    const t = texto(paginasDoModelo(modelo('precificacao-nf-bruta.fr3'), { frxDBDataset1: [l('A1', 30), l('B2', 35)] }, agora, { DtInicial: "'01/09/2026'", DtFinal: "'30/09/2026'" }));
    expect(t).toContain('Período: 01/09/2026 até 30/09/2026');
    expect(t).toContain('ITEM A1');
    expect(t).toContain('3,46');      // VRCUSTO com %2.2f
    expect(t).toContain('30,00');
    expect(t).toContain('32,50');     // a média do grupo (AVG) e a geral (MEDIAMARGEM)
  });
});

describe('inventário rotativo (InvRotDetalhado/InvRotResumido/InvRotProdutos.fr3, FRMRELINVENTARIOROTATIVO)', () => {
  const vars = { TITULO: "'Relatório Inventário Rotativo - Detalhado'", LOJA: "'JF SUPERMERCADOS LTDA'", PERIODO: "'01/09/2026  à  30/09/2026'" };
  const lin = (CODBARRA: string, DESCRICAO: string, OPERACAO: string, QTD_ANTERIOR: number, QTD_COLETADA: number) => ({
    LOTE: 77, CODBARRA, DESCRICAO, QTD_ANTERIOR, QTD_COLETADA, DIFERENCA_QTD: QTD_COLETADA - QTD_ANTERIOR, VRCUSTO: 4.5, DIFERENCA_VALOR: (QTD_COLETADA - QTD_ANTERIOR) * 4.5,
    ESTOQUE: 12, ATIVO: 'S', ATIVO_COMPRA: 'S', DEPTO: 'MERCEARIA', GRUPO: 'BISCOITOS', SUBGRUPO: 'RECHEADOS', OPERACAO,
  });
  it('o detalhado: cada operação, as quantidades com %g e o custo com 0.00; sem "Agrupar lotes" o grupo por lote não sai', () => {
    const t = texto(paginasDoModelo(modelo('inv-rot-detalhado.fr3'), { frxDBDataset1: [lin('7891', 'BISCOITO RECHEADO', 'SUBSTITUIR', 10, 7), lin('7891', 'BISCOITO RECHEADO', 'AUMENTAR', 7, 2)] }, agora, vars));
    expect(t).toContain('Relatório Inventário Rotativo - Detalhado');
    expect(t).toContain('Empresa : JF SUPERMERCADOS LTDA');
    expect(t).toContain('Período : 01/09/2026 à 30/09/2026');
    expect(t).toContain('BISCOITO RECHEADO');
    expect(t).toContain('SUBSTITUIR');
    expect(t).toContain('-13,50');
    expect(t).not.toContain('Lote : 77');
  });
  it('o resumido: a última quantidade e o grupo por lote (visível no layout)', () => {
    const t = texto(paginasDoModelo(modelo('inv-rot-resumido.fr3'), { frxDBDataset2: [lin('7891', 'BISCOITO RECHEADO', 'AUMENTAR', 10, 9)] }, agora,
      { ...vars, TITULO: "'Relatório Inventário Rotativo - Resumido - Lote: Todos'" }));
    expect(t).toContain('Resumido - Lote: Todos');
    expect(t).toContain('Lote : 77');
    expect(t).toContain('BISCOITO RECHEADO');
    expect(t).toContain('-4,50');
  });
  it('os não coletados: o estoque, as datas de última venda/compra no formato mm/dd/yyyy do layout', () => {
    const t = texto(paginasDoModelo(modelo('inv-rot-produtos.fr3'), { frxDBDataset1: [{ CODBARRA: '7892', DESCRICAO: 'BOLACHA AGUA', VRCUSTO: 3.2, ESTOQUE: 40, ATIVO: 'S', ATIVO_COMPRA: 'S',
      DEPTO: 'MERCEARIA', GRUPO: 'BISCOITOS', SUBGRUPO: 'SALGADOS', QTD_COLETADA: 0, DTULTIMAVENDA: '2026-09-28T00:00:00', DTULTIMACOMPRA: '2026-09-02T00:00:00' }] }, agora,
      { ...vars, TITULO: "'Produtos inexistentes na coleta'" }));
    expect(t).toContain('Produtos inexistentes na coleta');
    expect(t).toContain('BOLACHA AGUA');
    expect(t).toContain('09/28/2026');
    expect(t).toContain('09/02/2026');
  });
});

describe('preenchimento da cotação (cot_pree_da_cotacao.fr3, FRMCADCOTACAOFORN)', () => {
  it('o cabeçalho, os itens aninhados com o valor em 4 casas e o total', () => {
    const t = texto(paginasDoModelo(modelo('cotacao-forn.fr3'), {
      frxDBCotacao_Forn: [{ DESCRICAO: 'COTACAO MERCEARIA OUT', DATA: '2026-10-05T00:00:00', DATAVALIDADE: '2026-10-20T00:00:00' }],
      frxDBCotacao_Forn_Itens: [
        { CODBARRA: '7891000', DESCRICAO: 'ARROZ 5KG', UNIDADE: 'FD', QUANTIDADE: 10, VALOR: 22.5, __MESTRE: 0 },
        { CODBARRA: '7892000', DESCRICAO: 'FEIJAO 1KG', UNIDADE: 'FD', QUANTIDADE: 20, VALOR: 7.125, __MESTRE: 0 },
      ],
    }, agora));
    expect(t).toContain('PREENCHIMENTO DA COTAÇÃO');
    expect(t).toContain('COTACAO MERCEARIA OUT');
    expect(t).toContain('05/10/2026');
    expect(t).toContain('20/10/2026');
    expect(t).toContain('ARROZ 5KG');
    expect(t).toContain('22,5000');
    expect(t).toContain('29,63');      // SUM(VALOR) sem formato do layout: 22,5 + 7,125
  });
});

describe('troca de mercadorias (extr - Troca.fr3, FRMTROCAMERCADORIAFOR) e o terceiro nível no motor', () => {
  it('cada item com a SUA quantidade por empresa no sub-relatório (__DETALHE), o total do item e o geral', () => {
    const t = texto(paginasDoModelo(modelo('troca.fr3'), {
      frxDBDatasetTroca: [{ CODTROCA: 55, DATA: '2026-10-01T00:00:00', CODPARCEIRO: 77, RAZAO: 'LATICINIOS TREVO LTDA' }],
      frxDBDatasetItens_Troca: [
        { IDPRODUTO: 101, CODBARRA: '7891', DESCRICAO: 'IOGURTE MORANGO', VRCUSTO: 2.5, __MESTRE: 0 },
        { IDPRODUTO: 102, CODBARRA: '7892', DESCRICAO: 'BEBIDA LACTEA', VRCUSTO: 4, __MESTRE: 0 },
      ],
      frxDBDatasetQtde: [
        { CODEMPRESA: 1, QTDE: 6, TOTAL: 15, __DETALHE: 0 },
        { CODEMPRESA: 1, QTDE: 3, TOTAL: 12, __DETALHE: 1 },
      ],
      frxDBEmpresa: [{ FANTASIA: 'HIPER PINHEIRAO', CNPJ: '37.954.975/0001-69', BAIRRO: 'MARTINS', CIDADE: 'UBERLANDIA', UF: 'MG', ENDERECO: 'AV SACRAMENTO' }],
    }, agora));
    expect(t).toContain('Troca de Mercadorias');
    expect(t).toContain('LATICINIOS TREVO LTDA');
    expect(t).toContain('IOGURTE MORANGO');
    expect(t).toContain('6,00');      // a quantidade do 1º item — o 2º não aparece debaixo dele
    expect(t).toContain('15,00');     // 6 × 2,50
    expect(t).toContain('3,00');
    expect(t).toContain('12,00');     // 3 × 4,00
    // o item 1 não traz a linha do item 2: "6,00 15,00" e não "6,00 15,00 1 3,00"
    expect(t).not.toMatch(/IOGURTE MORANGO[^B]*3,00/);
  });
});

describe('intersecção de produtos (extr - Interseccao produtos qtde vendida/cupom.fr3, FRMRELINTERSECCAOPRODUTOS)', () => {
  const vars = { DtIncial: "'01/09/2026'", DtFinal: "'30/09/2026'", CODBARRA: "'7891000'", DESCRICAO: "'CERVEJA LATA'", UNIDADE: "'UN'", QTDE: "'17,000'", QTDE_CUPOM: "'5'" };
  const l = (CODBARRA: string, DESCRICAO: string, QTDE: number, QTDECUPOM: number, VRVENDA: number) => ({ CODPRODUTO: 1, CODBARRA, DESCRICAO, UNIDADE: 'UN', QTDE, QTDECUPOM, VRVENDA });
  it('qtde vendida: o item analisado no cabeçalho, as linhas com a quantidade em 3 casas e o valor', () => {
    const t = texto(paginasDoModelo(modelo('interseccao-vendida.fr3'), { frxDBDtsProdQtdeVendida: [l('7892', 'GUARDANAPO', 12, 2, 24), l('7893', 'CARVAO', 3, 3, 36)] }, agora, vars));
    expect(t).toContain('Intersecção de Produtos - Qtde vendida');
    expect(t).toContain('EAN: 7891000');
    expect(t).toContain('CERVEJA LATA');
    expect(t).toContain('Cupons Analisados: 5');
    expect(t).toContain('Qtde: 17,000');
    expect(t).toContain('12,000');
    expect(t).toContain('36,00');
  });
  it('qtde cupom: a contagem sem casas', () => {
    const t = texto(paginasDoModelo(modelo('interseccao-cupom.fr3'), { frxDBDtsQtdeCupom: [l('7893', 'CARVAO', 3, 3, 36), l('7892', 'GUARDANAPO', 12, 2, 24)] }, agora, vars));
    expect(t).toContain('Intersecção de Produtos - Qtde cupom');
    expect(t).toContain('CARVAO');
    expect(t).toContain('24,00');
  });
});

describe('pedido de venda (PedidoRetaguarda[A4][_Transferencia].fr3, FRMDIGITACAOPEDIDOS)', () => {
  const it0 = (CODBARRA: string, DESCRICAO: string, QTDE: number, VRUNITARIO: number, DESC_ACRE_ITEM = 0) => ({
    NROPEDIDO: '000123', CODBARRA, DESCRICAO, QTDE, VRUNITARIO, DESC_ACRE_ITEM, UNIDADE: 'UN', ALIQUOTA: 'T01', DTVENDA: '2026-10-06T10:15:00',
    CODCLIENTE: 81, CLIENTE: 'MERCADINHO BOM PRECO', FANTASIA: 'BOM PRECO', ENDERECO: 'RUA A', BAIRRO: 'CENTRO', CIDADE: 'UBERLANDIA', UF: 'MG',
    TELEFONE: '3432', CEP: '38400000', CNPJ_CPF: '12.345.678/0001-90', RG_INSC: 'ISENTO', VENDEDOR: 'JOAO', PESO: 1, VRCUSTO: 3, OBS_ENTREGA: 'ENTREGAR CEDO', NOME_OPERADOR: 'MARIA',
  });
  const vars = { EMPRESA: "' JF SUPERMERCADOS LTDA UBERLANDIA - MG '", EMPRESA2: "' AV SACRAMENTO MARTINS CNPJ:37.954.975/0001-69 IE:0037992540050 '", FATURAMENTO: "''", TOTALPEDIDO: '57.5', TOTALPRODUTOS: '57.5' };
  it('A4: a empresa, o cliente, os itens com o unitário e o total, e o total do pedido formatado (diálogo normal)', () => {
    const t = texto(paginasDoModelo(modelo('pedido-a4.fr3'), { frxDBDataset1: [it0('7891', 'ARROZ 5KG', 2, 22.5), it0('7892', 'FEIJAO 1KG', 1.5, 8.33)] }, agora, vars, {}, { marcados: { rbNormal: true, rbUsuario: false }, botao: 'btnOk' }));
    expect(t).toContain('JF SUPERMERCADOS LTDA UBERLANDIA - MG');
    expect(t).toContain('DAV: 000123');
    expect(t).toContain('MERCADINHO BOM PRECO');
    expect(t).toContain('ARROZ 5KG');
    expect(t).toContain('45,00');
    expect(t).toContain('Total pedido: 57,50');
  });
  it('transferência: o custo e o operador do pedido', () => {
    const t = texto(paginasDoModelo(modelo('pedido-a4-transf.fr3'), { frxDBDataset1: [it0('7891', 'ARROZ 5KG', 2, 22.5)] }, agora, vars));
    expect(t).toContain('Pedido 000123');
    expect(t).toContain('Operador: MARIA');
    expect(t).toContain('6,00');      // 2 × custo 3,00
  });
});

describe('entradas e saídas · comparativo (Rel_EntradasESaidas_Comparativo.fr3, FRMRELENTRADASSAIDAS)', () => {
  const l = (IDEMPRESA: number, FANTASIA: string, DESCRICAO: string, extra: Record<string, unknown> = {}) => ({
    IDEMPRESA, FANTASIA, CODBARRA: '7009000007771', CODPRODUTO: 501, DESCRICAO, FATORCX: 12, QTDE_ENTRADA: 100, VALOR_ENTRADA: 1000, MEDIA_CUSTO: 10.214,
    QTDE_SAIDA: 65, VALOR_SAIDA: 700, MEDIA_VENDA: 10.769, QTDE_DIF: -35, VALOR_DIF: -300, QTDE_ESTOQUE_TOTAL: 47, VRCUSTOREP: 11.375, VRVENDA: 20.55, ...extra,
  });
  const vars = (c: string, v: string) => ({ DtInicial: "'01/06/2048'", DtFinal: "'30/06/2048'", Empresas: "'(1,2)'", OutrosFiltros: "'Grupo: GRUPO ES;'", CCusto: c, CVenda: v });
  const dados = { frxDBDRelComparativo: [l(1, 'LOJA CENTRO', 'PROD ENTRA SAI'), l(2, 'LOJA BAIRRO', 'PROD ENTRA SAI', { QTDE_ENTRADA: 24, VALOR_ENTRADA: 12, QTDE_SAIDA: 0, VALOR_SAIDA: 0 })] };
  it('o cabeçalho com período, lojas e filtros, um grupo por loja, e os rádios médio/médio', () => {
    const t = texto(paginasDoModelo(modelo('entradas-saidas-comparativo.fr3'), dados, agora, vars('0', '0')));
    expect(t).toContain('RELATÓRIO DE ENTRADAS E SAÍDAS - COMPARATIVO');
    expect(t).toContain('01/06/2048 a 30/06/2048');
    expect(t).toContain('(1,2)');
    expect(t).toContain('Grupo: GRUPO ES;');
    expect(t).toContain('LOJA CENTRO');
    expect(t).toContain('LOJA BAIRRO');
    expect(t).toContain('Custo Médio');
    expect(t).toContain('10,214');     // MEDIA_CUSTO em 3 casas
    expect(t).toContain('Venda Média');
    expect(t).toContain('10,77');      // MEDIA_VENDA em 2 casas
    expect(t).toContain('1.012,00');   // o total geral do valor de entrada (1.000 + 12)
  });
  it('custo de reposição e valor de venda atual: o script troca título e campo', () => {
    const t = texto(paginasDoModelo(modelo('entradas-saidas-comparativo.fr3'), dados, agora, vars('1', '1')));
    expect(t).toContain('Custo Rep');
    expect(t).toContain('11,375');
    expect(t).toContain('Venda Valor');
    expect(t).toContain('20,55');
    expect(t).not.toContain('10,214');
  });
});

describe('produção (Producao.fr3, FRMCADPRODUCAO)', () => {
  const cab = { CODPRODUCAO: 41, DATA: '2026-10-06T08:30:00', EMPRESA_SOLICITANTE: 'JF SUPERMERCADOS LTDA', EMPRESA_PRODUCAO: 'JF SUPERMERCADOS LTDA', USUARIO: 'MARIA PADARIA', STATUS_DESC: 'ABERTO' };
  const item = (CODITENPROD: number, principal: string, CODPRODUTO: number, DESCRICAOPRODREC: string, QUANTIDADE: number, UNIDADE: string, QUANTIDADE_COMERCIAL: number, UNIDADE_COMERCIAL: string, VRCUSTO: number) => ({
    CODITENPROD, CODBARRAPRODPRINCIPAL: '7000000990100', DESCRICAOPRODPRINCIPAL: principal, QTDEPRODPRINCIPAL: 20, UNIDADEPRODPRINCIPAL: 'KG',
    CODPRODUTO, CODBARRA: `78${CODPRODUTO}`, DESCRICAOPRODREC, QUANTIDADE, UNIDADE, QUANTIDADE_COMERCIAL, UNIDADE_COMERCIAL, VRCUSTO, TOTAL: QUANTIDADE_COMERCIAL * VRCUSTO,
  });
  it('o cabeçalho da requisição, um grupo por acabado e cada insumo com a quantidade comercial e o total', () => {
    const t = texto(paginasDoModelo(modelo('producao.fr3'), {
      frxDBDatasetProducao: [cab],
      frxDBDatasetItens: [item(1, 'PAO FRANCES', 101, 'FARINHA DE TRIGO', 10, 'KG', 10, 'KG', 1.5), item(1, 'PAO FRANCES', 104, 'MARGARINA POTE', 1, 'KG', 4, 'UN', 2.25)],
      frxDBDatasetEmpresa: [{ FANTASIA: 'JF SUPERMERCADOS', ENDERECO: 'AV SACRAMENTO', CNPJ: '37.954.975/0001-69', BAIRRO: 'CENTRO', CIDADE: 'UBERLANDIA', UF: 'MG' }],
    }, agora));
    expect(t).toContain('Requisição de produção');
    expect(t).toContain('41');
    expect(t).toContain('MARIA PADARIA');
    expect(t).toContain('ABERTO');
    expect(t).toContain('PAO FRANCES');
    expect(t).toContain('FARINHA DE TRIGO');
    expect(t).toContain('MARGARINA POTE');
    expect(t).toContain('JF SUPERMERCADOS');
    expect(t).toContain('15,00');      // 10 × 1,50
    expect(t).toContain('9,00');       // 4 UN × 2,25 (o total vai pela quantidade comercial)
  });
});
