import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { gradeLayoutService } from '../../shared/grade/savedViewsService';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirPagina } from '../../shared/print/imprimirPagina';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';
import { hojeNaLoja } from '../../shared/tempo';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type TipoC1 = 'ESTOQUE_ATUAL' | 'RUPTURA' | 'ANALISE' | 'ALTERACOES_PRECO';
type TipoC2 = 'ESTOQUE_VENDAS_PERIODO' | 'ESTOQUE_POR_DATA' | 'MIX_ESTOQUE_LOJA' | 'MIX_ESTOQUE_GIROS' | 'LOTES_VALIDADES' | 'PERCAS' | 'LISTA_CONFERENCIA' | 'INATIVOS_AGENDA' | 'PRODUTOS_FORNECEDOR';
type Tipo = TipoC1 | TipoC2;
interface Linha {
  idproduto: number; codbarra: string; descricao: string; ativo: string; unidade: string;
  departamento: string | null; grupo: string | null; fornecedor: string | null;
  qtde: number; minimo: number; maximo: number; local: string | null;
  reservado_venda: number; pedido_compra: number;
  ultima_venda: string | null; dias_sem_venda: number | null;
  vrcusto: number; vrvenda: number; valor_custo: number; valor_venda: number; margem: number | null;
  // ALTERACOES_PRECO
  data?: string; valor_anterior?: string; valor_atual?: string; variacao?: number; variacao_pct?: number | null;
  operador?: string | null; historico?: string | null; origem?: string | null;
}
interface Resultado {
  tipo: TipoC1; linhas: Linha[];
  totais: { itens: number; qtdeTotal: number; valorCusto: number; valorVenda: number; negativos: number };
}
type LinhaC2 = Record<string, unknown> & { _id: string };
interface ResultadoC2 { tipo: TipoC2; linhas: LinhaC2[]; totais: Record<string, number>; ultimoGiro?: string | null }

/** na ordem do combo do legado (`cbbTipoRel`) */
const TIPOS: Array<{ v: Tipo; rotulo: string; ajuda: string }> = [
  { v: 'ANALISE', rotulo: 'Relatório para análise', ajuda: 'estoque com custo, preço e margem' },
  { v: 'LISTA_CONFERENCIA', rotulo: 'Lista para conferência', ajuda: 'a folha de contagem física por empresa e fornecedor, com as colunas em branco para anotar' },
  { v: 'RUPTURA', rotulo: 'Ruptura na loja', ajuda: 'o que zerou ou ficou negativo, e há quantos dias não vende' },
  { v: 'ESTOQUE_ATUAL', rotulo: 'Estoque atual', ajuda: 'quanto tem, contra mínimo e máximo' },
  { v: 'ESTOQUE_POR_DATA', rotulo: 'Estoque por data', ajuda: 'o saldo de cada produto numa data passada (o último movimento do kardex até o dia), a custo e venda atuais' },
  { v: 'PERCAS', rotulo: 'Percas', ajuda: 'o que se perdeu no período, pelo custo gravado na perca, contra as entradas e saídas' },
  { v: 'LOTES_VALIDADES', rotulo: 'Lotes e validades', ajuda: 'os lotes das notas de entrada que vencem no período' },
  { v: 'ALTERACOES_PRECO', rotulo: 'Alterações de preço', ajuda: 'quem mudou o preço, quando, e de quanto para quanto' },
  { v: 'INATIVOS_AGENDA', rotulo: 'Produtos inativos em agenda de promoções', ajuda: 'os itens desativados das agendas de promoção, com o preço de venda e o da promoção' },
  { v: 'ESTOQUE_VENDAS_PERIODO', rotulo: 'Estoque atual/vendas período', ajuda: 'o estoque de hoje ao lado do que vendeu no período e dos preços médios praticados' },
  { v: 'PRODUTOS_FORNECEDOR', rotulo: 'Produtos por fornecedor', ajuda: 'cada produto sob o fornecedor da última nota de entrada: custo, quantidade e data da nota, o vendido desde então e o estoque logo depois da entrada' },
  { v: 'MIX_ESTOQUE_LOJA', rotulo: 'Comparativo de mix (estoque × loja)', ajuda: 'o que a empresa em que você está tem em estoque e está sem estoque nas lojas marcadas' },
  { v: 'MIX_ESTOQUE_GIROS', rotulo: 'Comparativo de mix (estoque × giros)', ajuda: 'o que a empresa em que você está tem em estoque e não girou no período nas empresas marcadas' },
];
const C2: readonly Tipo[] = ['ESTOQUE_VENDAS_PERIODO', 'ESTOQUE_POR_DATA', 'MIX_ESTOQUE_LOJA', 'MIX_ESTOQUE_GIROS', 'LOTES_VALIDADES', 'PERCAS', 'LISTA_CONFERENCIA', 'INATIVOS_AGENDA', 'PRODUTOS_FORNECEDOR'];
/** o `cbbAtivo` do legado, na ordem do combo */
const ATIVO_MODOS: Array<{ v: string; rotulo: string }> = [
  { v: '', rotulo: 'Todos' }, { v: 'COMPRA_S', rotulo: 'Ativos p/ compra' }, { v: 'VENDA_S', rotulo: 'Ativos p/ venda' },
  { v: 'COMPRA_N', rotulo: 'Inativos p/ compra' }, { v: 'VENDA_N', rotulo: 'Inativos p/ venda' },
  { v: 'AMBOS_S', rotulo: 'Ativos p/ compra e venda' }, { v: 'AMBOS_N', rotulo: 'Inativos p/ compra e venda' },
];
const ehC2 = (t: Tipo): t is TipoC2 => C2.includes(t);

type Fmt = 'txt' | 'qtd' | 'moeda' | 'pct' | 'data' | 'marca';
interface ColC2 { c: string; t: string; fmt?: Fmt; w?: number }
/** as colunas de cada relatório do corte 2 — as da grade/.fr3 do legado */
const COLS_C2: Record<TipoC2, ColC2[]> = {
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
  produtos: { t: 'Produtos', fmt: 'txt' }, fornecedores: { t: 'Fornecedores', fmt: 'txt' }, qtdPercas: { t: 'Perca (qtde)', fmt: 'qtd' }, valorPercas: { t: 'Perca (R$)', fmt: 'moeda' }, entradas: { t: 'Entradas', fmt: 'qtd' },
};
/** que filtros cada relatório do corte 2 lê (o resto o legado desabilita) */
const USA: Record<TipoC2, { periodo?: 'ambos' | 'fim'; estoque?: boolean; saldo?: boolean; ativo?: boolean; secao?: boolean; fornecedor?: boolean; lotes?: boolean; empresas?: boolean }> = {
  ESTOQUE_VENDAS_PERIODO: { periodo: 'ambos', estoque: true, ativo: true, secao: true, fornecedor: true, empresas: true },
  ESTOQUE_POR_DATA: { periodo: 'fim', saldo: true, ativo: true, empresas: true },
  MIX_ESTOQUE_LOJA: { ativo: true, secao: true, fornecedor: true, empresas: true },
  MIX_ESTOQUE_GIROS: { periodo: 'ambos', ativo: true, secao: true, fornecedor: true, empresas: true },
  LOTES_VALIDADES: { periodo: 'ambos', secao: true, fornecedor: true, lotes: true, empresas: true },
  PERCAS: { periodo: 'ambos', fornecedor: true, empresas: true },
  LISTA_CONFERENCIA: { estoque: true, ativo: true, fornecedor: true, empresas: true },
  INATIVOS_AGENDA: { fornecedor: true },
  PRODUTOS_FORNECEDOR: { estoque: true, ativo: true, secao: true, fornecedor: true, empresas: true },
};

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
const fmtC2 = (v: unknown, fmt: Fmt = 'txt') => {
  if (fmt === 'moeda') return v == null ? '—' : moeda(v);
  if (fmt === 'qtd') return v == null ? '—' : nfmt(v);
  if (fmt === 'pct') return v == null ? '—' : `${nfmt(v, 2)}%`;
  if (fmt === 'data') return dataBr(v);
  // TV/RÁDIO/TABLOIDE/INTERNO marcam com 'T'; atualização de grupo e NF cancelada com 'S'
  if (fmt === 'marca') return v === 'T' || v === 'S' ? '✓' : '';
  return v == null ? '' : String(v);
};

/**
 * RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`) — corte-1 e corte-2. Dossiê: `uProdutosRel.md`.
 *
 * O combo do legado tem 21 relatórios; aqui estão os 12 que o dado da produção prova vivos, na ordem do combo. Cada um mostra só os
 * filtros que o legado deixa habilitados para ele (`USA`); o combo de filtro traz as 15 comparações originais contra mínimo e máximo.
 */
export function ProdutosRelPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    tipo: 'ESTOQUE_ATUAL' as Tipo, filtroEstoque: 'TODOS', ativo: 'S',
    coddpto: '', codgrupo: '', codsubgrupo: '', codsecao: '', codfor: '', produto: '', diasSemVenda: '',
    dataIni: `${hojeNaLoja().slice(0, 7)}-01`, dataFim: hojeNaLoja(),
    // corte 2
    empresas: '', estoqueEm: '', estoqueSinal: '>', estoqueQtde: '0', local: '', lotes: '', ativoModo: '',
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [res2, setRes2] = useState<ResultadoC2 | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const usa = ehC2(f.tipo) ? USA[f.tipo] : null;

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

  const gerar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      if (ehC2(f.tipo)) {
        const u = USA[f.tipo];
        q.set('tipo', f.tipo);
        const set = (k: string, v: string, quando = true) => { if (quando && v.trim() !== '') q.set(k, v.trim()); };
        set('empresas', f.empresas, !!u.empresas);
        set('produto', f.produto); set('coddpto', f.coddpto); set('codgrupo', f.codgrupo); set('codsubgrupo', f.codsubgrupo);
        set('codsecao', f.codsecao, !!u.secao); set('codfor', f.codfor, !!u.fornecedor); set('ativoModo', f.ativoModo, !!u.ativo);
        set('dataIni', f.dataIni, u.periodo === 'ambos'); set('dataFim', f.dataFim, !!u.periodo);
        if (u.estoque) { set('filtroEstoque', f.filtroEstoque); set('estoqueEm', f.estoqueEm); set('local', f.local); }
        if (u.estoque && f.estoqueEm) { set('estoqueSinal', f.estoqueSinal); set('estoqueQtde', f.estoqueQtde); }
        if (u.saldo) { set('estoqueSinal', f.estoqueSinal); set('estoqueQtde', f.estoqueQtde); }
        set('lotes', f.lotes, !!u.lotes);
        const b = (await buscar(q)) as ResultadoC2;
        setRes2({ ...b, linhas: b.linhas.map((l, i) => ({ ...l, _id: String(i) })) });
        setRes(null);
        return;
      }
      Object.entries(f).forEach(([k, v]) => { if (v !== '') q.set(k, String(v)); });
      ['empresas', 'estoqueEm', 'estoqueSinal', 'estoqueQtde', 'local', 'lotes', 'codsubgrupo', 'codsecao', 'ativoModo'].forEach((k) => q.delete(k));
      if (f.tipo !== 'RUPTURA') q.delete('diasSemVenda');
      if (f.tipo !== 'ALTERACOES_PRECO') { q.delete('dataIni'); q.delete('dataFim'); q.delete('filtroEstoque'); q.set('filtroEstoque', f.filtroEstoque); }
      if (f.tipo === 'ALTERACOES_PRECO') { q.delete('filtroEstoque'); q.delete('ativo'); }
      setRes((await buscar(q)) as Resultado);
      setRes2(null);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const cols2 = useMemo<DataTableColumnDef<LinhaC2>[]>(() => {
    if (!res2) return [];
    return COLS_C2[res2.tipo].map((c, i) => ({
      field: c.c, headerName: c.t, type: 'text', width: c.w ?? (c.fmt && c.fmt !== 'txt' ? 120 : undefined), isPrimary: i === 0,
      valueGetter: (l: LinhaC2) => fmtC2(l[c.c], c.fmt),
    })) as DataTableColumnDef<LinhaC2>[];
  }, [res2]);

  const imprimir = () => {
    const win = window.open('', '_blank', 'width=1024,height=768');
    if (!win) { mensagem.erro('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
    // a Lista para conferência imprime a FOLHA DE CONTAGEM (por fornecedor, com as colunas em branco), não a grade
    const raiz = document.getElementById(res2?.tipo === 'LISTA_CONFERENCIA' ? 'prod-rel-folha' : 'prod-rel-grade');
    if (!raiz) { win.close(); return; }
    const titulo = res2 ? (TIPOS.find((t) => t.v === res2.tipo)?.rotulo ?? 'Relatórios de produtos') : 'Relatórios de produtos';
    imprimirPagina(win, raiz, titulo, undefined, true);
  };

  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => {
    if (res?.tipo === 'ALTERACOES_PRECO') {
      return [
        { field: 'data', headerName: 'Quando', type: 'text', width: 150, isPrimary: true,
          valueGetter: (l) => String(l.data ?? '').replace('T', ' ').slice(0, 16).split(' ')
            .map((x, i) => (i === 0 ? x.split('-').reverse().join('/') : x)).join(' ') },
        { field: 'descricao', headerName: 'Produto', type: 'text' },
        { field: 'valor_anterior', headerName: 'De', type: 'text', width: 110, valueGetter: (l) => moeda(l.valor_anterior) },
        { field: 'valor_atual', headerName: 'Para', type: 'text', width: 110, valueGetter: (l) => moeda(l.valor_atual) },
        {
          field: 'variacao', headerName: 'Variação', type: 'text', width: 120, valueGetter: () => '',
          renderCell: ({ row: l }: { row: Linha }) => (
            <span className={Number(l.variacao) < 0 ? 'text-fg-danger tabular-nums' : 'text-fg-success tabular-nums'}>
              {moeda(l.variacao)}
            </span>
          ),
        } as DataTableColumnDef<Linha>,
        { field: 'variacao_pct', headerName: '%', type: 'text', width: 90,
          valueGetter: (l) => (l.variacao_pct == null ? '—' : `${nfmt(l.variacao_pct, 2)}%`) },
        { field: 'operador', headerName: 'Quem mudou', type: 'text', width: 170,
          // alteração vinda de rotina (lote de preço, carga) não tem operador
          valueGetter: (l) => l.operador ?? '—' },
        { field: 'origem', headerName: 'Origem', type: 'text', width: 150, valueGetter: (l) => l.origem ?? '—' },
        { field: 'departamento', headerName: 'Departamento', type: 'text', width: 160 },
      ];
    }
    const base: DataTableColumnDef<Linha>[] = [
      { field: 'idproduto', headerName: 'Código', type: 'text', width: 90, isPrimary: true },
      { field: 'descricao', headerName: 'Produto', type: 'text' },
      { field: 'unidade', headerName: 'Un.', type: 'text', width: 60 },
      // o estoque negativo em destaque: é o que o operador procura primeiro
      {
        field: 'qtde', headerName: 'Estoque', type: 'text', width: 110,
        valueGetter: () => '',
        renderCell: ({ row: l }: { row: Linha }) => (
          <span className={Number(l.qtde) < 0 ? 'font-semibold text-fg-danger tabular-nums' : 'tabular-nums'}>
            {nfmt(l.qtde)}
          </span>
        ),
      } as DataTableColumnDef<Linha>,
    ];
    if (res?.tipo !== 'RUPTURA') {
      base.push(
        { field: 'minimo', headerName: 'Mínimo', type: 'text', width: 90, valueGetter: (l) => nfmt(l.minimo) },
        { field: 'maximo', headerName: 'Máximo', type: 'text', width: 90, valueGetter: (l) => nfmt(l.maximo) },
      );
    }
    if (res?.tipo === 'RUPTURA') {
      base.push(
        { field: 'ultima_venda', headerName: 'Última venda', type: 'text', width: 120, valueGetter: (l) => dataBr(l.ultima_venda) },
        { field: 'dias_sem_venda', headerName: 'Dias sem vender', type: 'text', width: 135, valueGetter: (l) => (l.dias_sem_venda == null ? 'nunca vendeu' : nfmt(l.dias_sem_venda, 0)) },
      );
    }
    if (res?.tipo === 'ANALISE') {
      base.push(
        { field: 'vrcusto', headerName: 'Custo', type: 'text', width: 110, valueGetter: (l) => moeda(l.vrcusto) },
        { field: 'vrvenda', headerName: 'Venda', type: 'text', width: 110, valueGetter: (l) => moeda(l.vrvenda) },
        { field: 'margem', headerName: 'Margem', type: 'text', width: 100, valueGetter: (l) => (l.margem == null ? '—' : `${nfmt(l.margem, 2)}%`) },
      );
    }
    base.push(
      { field: 'valor_custo', headerName: 'Valor a custo', type: 'text', width: 130, valueGetter: (l) => moeda(l.valor_custo) },
      { field: 'departamento', headerName: 'Departamento', type: 'text', width: 160 },
      { field: 'fornecedor', headerName: 'Fornecedor', type: 'text', width: 180 },
      { field: 'ativo', headerName: 'Ativo', type: 'text', width: 70, valueGetter: (l) => (l.ativo === 'S' ? 'Sim' : 'Não') },
    );
    return base;
  }, [res?.tipo]);

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
          {(!usa || usa.estoque) && (
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Filtro de estoque
              <select className="rounded border border-border px-1 py-1" value={f.filtroEstoque}
                onChange={(e) => setF({ ...f, filtroEstoque: e.target.value })}>
                {FILTROS.map((o) => <option key={o.v} value={o.v}>{o.rotulo}</option>)}
              </select>
            </label>
          )}
          {usa?.ativo && (
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Ativo
              <select className="rounded border border-border px-1 py-1" value={f.ativoModo}
                onChange={(e) => setF({ ...f, ativoModo: e.target.value })}>
                {ATIVO_MODOS.map((o) => <option key={o.v} value={o.v}>{o.rotulo}</option>)}
              </select>
            </label>
          )}
          {!usa && (
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Situação
              <select className="rounded border border-border px-1 py-1" value={f.ativo}
                onChange={(e) => setF({ ...f, ativo: e.target.value })}>
                <option value="S">Só ativos</option>
                <option value="N">Só inativos</option>
                <option value="">Todos</option>
              </select>
            </label>
          )}
          {usa?.estoque && (
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
          {((usa?.estoque && f.estoqueEm) || usa?.saldo) && (
            <>
              <label className="flex flex-col gap-gp-xs text-body-sm">
                {usa?.saldo ? 'Saldo' : 'Quantidade'}
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
          {usa?.periodo && (
            <>
              {usa.periodo === 'ambos' && <div className="w-40"><Field label="&de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>}
              <div className="w-40"><Field label={usa.periodo === 'fim' ? 'Saldo em' : '&até'} type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
            </>
          )}
          {f.tipo === 'RUPTURA' && (
            <div className="w-40"><Field label="Sem vender há (dias)" value={f.diasSemVenda} onChange={(e) => setF({ ...f, diasSemVenda: e.target.value })} /></div>
          )}
          {f.tipo === 'ALTERACOES_PRECO' && (
            <>
              <div className="w-40"><Field label="&de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
              <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
            </>
          )}
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res && !res2} onClick={imprimir} />
          {/* "Exportar Grid" do legado: o que está na tela, filtrado, para o Excel */}
          <Button label="E&xportar" variant="soft" disabled={!res && !res2} onClick={() => {
            if (res2) {
              exportarGradeCsv(res2.linhas, COLS_C2[res2.tipo].map((c) => ({ titulo: c.t, valor: (l: LinhaC2) => (c.fmt === 'marca' || c.fmt === 'data' ? fmtC2(l[c.c], c.fmt) : (l[c.c] as string | number | null) ?? '') })), `relatorio-produtos-${res2.tipo.toLowerCase()}`);
              return;
            }
            if (!res) return;
            exportarGradeCsv(res.linhas, [
              { titulo: 'Código', valor: (l) => l.idproduto },
              { titulo: 'Cód. barras', valor: (l) => l.codbarra },
              { titulo: 'Produto', valor: (l) => l.descricao },
              { titulo: 'Un.', valor: (l) => l.unidade },
              { titulo: 'Estoque', valor: (l) => l.qtde },
              { titulo: 'Mínimo', valor: (l) => l.minimo },
              { titulo: 'Máximo', valor: (l) => l.maximo },
              { titulo: 'Última venda', valor: (l) => dataBr(l.ultima_venda) },
              { titulo: 'Dias sem vender', valor: (l) => l.dias_sem_venda ?? '' },
              { titulo: 'Custo', valor: (l) => l.vrcusto },
              { titulo: 'Venda', valor: (l) => l.vrvenda },
              { titulo: 'Margem %', valor: (l) => l.margem ?? '' },
              { titulo: 'Valor a custo', valor: (l) => l.valor_custo },
              { titulo: 'Valor a venda', valor: (l) => l.valor_venda },
              { titulo: 'Departamento', valor: (l) => l.departamento ?? '' },
              { titulo: 'Fornecedor', valor: (l) => l.fornecedor ?? '' },
              { titulo: 'Ativo', valor: (l) => (l.ativo === 'S' ? 'Sim' : 'Não') },
            ], 'relatorio-produtos');
          }} />
        </div>
        <div className="mt-form-gap flex flex-wrap items-end gap-gp-sm">
          {usa?.empresas && (
            <div className="w-40"><Field label="&Empresas (1,2)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value })} /></div>
          )}
          <div className="w-32"><Field label="De&partamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-32"><Field label="G&rupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          {usa && <div className="w-32"><Field label="S&ubgrupo" value={f.codsubgrupo} onChange={(e) => setF({ ...f, codsubgrupo: e.target.value })} /></div>}
          {usa?.secao && <div className="w-32"><Field label="Seçã&o" value={f.codsecao} onChange={(e) => setF({ ...f, codsecao: e.target.value })} /></div>}
          {(!usa || usa.fornecedor) && <div className="w-32"><Field label="&Fornecedor" value={f.codfor} onChange={(e) => setF({ ...f, codfor: e.target.value })} /></div>}
          <div className="w-56"><Field label="Produto ou &cód. barra" value={f.produto} onChange={(e) => setF({ ...f, produto: e.target.value })} /></div>
          {usa?.estoque && <div className="w-32"><Field label="&Local" value={f.local} onChange={(e) => setF({ ...f, local: e.target.value })} /></div>}
          {usa?.lotes && <div className="w-56"><Field label="Lo&tes (separe com ;)" value={f.lotes} onChange={(e) => setF({ ...f, lotes: e.target.value })} /></div>}
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
          {res2.tipo === 'LISTA_CONFERENCIA' && <FolhaConferencia linhas={res2.linhas} />}
        </>
      )}

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Itens</div><div className="text-body-lg tabular-nums">{res.totais.itens}</div></div>
              {res.tipo === 'ALTERACOES_PRECO' ? (
                <div>
                  <div className="text-body-sm text-fg-muted">Baixaram o preço</div>
                  <div className="text-body-lg tabular-nums">{res.totais.negativos}</div>
                </div>
              ) : (
                <>
                  <div><div className="text-body-sm text-fg-muted">Estoque negativo</div><div className="text-body-lg tabular-nums">{res.totais.negativos}</div></div>
                  <div><div className="text-body-sm text-fg-muted">Valor a custo</div><div className="text-body-lg tabular-nums">{moeda(res.totais.valorCusto)}</div></div>
                  <div><div className="text-body-sm text-fg-muted">Valor a venda</div><div className="text-body-lg tabular-nums">{moeda(res.totais.valorVenda)}</div></div>
                </>
              )}
            </div>
          </section>
          <div id="prod-rel-grade">
            <DataTable persistId="produtos-rel" savedViewsService={gradeLayoutService} rows={res.linhas} columns={cols} getRowId={(l: Linha) => String(l.idproduto)} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A FOLHA DE CONTAGEM (`prod_Lista_Conferencia.fr3`): por empresa e fornecedor ("Fornecedor [código] [razão]"), código de barras,
 * descrição, unidade, as quantidades do depósito e da loja e as duas colunas EM BRANCO para anotar a contagem. Só existe na impressão.
 */
function FolhaConferencia({ linhas }: { linhas: LinhaC2[] }) {
  const grupos: Array<{ chave: string; titulo: string; itens: LinhaC2[] }> = [];
  for (const l of linhas) {
    const chave = `${String(l.idempresa)}|${String(l.codfor ?? '')}`;
    let g = grupos[grupos.length - 1];
    if (!g || g.chave !== chave) {
      g = { chave, titulo: `Empresa ${String(l.idempresa)} ${l.empresa ? `— ${String(l.empresa)}` : ''} · Fornecedor ${String(l.codfor ?? '—')} ${String(l.fornecedor ?? '(sem fornecedor)')}`, itens: [] };
      grupos.push(g);
    }
    g.itens.push(l);
  }
  return (
    <div id="prod-rel-folha" className="hidden">
      {grupos.map((g) => (
        <div key={g.chave}>
          <h3>{g.titulo}</h3>
          <table>
            <thead><tr><th>Cód. barras</th><th>Descrição</th><th>UN</th><th className="text-right">Qtd. dep.</th><th className="text-right">Qtd. estoque</th><th>Qtd. cont. dep.</th><th>Qtd. cont. estoque</th></tr></thead>
            <tbody>
              {g.itens.map((l) => (
                <tr key={l._id}>
                  <td>{String(l.codbarra ?? '')}</td><td>{String(l.descricao ?? '')}</td><td>{String(l.unidade ?? '')}</td>
                  <td className="text-right tabular-nums">{nfmt(l.qtde_dep)}</td><td className="text-right tabular-nums">{nfmt(l.qtde)}</td>
                  <td>&nbsp;</td><td>&nbsp;</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

