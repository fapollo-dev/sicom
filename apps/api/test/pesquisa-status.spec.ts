import { describe, it, expect } from 'vitest';
import { lerStatus, escreverStatus } from '../src/shared/pesquisa/status-tela';

const COLUNAS = [
  { campo: 'ativado', tipo: 'texto' as const },
  { campo: 'codparceiro', tipo: 'numero' as const },
  { campo: 'dtvenc', tipo: 'data' as const },
  { campo: 'razao', tipo: 'texto' as const },
  { campo: 'vencimento', tipo: 'data' as const },
];
const item = (controle: string, valor: string, valorAuxiliar = '', frame = '') => ({ valor, controle, classe: 'X', classePai: 'X', visivel: true, habilitado: true, leitura: false, frame, valorAuxiliar });

describe('o status da tela da Pesquisa (CONFIG_STATUS_TELA, o JSON do TStatusTela)', () => {
  it('a linha 242 da produção (frmCadClientes, GET_PARCEIROS): Razao / Em Qualquer Lugar — volta pelo TEXTO, o índice 48 envelheceu', () => {
    const json = JSON.stringify({ listHelper: [3], items: [item('cbbCamposSoma', '0'), item('cbbOperacao', '4', 'Em Qualquer Lugar'), item('cbbCampos', '48', 'Razao'), null] });
    expect(lerStatus(json, COLUNAS)).toEqual({ campo: 'razao', operacao: 'qualquer', valor: '', valor2: '' });
  });

  it('a linha 361 (frmAPagar, GET_APAGAR): Vencimento / Entre 24/04/2025 a 24/04/2025', () => {
    const json = JSON.stringify({ listHelper: [4], items: [item('cbbOperacao', '2', 'Entre'), item('cbbCampos', '50', 'Vencimento'),
      item('edtDataIni', '24/04/2025', '', 'frmPesquisaFrame'), item('edtDataFim', '24/04/2025', '', 'frmPesquisaFrame')] });
    expect(lerStatus(json, COLUNAS)).toEqual({ campo: 'vencimento', operacao: 'entre', valor: '2025-04-24', valor2: '2025-04-24' });
  });

  it('sem o texto (fonte de 2020) ou com campo que a view do destino não tem: null — a Pesquisa abre como sempre', () => {
    expect(lerStatus(JSON.stringify({ items: [item('cbbCampos', '3')] }), COLUNAS)).toBeNull();
    expect(lerStatus(JSON.stringify({ items: [item('cbbCampos', '24', 'Nro_nf')] }), COLUNAS)).toBeNull();
    expect(lerStatus('não é json', COLUNAS)).toBeNull();
  });

  it('o que se grava volta igual (e no formato do legado: cbbCampos com o título, cbbOperacao com o texto)', () => {
    const s = { campo: 'codparceiro', operacao: 'entre' as const, valor: '10', valor2: '20', soma: 'codparceiro' };
    const json = escreverStatus(s, COLUNAS);
    const itens = JSON.parse(json).items as Array<{ controle: string; valor: string; valorAuxiliar: string }>;
    expect(itens.find((i) => i.controle === 'cbbCampos')).toMatchObject({ valor: '1', valorAuxiliar: 'Codparceiro' });
    expect(itens.find((i) => i.controle === 'cbbOperacao')).toMatchObject({ valor: '2', valorAuxiliar: 'Entre' });
    expect(lerStatus(json, COLUNAS)).toEqual({ campo: 'codparceiro', operacao: 'entre', valor: '10', valor2: '20' });
    const data = escreverStatus({ campo: 'dtvenc', operacao: 'igual', valor: '2026-10-07', valor2: '' }, COLUNAS);
    expect(lerStatus(data, COLUNAS)).toMatchObject({ campo: 'dtvenc', operacao: 'igual', valor: '2026-10-07' });
  });
});
