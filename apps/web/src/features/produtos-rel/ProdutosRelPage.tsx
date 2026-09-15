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

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Tipo = 'ESTOQUE_ATUAL' | 'RUPTURA' | 'ANALISE' | 'ALTERACOES_PRECO';
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
  tipo: Tipo; linhas: Linha[];
  totais: { itens: number; qtdeTotal: number; valorCusto: number; valorVenda: number; negativos: number };
}

const TIPOS: Array<{ v: Tipo; rotulo: string; ajuda: string }> = [
  { v: 'ESTOQUE_ATUAL', rotulo: 'Estoque atual', ajuda: 'quanto tem, contra mínimo e máximo' },
  { v: 'RUPTURA', rotulo: 'Ruptura na loja', ajuda: 'o que zerou ou ficou negativo, e há quantos dias não vende' },
  { v: 'ANALISE', rotulo: 'Relatório para análise', ajuda: 'estoque com custo, preço e margem' },
  { v: 'ALTERACOES_PRECO', rotulo: 'Alterações de preço', ajuda: 'quem mudou o preço, quando, e de quanto para quanto' },
];

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

/**
 * RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`) — corte-1. Dossiê: `uProdutosRel.md`.
 *
 * A tela do legado tem 15 relatórios; aqui estão os três que compartilham o núcleo de estoque. O combo de
 * filtro traz as 15 comparações originais contra mínimo e máximo.
 */
export function ProdutosRelPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    tipo: 'ESTOQUE_ATUAL' as Tipo, filtroEstoque: 'TODOS', ativo: 'S',
    coddpto: '', codgrupo: '', codfor: '', produto: '', diasSemVenda: '',
    dataIni: `${new Date().toISOString().slice(0, 7)}-01`, dataFim: new Date().toISOString().slice(0, 10),
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '') q.set(k, String(v)); });
      if (f.tipo !== 'RUPTURA') q.delete('diasSemVenda');
      if (f.tipo !== 'ALTERACOES_PRECO') { q.delete('dataIni'); q.delete('dataFim'); q.delete('filtroEstoque'); q.set('filtroEstoque', f.filtroEstoque); }
      if (f.tipo === 'ALTERACOES_PRECO') { q.delete('filtroEstoque'); q.delete('ativo'); }
      const r = await fetch(`${BASE}/relatorios/produtos?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
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
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Filtro de estoque
            <select className="rounded border border-border px-1 py-1" value={f.filtroEstoque}
              onChange={(e) => setF({ ...f, filtroEstoque: e.target.value })}>
              {FILTROS.map((o) => <option key={o.v} value={o.v}>{o.rotulo}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Situação
            <select className="rounded border border-border px-1 py-1" value={f.ativo}
              onChange={(e) => setF({ ...f, ativo: e.target.value })}>
              <option value="S">Só ativos</option>
              <option value="N">Só inativos</option>
              <option value="">Todos</option>
            </select>
          </label>
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
          <Button label="&Imprimir" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            const win = window.open('', '_blank', 'width=1024,height=768');
            if (!win) { mensagem.erro('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
            const raiz = document.getElementById('prod-rel-grade');
            if (!raiz) { win.close(); return; }
            imprimirPagina(win, raiz, 'Relatórios de produtos', undefined, true);
          }} />
          {/* "Exportar Grid" do legado: o que está na tela, filtrado, para o Excel */}
          <Button label="E&xportar" variant="soft" disabled={!res} onClick={() => {
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
          <div className="w-32"><Field label="De&partamento" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-32"><Field label="G&rupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          <div className="w-32"><Field label="&Fornecedor" value={f.codfor} onChange={(e) => setF({ ...f, codfor: e.target.value })} /></div>
          <div className="w-56"><Field label="Produto ou &cód. barra" value={f.produto} onChange={(e) => setF({ ...f, produto: e.target.value })} /></div>
        </div>
        <p className="mt-form-gap text-body-sm text-fg-muted">{TIPOS.find((t) => t.v === f.tipo)?.ajuda}</p>
      </section>

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
