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
});
