import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { gradeLayoutService } from '../../shared/grade/savedViewsService';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Pedido {
  nropedido: string; dtvenda: string; cliente: string | null; codparceiro: number | null;
  itens: number; qtde_total: number; total: number; desconto_promocao: number;
  entregar: string; proc: string; cancelado: string;
}
interface Item {
  codpedidos: number; nroitem: number; codproduto: number; descricao: string; unidade: string;
  qtde: number; vrvenda: number; desc_acre_item: number;
  desc_promo_acumulativa: number; qtde_promocao_acumulativa: number;
  cancelado: string; bonificado: string; troca: string; total_item: number;
}

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nfmt = (v: unknown, d = 3) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const diasAtras = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/**
 * DIGITAÇÃO DE PEDIDOS (`FRMDIGITACAOPEDIDOS`). Dossiê: `uDigitacaoPedidos.md`.
 *
 * O **pedido de venda** — balcão, televenda, entrega. A tabela é 1 linha por item; a lista agrupa por
 * número de pedido, e abrir mostra os itens.
 *
 * O botão de promoção acumulativa é o que aplica, no pedido inteiro, as regras cadastradas na tela de
 * promoção — inclusive a virada do **atacarejo**, que dá o desconto cheio em cada unidade em vez de só nos
 * pacotes completos.
 */
export function PedidoVendaPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: diasAtras(30), dataFim: hoje(), nropedido: '', incluirCancelados: false });
  const [lista, setLista] = useState<Pedido[]>([]);
  const [aberto, setAberto] = useState<{ nropedido: string; itens: Item[]; total: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const chamar = async (url: string, init?: RequestInit) => {
    const r = await fetch(`${BASE}/${url}`, { ...init, headers: apiHeaders() });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      throw Object.assign(new Error(env.code), { envelope: env });
    }
    return r.json();
  };

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v !== '' && v !== false) q.set(k, String(v)); });
      setLista((await chamar(`compras/pedido-venda?${q}`)) as Pedido[]);
      setAberto(null);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const abrir = async (nro: string) => {
    setOcupado(true);
    try {
      const j = (await chamar(`compras/pedido-venda/${encodeURIComponent(nro)}`)) as { itens: Item[]; total: number };
      setAberto({ nropedido: nro, ...j });
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const aplicarPromocao = async () => {
    if (!aberto) return;
    setOcupado(true);
    try {
      const j = (await chamar(`compras/pedido-venda/${encodeURIComponent(aberto.nropedido)}/promocao-acumulativa`,
        { method: 'POST' })) as { promocoesAplicadas: number; itensComDesconto: number; descontoTotal: number };
      mensagem.sucesso(j.promocoesAplicadas === 0
        ? 'Nenhuma promoção acumulativa vigente alcança os itens deste pedido.'
        : `${j.promocoesAplicadas} promoção(ões) aplicada(s) — ${moeda(j.descontoTotal)} de desconto em ${j.itensComDesconto} item(ns).`);
      await abrir(aberto.nropedido);
      await buscar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const colsPedido = useMemo<DataTableColumnDef<Pedido>[]>(() => [
    { field: 'nropedido', headerName: 'Pedido', type: 'text', width: 120, isPrimary: true },
    { field: 'dtvenda', headerName: 'Data', type: 'text', width: 105, valueGetter: (p) => dataBr(p.dtvenda) },
    { field: 'cliente', headerName: 'Cliente', type: 'text' },
    { field: 'itens', headerName: 'Itens', type: 'text', width: 80 },
    { field: 'qtde_total', headerName: 'Qtde', type: 'text', width: 100, valueGetter: (p) => nfmt(p.qtde_total) },
    { field: 'desconto_promocao', headerName: 'Desc. promoção', type: 'text', width: 140, valueGetter: (p) => moeda(p.desconto_promocao) },
    { field: 'total', headerName: 'Total', type: 'text', width: 130, valueGetter: (p) => moeda(p.total) },
    { field: 'entregar', headerName: 'Entrega', type: 'text', width: 90, valueGetter: (p) => (p.entregar === 'S' ? 'Sim' : '—') },
    { field: 'cancelado', headerName: 'Situação', type: 'text', width: 110,
      valueGetter: (p) => (p.cancelado === 'S' ? 'Cancelado' : p.proc === 'S' ? 'Processado' : 'Aberto') },
    {
      field: 'acoes', headerName: '', type: 'text', width: 90, valueGetter: () => '',
      renderCell: ({ row: p }: { row: Pedido }) => (
        <Button label="Abrir" variant="soft" onClick={() => void abrir(p.nropedido)} />
      ),
    } as DataTableColumnDef<Pedido>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const colsItem = useMemo<DataTableColumnDef<Item>[]>(() => [
    { field: 'nroitem', headerName: 'Item', type: 'text', width: 70, isPrimary: true },
    { field: 'descricao', headerName: 'Produto', type: 'text' },
    { field: 'qtde', headerName: 'Qtde', type: 'text', width: 100, valueGetter: (i) => nfmt(i.qtde) },
    { field: 'vrvenda', headerName: 'Preço', type: 'text', width: 110, valueGetter: (i) => moeda(i.vrvenda) },
    { field: 'desc_acre_item', headerName: 'Desc./acré. item', type: 'text', width: 145, valueGetter: (i) => moeda(i.desc_acre_item) },
    {
      // o que a promoção acumulativa abateu, e em quantas unidades — os dois juntos explicam o número
      field: 'desc_promo_acumulativa', headerName: 'Promoção acumulativa', type: 'text', width: 185, valueGetter: () => '',
      renderCell: ({ row: i }: { row: Item }) => (
        Number(i.desc_promo_acumulativa) > 0
          ? <span className="text-fg-success">{moeda(i.desc_promo_acumulativa)} <span className="text-fg-muted">em {nfmt(i.qtde_promocao_acumulativa, 0)} un.</span></span>
          : <span className="text-fg-muted">—</span>
      ),
    } as DataTableColumnDef<Item>,
    { field: 'total_item', headerName: 'Total', type: 'text', width: 130, valueGetter: (i) => moeda(i.total_item) },
    { field: 'situacao', headerName: 'Situação', type: 'text', width: 120,
      valueGetter: (i) => (i.cancelado === 'S' ? 'Cancelado' : i.troca === 'S' ? 'Troca' : i.bonificado === 'S' ? 'Bonificado' : '—') },
  ], []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Digitação de pedidos" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-40"><Field label="&Nº do pedido" value={f.nropedido} onChange={(e) => setF({ ...f, nropedido: e.target.value })} /></div>
          <label className="flex items-center gap-gp-sm text-body-sm">
            <input type="checkbox" checked={f.incluirCancelados} onChange={(e) => setF({ ...f, incluirCancelados: e.target.checked })} />
            Incluir cancelados
          </label>
          <Button label="&Buscar" disabled={ocupado} onClick={() => void buscar()} />
        </div>
      </section>

      <DataTable persistId="pedido-venda" savedViewsService={gradeLayoutService}
        rows={lista} columns={colsPedido} getRowId={(p: Pedido) => p.nropedido} />

      {aberto && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="mb-form-gap flex flex-wrap items-center gap-gp-lg">
            <div><div className="text-body-sm text-fg-muted">Pedido</div><div className="text-body-lg">{aberto.nropedido}</div></div>
            <div><div className="text-body-sm text-fg-muted">Itens</div><div className="text-body-lg tabular-nums">{aberto.itens.length}</div></div>
            <div><div className="text-body-sm text-fg-muted">Total</div><div className="text-body-lg tabular-nums">{moeda(aberto.total)}</div></div>
            <Button label="Aplicar &promoção acumulativa" disabled={ocupado} onClick={() => void aplicarPromocao()} />
            <Button label="&Fechar" variant="soft" onClick={() => setAberto(null)} />
          </div>
          <p className="mb-form-gap text-body-sm text-fg-muted">
            A promoção acumulativa é recalculada do zero a cada clique — aplicar duas vezes não dobra o
            desconto. No modo <strong>atacarejo</strong> o abatimento vale para todas as unidades; fora dele,
            só para os pacotes completos.
          </p>
          <DataTable persistId="pedido-venda-itens" savedViewsService={gradeLayoutService}
            rows={aberto.itens} columns={colsItem} getRowId={(i: Item) => String(i.codpedidos)} />
        </section>
      )}
    </div>
  );
}
