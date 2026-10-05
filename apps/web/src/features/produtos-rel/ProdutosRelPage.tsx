import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { gradeLayoutService } from '../../shared/grade/savedViewsService';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';
import { hojeNaLoja } from '../../shared/tempo';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** os treze relatórios vivos do combo (`cbbTipoRel`); a numeração do comentário é o `ItemIndex` do legado */
type Tipo =
  | 'ANALISE' | 'LISTA_CONFERENCIA' | 'RUPTURA' | 'ESTOQUE_ATUAL' | 'ESTOQUE_POR_DATA' | 'PERCAS' | 'LOTES_VALIDADES' | 'ALTERACOES_PRECO'
  | 'INATIVOS_AGENDA' | 'ESTOQUE_VENDAS_PERIODO' | 'PRODUTOS_FORNECEDOR' | 'MIX_ESTOQUE_LOJA' | 'MIX_ESTOQUE_GIROS';
type LinhaC2 = Record<string, unknown> & { _id: string };
interface ResultadoC2 { tipo: Tipo; linhas: LinhaC2[]; totais: Record<string, number>; ultimoGiro?: string | null; resumo?: Array<Record<string, unknown>> }

/** na ordem do combo do legado (`cbbTipoRel`) */
const TIPOS: Array<{ v: Tipo; rotulo: string; ajuda: string }> = [
  { v: 'ANALISE', rotulo: 'Relatório para análise', ajuda: 'a posição de estoque com preço, mínimo e máximo, por departamento, grupo e subgrupo (a quantidade é a da loja; o valor parado soma loja e depósito, quando positivo)' },
  { v: 'LISTA_CONFERENCIA', rotulo: 'Lista para conferência', ajuda: 'a folha de contagem física por empresa e fornecedor, com as colunas em branco para anotar' },
  { v: 'RUPTURA', rotulo: 'Ruptura na loja', ajuda: 'o que está zerado ou negativo na loja e tem saldo no depósito — o que dá para repor puxando do depósito' },
  { v: 'ESTOQUE_ATUAL', rotulo: 'Estoque atual', ajuda: 'quantidade e valor em estoque (loja e depósito, só loja ou só depósito), com o resumo por departamento' },
  { v: 'ESTOQUE_POR_DATA', rotulo: 'Estoque por data', ajuda: 'o saldo de cada produto numa data passada (o último movimento do kardex até o dia), a custo e venda atuais' },
  { v: 'PERCAS', rotulo: 'Percas', ajuda: 'o que se perdeu no período, pelo custo gravado na perca, contra as entradas e saídas' },
  { v: 'LOTES_VALIDADES', rotulo: 'Lotes e validades', ajuda: 'os lotes das notas de entrada que vencem no período' },
  { v: 'ALTERACOES_PRECO', rotulo: 'Alterações de preço', ajuda: 'quem mudou o preço de venda, quando, e de quanto para quanto — por produto' },
  { v: 'INATIVOS_AGENDA', rotulo: 'Produtos inativos em agenda de promoções', ajuda: 'os itens desativados das agendas de promoção, com o preço de venda e o da promoção' },
  { v: 'ESTOQUE_VENDAS_PERIODO', rotulo: 'Estoque atual/vendas período', ajuda: 'o estoque de hoje ao lado do que vendeu no período e dos preços médios praticados' },
  { v: 'PRODUTOS_FORNECEDOR', rotulo: 'Produtos por fornecedor', ajuda: 'cada produto sob o fornecedor da última nota de entrada: custo, quantidade e data da nota, o vendido desde então e o estoque logo depois da entrada' },
  { v: 'MIX_ESTOQUE_LOJA', rotulo: 'Comparativo de mix (estoque × loja)', ajuda: 'o que a empresa em que você está tem em estoque e está sem estoque nas lojas marcadas' },
  { v: 'MIX_ESTOQUE_GIROS', rotulo: 'Comparativo de mix (estoque × giros)', ajuda: 'o que a empresa em que você está tem em estoque e não girou no período nas empresas marcadas' },
];
/** o `cbbAtivo` do legado, na ordem do combo */
const ATIVO_MODOS: Array<{ v: string; rotulo: string }> = [
  { v: '', rotulo: 'Todos' }, { v: 'COMPRA_S', rotulo: 'Ativos p/ compra' }, { v: 'VENDA_S', rotulo: 'Ativos p/ venda' },
  { v: 'COMPRA_N', rotulo: 'Inativos p/ compra' }, { v: 'VENDA_N', rotulo: 'Inativos p/ venda' },
  { v: 'AMBOS_S', rotulo: 'Ativos p/ compra e venda' }, { v: 'AMBOS_N', rotulo: 'Inativos p/ compra e venda' },
];

type Fmt = 'txt' | 'qtd' | 'moeda' | 'pct' | 'data' | 'dh' | 'marca';
interface ColC2 { c: string; t: string; fmt?: Fmt; w?: number }
/** as colunas de cada relatório — as da grade/.fr3 do legado */
const COLS_C2: Record<Tipo, ColC2[]> = {
  // prod_Posicao_estoque_produtos.fr3 (agrupa por departamento › grupo › subgrupo)
  ANALISE: [
    { c: 'idempresa', t: 'Emp.', w: 60 }, { c: 'descdepto', t: 'Departamento', w: 150 }, { c: 'descgrupo', t: 'Grupo', w: 140 }, { c: 'descsubgrupo', t: 'Subgrupo', w: 140 },
    { c: 'codbarra', t: 'Cód. barras', w: 130 }, { c: 'descricao', t: 'Descrição' }, { c: 'unidade', t: 'UN', w: 60 }, { c: 'vrvenda', t: 'Vlr. venda', fmt: 'moeda' },
    { c: 'qtde', t: 'Qtd. estoque', fmt: 'qtd' }, { c: 'minimo', t: 'Mínimo', fmt: 'qtd', w: 90 }, { c: 'maximo', t: 'Máximo', fmt: 'qtd', w: 90 }, { c: 'razao', t: 'Fornecedor', w: 200 },
    { c: 'vrcusto', t: 'Custo', fmt: 'moeda' }, { c: 'totalcusto', t: 'Total custo', fmt: 'moeda' }, { c: 'totalvenda', t: 'Total venda', fmt: 'moeda' },
  ],
  // prod_Posicao_Estoque_Dep_produtos.fr3
  RUPTURA: [
    { c: 'idempresa', t: 'Emp.', w: 60 }, { c: 'descdepto', t: 'Departamento', w: 150 }, { c: 'codbarra', t: 'Cód. barras', w: 130 }, { c: 'descricao', t: 'Descrição' },
    { c: 'unidade', t: 'UN', w: 60 }, { c: 'vrvenda', t: 'Vlr. venda', fmt: 'moeda' }, { c: 'qtde_dep', t: 'Qtd. dep.', fmt: 'qtd' }, { c: 'qtde', t: 'Qtd. loja', fmt: 'qtd' },
    { c: 'minimo_dep', t: 'Mínimo dep.', fmt: 'qtd', w: 100 }, { c: 'maximo_dep', t: 'Máximo dep.', fmt: 'qtd', w: 100 }, { c: 'razao', t: 'Fornecedor', w: 200 },
  ],
  // Rel_Posicao_Estoque.fr3 (+ o resumo por departamento)
  ESTOQUE_ATUAL: [
    { c: 'coddpto', t: 'Dpt.', w: 70 }, { c: 'idempresa', t: 'Emp.', w: 60 }, { c: 'idproduto', t: 'ID prod.', w: 90 }, { c: 'codbarra', t: 'Cód. barras', w: 130 },
    { c: 'descricao', t: 'Descrição' }, { c: 'qtde_dep', t: 'Qtd. dep.', fmt: 'qtd' }, { c: 'qtde', t: 'Qtd. est.', fmt: 'qtd' },
    { c: 'totalcusto', t: 'Vr. custo', fmt: 'moeda' }, { c: 'totalvenda', t: 'Vr. venda', fmt: 'moeda' },
  ],
  // Alteracoes_preco.fr3 (agrupa por código de barras); a variação é do Apollo — o legado mostra os dois textos
  ALTERACOES_PRECO: [
    { c: 'codbarra', t: 'Cód. barras', w: 130 }, { c: 'descricao', t: 'Descrição' }, { c: 'codempresa', t: 'Empresa', w: 80 }, { c: 'data', t: 'Data', fmt: 'dh', w: 140 },
    { c: 'valor_anterior', t: 'Valor anterior', w: 110 }, { c: 'valor_atual', t: 'Valor novo', w: 110 }, { c: 'variacao', t: 'Variação', fmt: 'moeda' },
    { c: 'variacao_pct', t: '%', fmt: 'pct', w: 90 }, { c: 'nome', t: 'Operador', w: 170 }, { c: 'historico', t: 'Histórico', w: 240 },
  ],
  ESTOQUE_VENDAS_PERIODO: [
    { c: 'idempresa', t: 'Emp.', w: 60 }, { c: 'departamento', t: 'Departamento', w: 150 }, { c: 'codbarra', t: 'Cód. barras', w: 130 },
    { c: 'descricao', t: 'Descrição' }, { c: 'qtde_dep', t: 'Qtde depósito', fmt: 'qtd' }, { c: 'qtde', t: 'Qtde estoque', fmt: 'qtd' },
    { c: 'totalcusto', t: 'Custo em estoque', fmt: 'moeda' }, { c: 'totalvenda', t: 'Venda em estoque', fmt: 'moeda' },
    { c: 'qtde_vendida', t: 'Qtde vendida', fmt: 'qtd' }, { c: 'vrcusto_uni', t: 'Custo período', fmt: 'moeda' }, { c: 'vrvenda_uni', t: 'Venda período', fmt: 'moeda' },
    { c: 'vrcusto', t: 'Custo atual', fmt: 'moeda' }, { c: 'vrvenda', t: 'Venda atual', fmt: 'moeda' },
  ],
  ESTOQUE_POR_DATA: [
    { c: 'coddpto', t: 'Dpto', w: 70 }, { c: 'idempresa', t: 'Emp.', w: 60 }, { c: 'idproduto', t: 'Código', w: 90 }, { c: 'codbarra', t: 'Cód. barras', w: 130 },
    { c: 'descricao', t: 'Descrição' }, { c: 'total_estoque', t: 'Saldo', fmt: 'qtd' }, { c: 'custo_total', t: 'Custo', fmt: 'moeda' },
    { c: 'venda_total', t: 'Venda', fmt: 'moeda' }, { c: 'vrcusto', t: 'Custo unit.', fmt: 'moeda' }, { c: 'vrvenda', t: 'Venda unit.', fmt: 'moeda' },
  ],
  MIX_ESTOQUE_LOJA: [
    { c: 'idproduto', t: 'Código', w: 90 }, { c: 'codbarra', t: 'Cód. barras', w: 130 }, { c: 'descricao', t: 'Descrição' },
    { c: 'qtde', t: 'Qtde (dep. + loja)', fmt: 'qtd' }, { c: 'lojas_sem_estoque', t: 'Lojas sem estoque', w: 160 },
  ],
  MIX_ESTOQUE_GIROS: [
    { c: 'idempresa', t: 'Emp.', w: 60 }, { c: 'razao_social', t: 'Empresa', w: 200 }, { c: 'idproduto', t: 'Código', w: 90 },
    { c: 'codbarra', t: 'Cód. barras', w: 130 }, { c: 'descricao', t: 'Descrição' }, { c: 'total_estoque', t: 'Estoque (dep. + loja)', fmt: 'qtd' },
  ],
  LOTES_VALIDADES: [
    { c: 'idempresa', t: 'Emp.', w: 60 }, { c: 'idproduto', t: 'Código', w: 90 }, { c: 'codbarra', t: 'Cód. barras', w: 130 }, { c: 'descricao', t: 'Descrição' },
    { c: 'unidade', t: 'Un.', w: 60 }, { c: 'fatorcx', t: 'Fator', fmt: 'qtd', w: 70 }, { c: 'lote', t: 'Lote', w: 120 }, { c: 'dtvalidade', t: 'Validade', fmt: 'data', w: 100 },
    { c: 'estoque_atual', t: 'Estoque', fmt: 'qtd' }, { c: 'nronf', t: 'NF', w: 90 }, { c: 'fornecedor_nf', t: 'Fornecedor da NF', w: 180 },
    { c: 'cancelada', t: 'NF cancelada', fmt: 'marca', w: 100 }, { c: 'descdepto', t: 'Departamento', w: 150 },
  ],
  PERCAS: [
    { c: 'idempresa', t: 'Emp.', w: 60 }, { c: 'idproduto', t: 'Código', w: 90 }, { c: 'codbarra', t: 'Cód. barras', w: 130 }, { c: 'descricao', t: 'Descrição' },
    { c: 'entradas', t: 'Entradas', fmt: 'qtd' }, { c: 'saidas', t: 'Saídas', fmt: 'qtd' }, { c: 'qtd_percas', t: 'Perca (qtde)', fmt: 'qtd' },
    { c: 'valor_percas', t: 'Perca (R$)', fmt: 'moeda' }, { c: 'perc_percas', t: 'Perca (%)', fmt: 'pct' },
  ],
  LISTA_CONFERENCIA: [
    { c: 'empresa', t: 'Empresa', w: 150 }, { c: 'fornecedor', t: 'Fornecedor', w: 200 }, { c: 'codbarra', t: 'Cód. barras', w: 130 },
    { c: 'descricao', t: 'Descrição' }, { c: 'unidade', t: 'Un.', w: 60 }, { c: 'qtde_dep', t: 'Qtd. dep.', fmt: 'qtd' }, { c: 'qtde', t: 'Qtd. estoque', fmt: 'qtd' },
  ],
  PRODUTOS_FORNECEDOR: [
    { c: 'fantasia', t: 'Fornecedor', w: 200 }, { c: 'idempresa', t: 'Emp.', w: 60 }, { c: 'codprodnota', t: 'Cód. no fornecedor', w: 140 },
    { c: 'descricao', t: 'Descrição (na nota)' }, { c: 'vrcusto', t: 'Custo', fmt: 'moeda' }, { c: 'fatorembal', t: 'Fator emb.', fmt: 'qtd', w: 90 },
    { c: 'ult_nronf', t: 'Últ. NF', w: 90 }, { c: 'ult_data', t: 'Data últ. NF', fmt: 'data', w: 110 }, { c: 'ult_qtde', t: 'Qtde últ. NF', fmt: 'qtd' },
    { c: 'qtd_vendida', t: 'Vendida desde', fmt: 'qtd' }, { c: 'estoque_atual', t: 'Estoque atual', fmt: 'qtd' }, { c: 'estoque_dt_entrada', t: 'Estoque na entrada', fmt: 'qtd' },
  ],
  INATIVOS_AGENDA: [
    { c: 'codbarra', t: 'EAN', w: 130 }, { c: 'descricao', t: 'Descrição' }, { c: 'unidade', t: 'Un.', w: 60 }, { c: 'depto', t: 'Depto', w: 140 },
    { c: 'atualizacao_grupo', t: 'At/Gr', fmt: 'marca', w: 70 }, { c: 'tv', t: 'TV', fmt: 'marca', w: 60 }, { c: 'radio', t: 'Rádio', fmt: 'marca', w: 70 },
    { c: 'tabloide', t: 'Tabloide', fmt: 'marca', w: 80 }, { c: 'interno', t: 'Interno', fmt: 'marca', w: 80 },
    { c: 'vrvenda', t: 'V. venda', fmt: 'moeda' }, { c: 'vlrpromocao', t: 'V. promoção', fmt: 'moeda' }, { c: 'codagenda', t: 'Agenda', w: 80 }, { c: 'nomepromo', t: 'Nome da promoção', w: 200 },
  ],
};
/** os totais de cada relatório, com o rótulo e o formato */
const TOTAIS_C2: Record<string, { t: string; fmt: Fmt }> = {
  itens: { t: 'Itens', fmt: 'txt' }, qtde: { t: 'Qtde', fmt: 'qtd' }, qtdeDep: { t: 'Qtde depósito', fmt: 'qtd' }, totalCusto: { t: 'Custo em estoque', fmt: 'moeda' },
  totalVenda: { t: 'Venda em estoque', fmt: 'moeda' }, qtdeVendida: { t: 'Qtde vendida', fmt: 'qtd' }, vendaPeriodo: { t: 'Venda no período', fmt: 'moeda' },
  saldo: { t: 'Saldo', fmt: 'qtd' }, custo: { t: 'Custo', fmt: 'moeda' }, venda: { t: 'Venda', fmt: 'moeda' }, estoque: { t: 'Estoque', fmt: 'qtd' },
  produtos: { t: 'Produtos', fmt: 'txt' }, reducoes: { t: 'Baixaram o preço', fmt: 'txt' }, fornecedores: { t: 'Fornecedores', fmt: 'txt' }, qtdPercas: { t: 'Perca (qtde)', fmt: 'qtd' }, valorPercas: { t: 'Perca (R$)', fmt: 'moeda' }, entradas: { t: 'Entradas', fmt: 'qtd' },
};
/**
 * que filtros cada relatório lê — o `cbbTipoRelCloseUp` do legado: `estoque` = cbbEstoque × sinal × qtde, `cmb` = cmbFiltro, `dep` =
 * cbbEstoqueDep, `local` = edtLocal, `disponivel` = rgDisponivelEm (só o estoque atual: na análise o `StrToEnum(…) > 0` do legado o deixa
 * invisível), `fixo` = a ruptura, que trava o cmbFiltro em "loja zerada ou negativa" e o cbbEstoqueDep em "depósito > 0".
 */
interface Usa {
  periodo?: 'ambos' | 'fim'; estoque?: boolean; cmb?: boolean; dep?: boolean; local?: boolean; disponivel?: boolean; fixo?: boolean;
  saldo?: boolean; ativo?: boolean; secao?: boolean; fornecedor?: boolean; lotes?: boolean; empresas?: boolean;
}
const NUCLEO: Usa = { estoque: true, cmb: true, dep: true, local: true, ativo: true, fornecedor: true, empresas: true };
const USA: Record<Tipo, Usa> = {
  ANALISE: NUCLEO,
  RUPTURA: { ...NUCLEO, cmb: false, dep: false, fixo: true },
  ESTOQUE_ATUAL: { ...NUCLEO, disponivel: true },
  ALTERACOES_PRECO: { ...NUCLEO, periodo: 'ambos' },
  ESTOQUE_VENDAS_PERIODO: { ...NUCLEO, periodo: 'ambos', secao: true },
  ESTOQUE_POR_DATA: { periodo: 'fim', saldo: true, ativo: true, empresas: true },
  MIX_ESTOQUE_LOJA: { ativo: true, secao: true, fornecedor: true, empresas: true },
  MIX_ESTOQUE_GIROS: { periodo: 'ambos', ativo: true, secao: true, fornecedor: true, empresas: true },
  LOTES_VALIDADES: { periodo: 'ambos', secao: true, fornecedor: true, lotes: true, empresas: true },
  PERCAS: { periodo: 'ambos', fornecedor: true, empresas: true },
  LISTA_CONFERENCIA: NUCLEO,
  INATIVOS_AGENDA: { fornecedor: true },
  PRODUTOS_FORNECEDOR: { estoque: true, dep: true, ativo: true, secao: true, fornecedor: true, empresas: true },
};

/** o `chkExpandirItensImpressao`: visível só na lista para conferência e nas alterações de preço */
const EXPANDE: readonly Tipo[] = ['LISTA_CONFERENCIA', 'ALTERACOES_PRECO'];

/** o `cmbFiltro` do legado, na ordem do combo. */
const FILTROS: Array<{ v: string; rotulo: string }> = [
  { v: 'TODOS', rotulo: 'Todos' },
  { v: 'MENOR_IGUAL_MINIMO', rotulo: 'Qtd. estoque ≤ mínimo' },
  { v: 'MENOR_MINIMO', rotulo: 'Qtd. estoque < mínimo' },
  { v: 'MAIOR_IGUAL_MINIMO', rotulo: 'Qtd. estoque ≥ mínimo' },
  { v: 'MAIOR_MINIMO', rotulo: 'Qtd. estoque > mínimo' },
  { v: 'IGUAL_MINIMO', rotulo: 'Qtd. estoque = mínimo' },
  { v: 'MENOR_IGUAL_MAXIMO', rotulo: 'Qtd. estoque ≤ máximo' },
  { v: 'MENOR_MAXIMO', rotulo: 'Qtd. estoque < máximo' },
  { v: 'MAIOR_IGUAL_MAXIMO', rotulo: 'Qtd. estoque ≥ máximo' },
  { v: 'MAIOR_MAXIMO', rotulo: 'Qtd. estoque > máximo' },
  { v: 'IGUAL_MAXIMO', rotulo: 'Qtd. estoque = máximo' },
  { v: 'NEGATIVA', rotulo: 'Qtde. estoque negativa' },
  { v: 'ZERADA', rotulo: 'Qtde. estoque zerada' },
  { v: 'MAIOR_ZERO', rotulo: 'Qtde. estoque > zero' },
  { v: 'NEGATIVA_OU_ZERADA', rotulo: 'Qtde. estoque negativa ou zerada' },
];

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });
const dataBr = (v: unknown) => (v == null ? '—' : String(v).slice(0, 10).split('-').reverse().join('/'));
const dataHora = (v: unknown) => {
  if (v == null) return '—';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
};
const fmtC2 = (v: unknown, fmt: Fmt = 'txt') => {
  if (fmt === 'moeda') return v == null ? '—' : moeda(v);
  if (fmt === 'qtd') return v == null ? '—' : nfmt(v);
  if (fmt === 'pct') return v == null ? '—' : `${nfmt(v, 2)}%`;
  if (fmt === 'data') return dataBr(v);
  if (fmt === 'dh') return dataHora(v);
  // TV/RÁDIO/TABLOIDE/INTERNO marcam com 'T'; atualização de grupo e NF cancelada com 'S'
  if (fmt === 'marca') return v === 'T' || v === 'S' ? '✓' : '';
  return v == null ? '' : String(v);
};

/**
 * RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`). Dossiê: `uProdutosRel.md`.
 *
 * O combo do legado tem 21 relatórios; aqui estão os 13 que o dado da produção prova vivos, na ordem do combo. Cada um mostra só os
 * filtros que o legado deixa habilitados para ele (`USA`); os combos de filtro trazem as 15 comparações originais contra mínimo e máximo
 * (da loja e do depósito).
 */
export function ProdutosRelPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    tipo: 'ESTOQUE_ATUAL' as Tipo, filtroEstoque: 'TODOS', filtroEstoqueDep: 'TODOS', disponivelEm: 'TODOS',
    coddpto: '', codgrupo: '', codsubgrupo: '', codsecao: '', codfor: '', produto: '',
    dataIni: `${hojeNaLoja().slice(0, 7)}-01`, dataFim: hojeNaLoja(),
    empresas: '', estoqueEm: '', estoqueSinal: '>', estoqueQtde: '0', local: '', lotes: '', ativoModo: '', expandido: false,
  });
  const [res2, setRes2] = useState<ResultadoC2 | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const usa = USA[f.tipo];

  const buscar = async (q: URLSearchParams) => {
    const r = await fetch(`${BASE}/relatorios/produtos?${q}`, { headers: apiHeaders() });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      throw Object.assign(new Error(env.code), { envelope: env });
    }
    return r.json();
  };

  /** os filtros que o relatório escolhido lê (os desabilitados no legado não vão) */
  const consulta = () => {
    const q = new URLSearchParams();
    const u = USA[f.tipo];
    q.set('tipo', f.tipo);
    const set = (k: string, v: string, quando = true) => { if (quando && v.trim() !== '') q.set(k, v.trim()); };
    set('empresas', f.empresas, !!u.empresas);
    set('produto', f.produto); set('coddpto', f.coddpto); set('codgrupo', f.codgrupo); set('codsubgrupo', f.codsubgrupo);
    set('codsecao', f.codsecao, !!u.secao); set('codfor', f.codfor, !!u.fornecedor); set('ativoModo', f.ativoModo, !!u.ativo);
    set('dataIni', f.dataIni, u.periodo === 'ambos'); set('dataFim', f.dataFim, !!u.periodo);
    set('filtroEstoque', f.filtroEstoque, !!u.cmb); set('filtroEstoqueDep', f.filtroEstoqueDep, !!u.dep); set('local', f.local, !!u.local);
    set('disponivelEm', f.disponivelEm, !!u.disponivel);
    if (u.estoque) set('estoqueEm', f.estoqueEm);
    if ((u.estoque && f.estoqueEm) || u.saldo) { set('estoqueSinal', f.estoqueSinal); set('estoqueQtde', f.estoqueQtde); }
    set('lotes', f.lotes, !!u.lotes);
    if (EXPANDE.includes(f.tipo) && f.expandido) q.set('expandido', 'true');
    return q;
  };

  const gerar = async () => {
    setOcupado(true);
    try {
      const b = (await buscar(consulta())) as ResultadoC2;
      setRes2({ ...b, linhas: b.linhas.map((l, i) => ({ ...l, _id: String(i) })) });
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const cols2 = useMemo<DataTableColumnDef<LinhaC2>[]>(() => {
    if (!res2) return [];
    return COLS_C2[res2.tipo].map((c, i) => ({
      field: c.c, headerName: c.t, type: 'text', width: c.w ?? (c.fmt && c.fmt !== 'txt' ? 120 : undefined), isPrimary: i === 0,
      valueGetter: (l: LinhaC2) => fmtC2(l[c.c], c.fmt),
    })) as DataTableColumnDef<LinhaC2>[];
  }, [res2]);

  // o "Imprimir" do legado: a mesma consulta no layout do relatório (RELATORIOS do cliente)
  const imprimir = () => { imprimirRelatorio(`/relatorios/produtos/impressao?${consulta()}`).catch((e) => mensagem.erro(e)); };

  const comboFiltro = (rotulo: string, k: 'filtroEstoque' | 'filtroEstoqueDep', prefixo: string) => (
    <label className="flex flex-col gap-gp-xs text-body-sm">
      {rotulo}
      <select className="rounded border border-border px-1 py-1" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        {FILTROS.map((o) => <option key={o.v} value={o.v}>{o.v === 'TODOS' ? o.rotulo : o.rotulo.replace('Qtd. estoque', prefixo).replace('Qtde. estoque', prefixo)}</option>)}
      </select>
    </label>
  );

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Relatórios de produtos" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Relatório
            <select className="rounded border border-border px-1 py-1" value={f.tipo}
              onChange={(e) => setF({ ...f, tipo: e.target.value as Tipo })}>
              {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.rotulo}</option>)}
            </select>
          </label>
          {usa.cmb && comboFiltro('Filtro de estoque', 'filtroEstoque', 'Qtd. estoque')}
          {usa.dep && comboFiltro('Filtro do depósito', 'filtroEstoqueDep', 'Qtd. depósito')}
          {usa.fixo && <span className="self-center text-body-sm text-fg-muted">Loja zerada ou negativa e depósito &gt; 0</span>}
          {usa.disponivel && (
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Disponível em
              <select className="rounded border border-border px-1 py-1" value={f.disponivelEm} onChange={(e) => setF({ ...f, disponivelEm: e.target.value })}>
                <option value="TODOS">Estoque e depósito</option>
                <option value="ESTOQUE">Estoque</option>
                <option value="DEPOSITO">Depósito</option>
              </select>
            </label>
          )}
          {usa.ativo && (
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Ativo
              <select className="rounded border border-border px-1 py-1" value={f.ativoModo}
                onChange={(e) => setF({ ...f, ativoModo: e.target.value })}>
                {ATIVO_MODOS.map((o) => <option key={o.v} value={o.v}>{o.rotulo}</option>)}
              </select>
            </label>
          )}
          {usa.estoque && (
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Estoque em
              <select className="rounded border border-border px-1 py-1" value={f.estoqueEm}
                onChange={(e) => setF({ ...f, estoqueEm: e.target.value })}>
                <option value="">(sem filtro)</option>
                <option value="TODOS">Loja e depósito</option>
                <option value="ESTOQUE">Loja</option>
                <option value="DEPOSITO">Depósito</option>
              </select>
            </label>
          )}
          {((usa.estoque && f.estoqueEm) || usa.saldo) && (
            <>
              <label className="flex flex-col gap-gp-xs text-body-sm">
                {usa.saldo ? 'Saldo' : 'Quantidade'}
                <select className="rounded border border-border px-1 py-1" value={f.estoqueSinal}
                  onChange={(e) => setF({ ...f, estoqueSinal: e.target.value })}>
                  <option value=">">Maior que</option>
                  <option value="=">Igual a</option>
                  <option value="<">Menor que</option>
                </select>
              </label>
              <div className="w-24"><Field label="&Qtde" value={f.estoqueQtde} onChange={(e) => setF({ ...f, estoqueQtde: e.target.value })} /></div>
            </>
          )}
          {usa.periodo && (
            <>
              {usa.periodo === 'ambos' && <div className="w-40"><Field label="&de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>}
              <div className="w-40"><Field label={usa.periodo === 'fim' ? 'Saldo em' : '&até'} type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
            </>
          )}
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={ocupado} onClick={imprimir} />
          {/* "Exportar Grid" do legado: o que está na tela, filtrado, para o Excel */}
          <Button label="E&xportar" variant="soft" disabled={!res2} onClick={() => {
            if (!res2) return;
            exportarGradeCsv(res2.linhas, COLS_C2[res2.tipo].map((c) => ({ titulo: c.t, valor: (l: LinhaC2) => (c.fmt === 'marca' || c.fmt === 'data' || c.fmt === 'dh' ? fmtC2(l[c.c], c.fmt) : (l[c.c] as string | number | null) ?? '') })), `relatorio-produtos-${res2.tipo.toLowerCase()}`);
          }} />
        </div>
        <div className="mt-form-gap flex flex-wrap items-end gap-gp-sm">
          {usa.empresas && (
            <div className="w-40"><Field label="&Empresas (1,2)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value })} /></div>
          )}
          <div className="w-32"><Field label="De&partamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-32"><Field label="G&rupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          <div className="w-32"><Field label="S&ubgrupo" value={f.codsubgrupo} onChange={(e) => setF({ ...f, codsubgrupo: e.target.value })} /></div>
          {usa.secao && <div className="w-32"><Field label="Seçã&o" value={f.codsecao} onChange={(e) => setF({ ...f, codsecao: e.target.value })} /></div>}
          {usa.fornecedor && <div className="w-32"><Field label="&Fornecedor" value={f.codfor} onChange={(e) => setF({ ...f, codfor: e.target.value })} /></div>}
          <div className="w-56"><Field label="Produto ou &cód. barra" value={f.produto} onChange={(e) => setF({ ...f, produto: e.target.value })} /></div>
          {usa.local && <div className="w-32"><Field label="&Local" value={f.local} onChange={(e) => setF({ ...f, local: e.target.value })} /></div>}
          {usa.lotes && <div className="w-56"><Field label="Lo&tes (separe com ;)" value={f.lotes} onChange={(e) => setF({ ...f, lotes: e.target.value })} /></div>}
          {EXPANDE.includes(f.tipo) && (
            <label className="flex items-center gap-gp-xs self-center text-body-sm">
              <input type="checkbox" checked={f.expandido} onChange={(e) => setF({ ...f, expandido: e.target.checked })} /> Expandir itens na impressão
            </label>
          )}
        </div>
        <p className="mt-form-gap text-body-sm text-fg-muted">{TIPOS.find((t) => t.v === f.tipo)?.ajuda}</p>
      </section>

      {res2 && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              {Object.entries(res2.totais).map(([k, v]) => (
                <div key={k}>
                  <div className="text-body-sm text-fg-muted">{TOTAIS_C2[k]?.t ?? k}</div>
                  <div className="text-body-lg tabular-nums">{fmtC2(v, TOTAIS_C2[k]?.fmt ?? 'txt')}</div>
                </div>
              ))}
              {res2.tipo === 'MIX_ESTOQUE_GIROS' && (
                <div><div className="text-body-sm text-fg-muted">Última execução do giros</div><div className="text-body-lg tabular-nums">{res2.ultimoGiro ? `${dataBr(res2.ultimoGiro)} ${res2.ultimoGiro.slice(11)}` : '—'}</div></div>
              )}
            </div>
          </section>
          <div id="prod-rel-grade">
            <DataTable persistId={`produtos-rel-${res2.tipo.toLowerCase()}`} savedViewsService={gradeLayoutService} rows={res2.linhas} columns={cols2} getRowId={(l: LinhaC2) => l._id} />
          </div>
          {res2.resumo && res2.resumo.length > 0 && (
            <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
              <h3 className="mb-gp-sm text-body-md font-semibold">Resumo de estoque por departamento</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-body-sm tabular-nums">
                  <thead><tr className="text-fg-muted"><th className="text-left">Departamento</th><th className="text-right">Qtd. dep.</th><th className="text-right">Qtd. est.</th><th className="text-right">Vr. custo</th><th className="text-right">Vr. venda</th></tr></thead>
                  <tbody>
                    {res2.resumo.map((r) => (
                      <tr key={String(r.coddpto)}>
                        <td>{String(r.descdepto ?? '')}</td><td className="text-right">{nfmt(r.qtde_dep)}</td><td className="text-right">{nfmt(r.qtde)}</td>
                        <td className="text-right">{moeda(r.totalcusto)}</td><td className="text-right">{moeda(r.totalvenda)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
