import { OPERACOES, type Operacao, type TipoCampo } from './pesquisa-sql';

/**
 * O STATUS DA TELA da Pesquisa (Ctrl+Shift+S salva / Ctrl+Shift+D apaga — uMaster.pas `FormKeyDown`; uConfigStatusTela.pas): o JSON do
 * `TStatusTela` guardado na CONFIG_STATUS_TELA por operador + 'frmPesquisa' + o formulário que abriu + a view + o controle de retorno.
 * O formato é o do legado (`{"listHelper":[n],"items":[{controle, valor, valorAuxiliar, classe, …}]}`): o campo (`cbbCampos`, índice
 * na combo alfabética + o texto), a operação (`cbbOperacao`, índice no tipo + o texto) e o valor do frame (`edtTexto`,
 * `edtValorIni/Fim`, `edtDataIni/Fim`). As 26 linhas da produção voltam pelo TEXTO (`valorAuxiliar`); o índice só vale para a
 * operação (a ordem por tipo é a mesma) — o da combo de campos envelheceu (dossiê uPesquisa.md §13).
 */
export interface StatusDaPesquisa {
  campo: string;
  operacao: Operacao;
  valor: string;
  valor2: string;
  soma?: string | null;
}

interface ItemStatus { controle?: string; valor?: string; valorAuxiliar?: string; classe?: string; classePai?: string; visivel?: boolean; habilitado?: boolean; leitura?: boolean; frame?: string }

/** o texto da operação na combo do legado (MontaComboOperacao, uComunPesquisaRel.pas:421-452) */
const TEXTO_OPERACAO: Record<Operacao, string> = {
  igual: 'Igual a', diferente: 'Diferente de', comeca: 'Começado com', termina: 'Terminado com', qualquer: 'Em Qualquer Lugar',
  contido: 'Contido em', entre: 'Entre', maior: 'Maior que', menor: 'Menor que',
};
const normaliza = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

/** o título da coluna na combo do legado: 'RAZAO' → 'Razao', 'NRO_NF' → 'Nro_nf' (uPesquisa.pas:1651-1661) */
export const tituloLegado = (coluna: string) => coluna.charAt(0).toUpperCase() + coluna.slice(1).toLowerCase();

/** 'dd/mm/aaaa' → 'aaaa-mm-dd'; a data em branco do legado ('  /  /    ') → '' */
function dataDoLegado(v: string | undefined): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
const dataParaLegado = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '  /  /    ';
};

/** o JSON do legado → o que a Pesquisa reabre (sem pesquisar). Campo que a view do destino não tem → null (abre como sempre) */
export function lerStatus(json: string, colunas: Array<{ campo: string; tipo: TipoCampo }>): StatusDaPesquisa | null {
  let itens: ItemStatus[];
  try {
    itens = ((JSON.parse(json) as { items?: Array<ItemStatus | null> }).items ?? []).filter((i): i is ItemStatus => !!i);
  } catch {
    return null;
  }
  const item = (controle: string) => itens.find((i) => i.controle === controle);
  const textoCampo = item('cbbCampos')?.valorAuxiliar;
  if (!textoCampo) return null; // o fonte de 2020 só gravava o índice — envelhecido
  const col = colunas.find((c) => c.campo.toUpperCase() === textoCampo.toUpperCase());
  if (!col) return null;
  const ops = OPERACOES[col.tipo];
  const textoOp = item('cbbOperacao')?.valorAuxiliar;
  const porTexto = textoOp ? (Object.keys(TEXTO_OPERACAO) as Operacao[]).find((o) => normaliza(TEXTO_OPERACAO[o]) === normaliza(textoOp)) : undefined;
  const porIndice = ops[Number(item('cbbOperacao')?.valor)];
  const operacao = porTexto && ops.includes(porTexto) ? porTexto : porIndice ?? ops[0];
  let valor = '';
  let valor2 = '';
  if (operacao === 'contido' || col.tipo === 'texto') valor = item('edtTexto')?.valor ?? '';
  else if (col.tipo === 'numero') { valor = item('edtValorIni')?.valor ?? ''; valor2 = item('edtValorFim')?.valor ?? ''; }
  else { valor = dataDoLegado(item('edtDataIni')?.valor); valor2 = dataDoLegado(item('edtDataFim')?.valor); }
  return { campo: col.campo, operacao, valor, valor2 };
}

/** o que a Pesquisa tem na tela → o JSON no formato do legado */
export function escreverStatus(s: StatusDaPesquisa, colunas: Array<{ campo: string; tipo: TipoCampo }>): string {
  const col = colunas.find((c) => c.campo === s.campo);
  const tipo: TipoCampo = col?.tipo ?? 'texto';
  const indiceCampo = colunas.findIndex((c) => c.campo === s.campo);
  const numericas = colunas.filter((c) => c.tipo === 'numero');
  const base = (controle: string, valor: string, classe: string, extra: Partial<ItemStatus> = {}): ItemStatus => ({
    valor, controle, classe, classePai: classe, visivel: true, habilitado: true, leitura: false, frame: '', valorAuxiliar: '', ...extra,
  });
  const noFrame = { frame: 'frmPesquisaFrame' };
  const items: ItemStatus[] = [
    base('cbbCamposSoma', String(Math.max(0, numericas.findIndex((c) => c.campo === s.soma))), 'TComboBox'),
    base('cbbOperacao', String(Math.max(0, OPERACOES[tipo].indexOf(s.operacao))), 'TJvComboBox', { valorAuxiliar: TEXTO_OPERACAO[s.operacao] }),
    base('cbbCampos', String(Math.max(0, indiceCampo)), 'TJvComboBox', { valorAuxiliar: tituloLegado(s.campo) }),
    base('edtTexto', s.operacao === 'contido' || tipo === 'texto' ? s.valor : '', 'TEdit', noFrame),
    base('edtValorIni', tipo === 'numero' ? s.valor || '0' : '0', 'TJvCalcEdit', noFrame),
    base('edtValorFim', tipo === 'numero' ? s.valor2 || '0' : '0', 'TJvCalcEdit', noFrame),
    base('edtDataIni', tipo === 'data' ? dataParaLegado(s.valor) : '  /  /    ', 'TJvDateEdit', noFrame),
    base('edtDataFim', tipo === 'data' ? dataParaLegado(s.valor2) : '  /  /    ', 'TJvDateEdit', noFrame),
  ];
  return JSON.stringify({ listHelper: [items.length], items });
}
