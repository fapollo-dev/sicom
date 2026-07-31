import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: (body as any)?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as T;
}

interface Lote {
  codlotepreco: number; idproduto: number; codempresa: number;
  vrvenda: number; markup?: number | null; promocao?: string | null; vrpromo?: number | null; alteroupromocao?: string | null;
  datalote?: string | null; obs?: string | null; origem?: string | null;
  codbarra?: string | null; descricao?: string | null; codgrupopreco?: number | null;
  preco_atual?: number | null; vrcusto?: number | null;
}

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

/**
 * AJUSTE DE PREÇOS - LOTE (FRMAJUSTEPRECOS) — corte-1. A fila de lotes de preço PENDENTES (propostos pelas telas de
 * origem: cadastro do produto, pedido de compra, precificação de NF). O operador seleciona e «Processar» APLICA em
 * MULTI_PRECO (por empresa do lote), propagando por GRUPO DE PREÇO, com log e reset do flag de etiqueta. O preço
 * NÃO é editável aqui (fiel ao legado — quem calcula é a origem); «Excluir» descarta o lote (soft).
 */
export function AjustePrecosPage() {
  const mensagem = useMensagem();
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [origem, setOrigem] = useState('');
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const qs = origem ? `?origem=${origem}` : '';
      const f = await req<Lote[]>(`/cadastro/ajuste-precos/fila${qs}`);
      setLotes(f); setSel(new Set());
    } catch (e) { mensagem.erro(e); }
  }, [origem, mensagem]);
  useEffect(() => { void carregar(); }, [carregar]);

  const selecionadosDe = (s: Set<number>) => lotes.filter((l) => s.has(l.codlotepreco));
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todos = () => setSel((s) => (s.size === lotes.length ? new Set() : new Set(lotes.map((l) => l.codlotepreco))));

  const processar = async () => {
    if (busy || !sel.size) return;
    const comPromo = selecionadosDe(sel).filter((l) => (l.alteroupromocao ?? 'N') === 'S').length;
    if (!window.confirm(`Processar ${sel.size} lote(s)? O preço de venda será APLICADO no cadastro de preços (e propagado ao grupo de preço, quando houver).${comPromo ? `\n\nATENÇÃO: ${comPromo} lote(s) também alteram a PROMOÇÃO (é o preço que o PDV vai cobrar).` : ''}`)) return;
    setBusy(true);
    try {
      const r = await req<{ processados: number; aplicados: number; propagados: number; pulados_sem_preco: number }>('/cadastro/ajuste-precos/processar', { method: 'POST', body: JSON.stringify({ ids: [...sel] }) });
      mensagem.sucesso(`${r.processados} lote(s) processado(s) — ${r.aplicados} preço(s) aplicado(s)${r.propagados ? `, ${r.propagados} por grupo de preço` : ''}${r.pulados_sem_preco ? `, ${r.pulados_sem_preco} sem preço` : ''}.`);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const excluir = async () => {
    if (busy || !sel.size) return;
    if (!window.confirm(`Excluir ${sel.size} lote(s) da fila? (não altera preço)`)) return;
    setBusy(true);
    try {
      const r = await req<{ excluidos: number }>('/cadastro/ajuste-precos/excluir', { method: 'POST', body: JSON.stringify({ ids: [...sel] }) });
      mensagem.sucesso(`${r.excluidos} lote(s) excluído(s) da fila.`);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const selecionados = lotes.filter((l) => sel.has(l.codlotepreco));

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Ajuste de Preços — Lote" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-64"><SelectField label="&Origem do lote" value={origem} onChange={setOrigem} options={[{ value: 'CADASTRO', label: 'Cadastro do produto' }, { value: 'PEDIDO', label: 'Pedido de compra' }, { value: 'DIVERGENTE', label: 'Preço divergente do atual' }]} placeholder="(todas as origens)" /></div>
        <Button label="&Marcar/desmarcar todos" variant="ghost" disabled={!lotes.length} onClick={todos} />
        <Button label="&Processar selecionados" variant="soft" disabled={busy || !sel.size} onClick={() => void processar()} />
        <Button label="E&xcluir da fila" variant="ghost" disabled={busy || !sel.size} onClick={() => void excluir()} />
        <div className="flex-1 text-right text-body-sm"><b>{sel.size}</b> de {lotes.length} lote(s) selecionado(s)</div>
        <small className="w-full text-fg-muted">Lotes de preço pendentes propostos pelas telas de origem. «Processar» aplica o preço no cadastro (por empresa do lote) e propaga aos produtos do mesmo grupo de preço; a etiqueta é marcada para reimpressão. O preço não é editável aqui.</small>
      </div>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs w-8"><input type="checkbox" checked={lotes.length > 0 && sel.size === lotes.length} onChange={todos} /></th>
              <th className="p-pad-xs">Lote</th><th className="p-pad-xs">Data</th><th className="p-pad-xs">Produto</th>
              <th className="p-pad-xs text-right">Custo</th><th className="p-pad-xs text-right">Preço atual</th>
              <th className="p-pad-xs text-right">Preço novo</th>
              <th className="p-pad-xs text-right">Promoção</th><th className="p-pad-xs text-right">Markup</th>
              <th className="p-pad-xs">Loja</th><th className="p-pad-xs">Origem</th>
            </tr>
          </thead>
          <tbody>
            {lotes.map((l) => {
              const sobe = Number(l.vrvenda) > Number(l.preco_atual ?? 0);
              return (
                <tr key={l.codlotepreco} className={`border-t border-border ${sel.has(l.codlotepreco) ? 'bg-bg-subtle' : ''}`}>
                  <td className="p-pad-xs"><input type="checkbox" checked={sel.has(l.codlotepreco)} onChange={() => toggle(l.codlotepreco)} /></td>
                  <td className="p-pad-xs tabular-nums">{l.codlotepreco}</td>
                  <td className="p-pad-xs tabular-nums">{dia(l.datalote)}</td>
                  <td className="p-pad-xs">{l.descricao ?? `#${l.idproduto}`}<br /><span className="text-fg-muted">{l.codbarra ?? ''}{l.codgrupopreco ? ` · grupo ${l.codgrupopreco}` : ''}</span></td>
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted">{l.vrcusto != null ? brl(l.vrcusto) : '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums">{l.preco_atual != null ? brl(l.preco_atual) : '—'}</td>
                  <td className={`p-pad-xs text-right tabular-nums font-semibold ${sobe ? 'text-danger' : 'text-accent'}`}>{brl(l.vrvenda)} {sobe ? '↑' : '↓'}</td>
                  {/* a PROMO do lote é o que o PDV vai COBRAR quando alteroupromocao='S' — tem de estar visível (fold auditoria). */}
                  <td className="p-pad-xs text-right tabular-nums">
                    {(l.alteroupromocao ?? 'N') === 'S'
                      ? (l.promocao === 'S' ? <b className="text-accent">{brl(l.vrpromo)} ⚡</b> : <span className="text-fg-muted">desliga promo</span>)
                      : <span className="text-fg-muted">—</span>}
                  </td>
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted">{Number(l.markup) > 0 ? Number(l.markup).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%' : '—'}</td>
                  <td className="p-pad-xs tabular-nums text-fg-muted">{l.codempresa}</td>
                  <td className="p-pad-xs text-fg-muted">{(l.obs ?? '').slice(0, 32) || l.origem || '—'}</td>
                </tr>
              );
            })}
            {!lotes.length && <tr><td colSpan={11} className="p-pad-md text-fg-muted">Nenhum lote de preço pendente.</td></tr>}
          </tbody>
          {selecionados.length > 0 && (
            <tfoot><tr className="border-t border-border font-semibold"><td className="p-pad-xs" colSpan={6}>Selecionado</td><td className="p-pad-xs text-right tabular-nums">{selecionados.length} preço(s)</td><td /></tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
