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

interface Item {
  codnf: number; nronf: string; tipo: string; dtemissao: string; dtimportacao: string | null;
  proc: string; cancelada: string; fornecedor: string;
  codnfprod: number; codproduto: number; codprodnota: string; descricao: string; codbarra: string;
  quantidade: number; vrcusto: number;
  ipi: number; seguro: number; frete: number; despesas_acessorias: number;
  desconto_total: number; total_sistema: number; cst: number | null; cfop: string | null;
  ipi_nota: number; seguro_nota: number; frete_nota: number; desconto_nota: number;
  outras_despesas_nota: number; total_produto_nota: number; qtd_nota: number;
  vr_unit_prod_nota: number; cst_nota: number | null; cfop_nota: number | null;
  icms_aliq_nota: number; icms_st_aliq_nota: number; mva_ajustado: number | null;
  divergencias: string[]; divergente: boolean; divergencia_valor: number;
}
interface Resultado { linhas: Item[]; totais: { itens: number; divergentes: number; divergenciaValor: number } }

/**
 * CONFERÊNCIA DE NF × INDEXADOR TRIBUTÁRIO (`FRMCONFERENCIANFINDEXADOR`).
 * Dossiê: `uConferenciaNFIndexador.md`.
 *
 * Sistema de um lado, XML da nota do outro, item a item. A grade marca o que diverge — é para isso que a
 * tela existe, e por isso as colunas vêm em pares.
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const diaUm = () => `${new Date().toISOString().slice(0, 7)}-01`;

/** o par sistema × nota, com a diferença destacada quando existe. */
function Par({ a, b, diverge, fmt = moeda }: { a: unknown; b: unknown; diverge: boolean; fmt?: (v: unknown) => string }) {
  return (
    <span className={diverge ? 'font-semibold text-fg-danger' : undefined}>
      {fmt(a)} <span className="text-fg-muted">/</span> {fmt(b)}
    </span>
  );
}

export function ConferenciaNfIndexadorPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: diaUm(), dataFim: hoje(), tipo: 'E', nronf: '', codparceiro: '', produto: '',
    incluirProcessadas: true, incluirCanceladas: false, somenteDivergentes: true,
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '' && v !== false) q.set(k, String(v)); });
      const r = await fetch(`${BASE}/fiscal/conferencia-nf-indexador?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const tem = (l: Item, k: string) => (l.divergencias ?? []).includes(k);

  const cols = useMemo<DataTableColumnDef<Item>[]>(() => [
    { field: 'nronf', headerName: 'NF', type: 'text', width: 90, isPrimary: true },
    { field: 'dtemissao', headerName: 'Emissão', type: 'text', width: 100, valueGetter: (l) => dataBr(l.dtemissao) },
    { field: 'dtimportacao', headerName: 'Importação', type: 'text', width: 105, valueGetter: (l) => dataBr(l.dtimportacao) },
    { field: 'fornecedor', headerName: 'Fornecedor', type: 'text', width: 180 },
    { field: 'descricao', headerName: 'Produto', type: 'text' },
    { field: 'quantidade', headerName: 'Qtde sist./nota', type: 'text', width: 130, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Item }) => <Par a={l.quantidade} b={l.qtd_nota} diverge={false} fmt={(v) => nfmt(v)} /> },
    { field: 'total', headerName: 'Total sist./nota', type: 'text', width: 190, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Item }) => <Par a={l.total_sistema} b={l.total_produto_nota} diverge={tem(l, 'total')} /> },
    { field: 'ipi', headerName: 'IPI sist./nota', type: 'text', width: 165, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Item }) => <Par a={l.ipi} b={l.ipi_nota} diverge={tem(l, 'ipi')} /> },
    { field: 'frete', headerName: 'Frete sist./nota', type: 'text', width: 165, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Item }) => <Par a={l.frete} b={l.frete_nota} diverge={tem(l, 'frete')} /> },
    { field: 'acess', headerName: 'Acessórias sist./nota', type: 'text', width: 185, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Item }) => <Par a={l.despesas_acessorias} b={l.outras_despesas_nota} diverge={tem(l, 'acessorias')} /> },
    { field: 'desc', headerName: 'Desconto sist./nota', type: 'text', width: 185, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Item }) => <Par a={l.desconto_total} b={l.desconto_nota} diverge={tem(l, 'desconto')} /> },
    { field: 'cst', headerName: 'CST sist./nota', type: 'text', width: 130, valueGetter: () => '',
      renderCell: ({ row: l }: { row: Item }) => (
        <span className={tem(l, 'cst') ? 'font-semibold text-fg-danger' : undefined}>
          {l.cst ?? '—'} <span className="text-fg-muted">/</span> {l.cst_nota ?? '—'}
        </span>
      ) },
    { field: 'cfop_nota', headerName: 'CFOP nota', type: 'text', width: 100, valueGetter: (l) => (l.cfop_nota ?? '—') },
    { field: 'icms_aliq_nota', headerName: 'ICMS nota %', type: 'text', width: 110, valueGetter: (l) => `${nfmt(l.icms_aliq_nota, 2)}%` },
    { field: 'mva_ajustado', headerName: 'MVA aj.', type: 'text', width: 100, valueGetter: (l) => (l.mva_ajustado == null ? '—' : nfmt(l.mva_ajustado, 4)) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Conferência de NF × Indexador tributário" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          O que o <strong>sistema calculou</strong> e o que <strong>veio na nota</strong>, item a item. Cada
          coluna traz o par <em>sistema / nota</em>, e o que diverge fica em destaque.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="Emissão &de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Tipo de nota
            <select className="rounded border border-border px-1 py-1" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              <option value="E">Entrada</option>
              <option value="S">Saída</option>
              <option value="">Ambas</option>
            </select>
          </label>
          <div className="w-32"><Field label="&Nº NF" value={f.nronf} onChange={(e) => setF({ ...f, nronf: e.target.value })} /></div>
          <div className="w-32"><Field label="&Fornecedor (cód.)" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value })} /></div>
          <div className="w-52"><Field label="&Produto ou cód. barra" value={f.produto} onChange={(e) => setF({ ...f, produto: e.target.value })} /></div>
          <Button label="&Pesquisar" disabled={ocupado} onClick={() => void buscar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            const win = window.open('', '_blank', 'width=1024,height=768');
            if (!win) { mensagem.erro('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
            const raiz = document.getElementById('conf-nf-grade');
            if (!raiz) { win.close(); return; }
            imprimirPagina(win, raiz, 'Conferência de NF × Indexador', undefined, true);
          }} />
          {/* o "Exportar Grid [F10]" do legado: leva o que está na tela, filtrado, para o Excel */}
          <Button label="E&xportar [F10]" variant="soft" disabled={!res} onClick={() => {
            if (!res) return;
            exportarGradeCsv(res.linhas, [
              { titulo: 'NF', valor: (l) => l.nronf },
              { titulo: 'Emissão', valor: (l) => dataBr(l.dtemissao) },
              { titulo: 'Importação', valor: (l) => dataBr(l.dtimportacao) },
              { titulo: 'Fornecedor', valor: (l) => l.fornecedor },
              { titulo: 'Produto', valor: (l) => l.descricao },
              { titulo: 'Qtde sistema', valor: (l) => l.quantidade },
              { titulo: 'Qtde nota', valor: (l) => l.qtd_nota },
              { titulo: 'Total sistema', valor: (l) => l.total_sistema },
              { titulo: 'Total nota', valor: (l) => l.total_produto_nota },
              { titulo: 'IPI sistema', valor: (l) => l.ipi },
              { titulo: 'IPI nota', valor: (l) => l.ipi_nota },
              { titulo: 'Frete sistema', valor: (l) => l.frete },
              { titulo: 'Frete nota', valor: (l) => l.frete_nota },
              { titulo: 'Acessórias sistema', valor: (l) => l.despesas_acessorias },
              { titulo: 'Acessórias nota', valor: (l) => l.outras_despesas_nota },
              { titulo: 'Desconto sistema', valor: (l) => l.desconto_total },
              { titulo: 'Desconto nota', valor: (l) => l.desconto_nota },
              { titulo: 'CST sistema', valor: (l) => l.cst ?? '' },
              { titulo: 'CST nota', valor: (l) => l.cst_nota ?? '' },
              { titulo: 'CFOP nota', valor: (l) => l.cfop_nota ?? '' },
              { titulo: 'ICMS nota %', valor: (l) => l.icms_aliq_nota },
              { titulo: 'MVA ajustado', valor: (l) => l.mva_ajustado ?? '' },
              { titulo: 'Divergências', valor: (l) => (l.divergencias ?? []).join(' + ') },
            ], 'conferencia-nf-indexador');
          }} />
        </div>
        <div className="mt-form-gap flex flex-wrap items-center gap-gp-md text-body-sm">
          <label className="flex items-center gap-gp-sm">
            <input type="checkbox" checked={f.incluirProcessadas} onChange={(e) => setF({ ...f, incluirProcessadas: e.target.checked })} />
            Notas processadas
          </label>
          <label className="flex items-center gap-gp-sm">
            <input type="checkbox" checked={f.incluirCanceladas} onChange={(e) => setF({ ...f, incluirCanceladas: e.target.checked })} />
            Notas canceladas
          </label>
          <label className="flex items-center gap-gp-sm">
            <input type="checkbox" checked={f.somenteDivergentes} onChange={(e) => setF({ ...f, somenteDivergentes: e.target.checked })} />
            Só o que <strong>diverge</strong>
          </label>
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-center gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Itens</div><div className="text-body-lg tabular-nums">{res.totais.itens}</div></div>
              <div><div className="text-body-sm text-fg-muted">Divergentes</div><div className="text-body-lg tabular-nums">{res.totais.divergentes}</div></div>
              <div>
                <div className="text-body-sm text-fg-muted">Diferença de valor (nota − sistema)</div>
                <div className="text-body-lg tabular-nums">{moeda(res.totais.divergenciaValor)}</div>
              </div>
            </div>
          </section>
          <div id="conf-nf-grade">
            <DataTable persistId="conferencia-nf-indexador" savedViewsService={gradeLayoutService} rows={res.linhas} columns={cols} getRowId={(l: Item) => String(l.codnfprod)} />
          </div>
        </>
      )}
    </div>
  );
}
