import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { useShortcut } from '../../shared/keyboard';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';

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

/** o foco está num campo de digitação (ou numa lista/janela aberta): a letra é do campo, não atalho da tela */
function digitando(): boolean {
  if (document.querySelector('[role="dialog"], [role="listbox"], [role="menu"]')) return true;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(el.type);
  return el.getAttribute('role') === 'combobox';
}

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

/** as caixas de origem do «Pesquisar» (btnPesquisarClick): "de cadastro" + "pedidos" juntas = OU; "nota fiscal" = preço do lote ≠ preço atual */
export function consultaDaFila(f: { dtini: string; dtfim: string; empresas: string; cadastro: boolean; pedido: boolean; nf: boolean }): string {
  const qs = new URLSearchParams({ dtini: f.dtini, dtfim: f.dtfim });
  const lojas = f.empresas.split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0);
  if (lojas.length) qs.set('empresas', lojas.join(','));
  if (f.cadastro) qs.set('cadastro', 'S');
  if (f.pedido) qs.set('pedido', 'S');
  if (f.nf) qs.set('nf', 'S');
  return `/cadastro/ajuste-precos/fila?${qs.toString()}`;
}

/**
 * AJUSTE DE PREÇOS - LOTE (FRMAJUSTEPRECOS, uAjustePrecos). A fila de lotes de preço PENDENTES (propostos pelas telas de origem:
 * cadastro do produto, pedido de compra, precificação de NF) das lojas escolhidas, no período. O operador marca e «Processar» APLICA
 * em MULTI_PRECO (na loja do lote), propagando por GRUPO DE PREÇO, com log e reset do flag de etiqueta. O preço NÃO é editável aqui
 * (o «Gravar» do legado é invisível — quem calcula é a origem); «Excluir» (BTNEXCLUIR) descarta o lote (soft).
 */
export function AjustePrecosPage() {
  const mensagem = useMensagem();
  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const navigate = useNavigate();
  const { tem: pode } = useOpcoesDoForm('FRMAJUSTEPRECOS');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [dtini, setDtini] = useState('');
  const [dtfim, setDtfim] = useState('');
  const [empresas, setEmpresas] = useState('');
  const [soNf, setSoNf] = useState(false);
  const [soPedido, setSoPedido] = useState(false);
  const [soCadastro, setSoCadastro] = useState(false);
  const [busy, setBusy] = useState(false);
  const lista = lotes ?? [];

  const pesquisar = async () => {
    if (!dtini || !dtfim) { mensagem.erro('Informe o período: data inicial e data final.'); return; }
    if (dtfim < dtini) { mensagem.erro('A data final não pode ser menor que a data inicial.'); return; }
    try {
      const f = await req<Lote[]>(consultaDaFila({ dtini, dtfim, empresas, cadastro: soCadastro, pedido: soPedido, nf: soNf }));
      setLotes(f); setSel(new Set());
    } catch (e) { mensagem.erro(e); }
  };

  const selecionadosDe = (s: Set<number>) => lista.filter((l) => s.has(l.codlotepreco));
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todos = () => setSel((s) => (s.size === lista.length ? new Set() : new Set(lista.map((l) => l.codlotepreco))));
  // T = MarcarTodos(FSelecionarTodos) alternando marcar/desmarcar (FormKeyDown do uAjustePrecos) — fora dos campos de digitação
  useShortcut('t', () => {
    if (digitando()) return false;
    todos();
  }, { when: lista.length > 0 });

  const processar = async () => {
    if (busy || !sel.size) return;
    const comPromo = selecionadosDe(sel).filter((l) => (l.alteroupromocao ?? 'N') === 'S').length;
    if (!window.confirm(`Confirma o processamento dos lotes selecionados?${comPromo ? `\n\nATENÇÃO: ${comPromo} lote(s) também alteram a PROMOÇÃO (o PDV passa a cobrar o valor de promoção do lote).` : ''}`)) return;
    setBusy(true);
    try {
      const r = await req<{ processados: number; aplicados: number; propagados: number; pulados_sem_preco: number }>('/cadastro/ajuste-precos/processar', { method: 'POST', body: JSON.stringify({ ids: [...sel] }) });
      mensagem.sucesso(`Processamento efetuado com sucesso. ${r.processados} lote(s) — ${r.aplicados} preço(s) aplicado(s)${r.propagados ? `, ${r.propagados} por grupo de preço` : ''}${r.pulados_sem_preco ? `, ${r.pulados_sem_preco} sem preço` : ''}.`);
      setUltimos([...sel]);
      await pesquisar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  // o botão "Etiquetas" (`btnEtiquetasClick`, uAjustePrecos.pas:109): as etiquetas dos lotes marcados (ou dos que acabaram de ser
  // processados), expandidas pelo grupo de preço, vão para a tela de Etiquetas
  const [ultimos, setUltimos] = useState<number[]>([]);
  const [semPromo, setSemPromo] = useState(false);
  const etiquetas = () => {
    const codlotes = sel.size ? [...sel] : ultimos;
    if (!codlotes.length) return;
    try { sessionStorage.setItem('apollo.etiquetas.lotes', JSON.stringify({ codlotes, semPromocao: semPromo })); } catch { /* sem storage: a tela abre sem os lotes */ }
    navigate('/estoque/etiquetas');
  };

  const excluir = async () => {
    if (busy || !sel.size) return;
    if (!window.confirm('Confirma a exclusão deste registros selecionados ?')) return;
    setBusy(true);
    try {
      await req<{ excluidos: number }>('/cadastro/ajuste-precos/excluir', { method: 'POST', body: JSON.stringify({ ids: [...sel] }) });
      mensagem.sucesso('Exclusão de Lotes realizada com Sucesso');
      await pesquisar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const sn = (v: unknown) => (String(v ?? 'N') === 'S' ? 'Sim' : 'Não');

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Ajuste de Preços — Lote" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <div className="w-40"><Field label="Empresas (1,2)" value={empresas} onChange={(e) => setEmpresas(e.target.value)} placeholder="esta loja" /></div>
        <div className="flex flex-col gap-gp-2xs text-body-sm">
          <label className="flex items-center gap-gp-2xs"><input type="checkbox" checked={soNf} onChange={(e) => setSoNf(e.target.checked)} /> Trazer somente alterações de nota fiscal</label>
          <label className="flex items-center gap-gp-2xs"><input type="checkbox" checked={soPedido} onChange={(e) => setSoPedido(e.target.checked)} /> Trazer somente alterações referentes a pedidos</label>
          <label className="flex items-center gap-gp-2xs"><input type="checkbox" checked={soCadastro} onChange={(e) => setSoCadastro(e.target.checked)} /> Trazer somente alterações de cadastro</label>
        </div>
        <Button label="&Pesquisar" variant="soft" disabled={busy} onClick={() => void pesquisar()} />
      </div>
      <div className="flex flex-wrap items-center gap-gp-sm">
        <Button label="P&rocessar" variant="soft" disabled={busy || !sel.size} onClick={() => void processar()} />
        <Button label="&Etiquetas" variant="ghost" disabled={busy || lotes == null || (!sel.size && !ultimos.length)} onClick={etiquetas} />
        <label className="flex items-center gap-gp-2xs text-body-sm"><input type="checkbox" checked={semPromo} onChange={(e) => setSemPromo(e.target.checked)} /> Retirar da etiqueta produtos em promoção</label>
        <Button label="E&xcluir" variant="ghost" disabled={busy || !sel.size || !pode('BTNEXCLUIR')} onClick={() => void excluir()} />
        <Button label="&Marcar/desmarcar todos (T)" variant="ghost" disabled={!lista.length} onClick={todos} />
        <div className="flex-1 text-right text-body-sm"><b>{sel.size}</b> de {lista.length} lote(s) selecionado(s)</div>
      </div>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs w-8"><input type="checkbox" aria-label="Sel" checked={lista.length > 0 && sel.size === lista.length} onChange={todos} /></th>
              <th className="p-pad-xs">Loja</th><th className="p-pad-xs">Lot. Preço</th><th className="p-pad-xs">Data</th>
              <th className="p-pad-xs">Cód. Barra</th><th className="p-pad-xs">Descrição</th>
              <th className="p-pad-xs text-right">Vr. Venda</th><th className="p-pad-xs text-right">Preço atual</th><th className="p-pad-xs text-right">Vr. Custo</th>
              <th className="p-pad-xs text-right">Markup</th><th className="p-pad-xs">Obs</th><th className="p-pad-xs">Grupo Preço</th>
              <th className="p-pad-xs">Alterou promoção?</th><th className="p-pad-xs">Em promoção?</th><th className="p-pad-xs text-right">Vr. promoção</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((l) => {
              const sobe = Number(l.vrvenda) > Number(l.preco_atual ?? 0);
              return (
                <tr key={l.codlotepreco} className={`border-t border-border ${sel.has(l.codlotepreco) ? 'bg-bg-subtle' : ''}`}>
                  <td className="p-pad-xs"><input type="checkbox" aria-label={`Marcar lote ${l.codlotepreco}`} checked={sel.has(l.codlotepreco)} onChange={() => toggle(l.codlotepreco)} /></td>
                  <td className="p-pad-xs tabular-nums">{l.codempresa}</td>
                  <td className="p-pad-xs tabular-nums">{l.codlotepreco}</td>
                  <td className="p-pad-xs tabular-nums">{dia(l.datalote)}</td>
                  <td className="p-pad-xs tabular-nums">{l.codbarra ?? ''}</td>
                  {/* cxgridLoteDESCRICAOCustomDrawCell: a descrição do lote normal (QUANTIDADE 0) sai em negrito */}
                  <td className="p-pad-xs font-semibold">{l.descricao ?? `#${l.idproduto}`}</td>
                  <td className={`p-pad-xs text-right tabular-nums font-semibold ${sobe ? 'text-danger' : 'text-accent'}`}>{brl(l.vrvenda)} {sobe ? '↑' : '↓'}</td>
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted">{l.preco_atual != null ? brl(l.preco_atual) : '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted">{l.vrcusto != null ? brl(l.vrcusto) : '—'}</td>
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted">{l.markup != null ? Number(l.markup).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : ''}</td>
                  <td className="p-pad-xs text-fg-muted">{l.obs ?? ''}</td>
                  <td className="p-pad-xs tabular-nums text-fg-muted">{l.codgrupopreco ?? ''}</td>
                  <td className="p-pad-xs">{sn(l.alteroupromocao)}</td>
                  {/* a PROMO do lote é o que o PDV vai COBRAR quando alteroupromocao='S' — tem de estar visível (fold auditoria). */}
                  <td className="p-pad-xs">{l.promocao == null ? '' : sn(l.promocao)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{l.vrpromo != null ? brl(l.vrpromo) : ''}</td>
                </tr>
              );
            })}
            {lotes != null && !lista.length && <tr><td colSpan={15} className="p-pad-md text-fg-muted">Nenhum lote de preço pendente no período.</td></tr>}
            {lotes == null && <tr><td colSpan={15} className="p-pad-md text-fg-muted">Informe o período e clique em Pesquisar.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
