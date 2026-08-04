import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: res.status, code: 'ERRO', message: (b as any)?.message ?? res.statusText };
    throw Object.assign(new Error(env.code ?? res.statusText), { envelope: env, status: res.status, body: b });
  }
  return (await res.json()) as T;
}

const q3 = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const brl = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dh = (s: unknown) => (s ? new Date(String(s)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

interface Item {
  codnfprod: number; codproduto: number; codprodnota?: string | null; codbarra?: string; descricao?: string; unidade?: string;
  quantidade: number; fatorembal?: number; qtde_nota: number; vl_custo?: number;
  qtde_coletada: number | null; divergente: boolean; tentativas_coleta?: number | null;
  usuario_coleta?: number | null; operador_coleta?: string | null;
  produc_status?: string | null; data_coleta?: string | null; fatorembal_coleta?: number | null;
  codoperador_aprova_coleta?: number | null; operador_aprovacao?: string | null; data_aprovacao_conf?: string | null;
}
interface Nf { codnf: number; nronf?: string; serie?: string; fornecedor?: string; chavenfe?: string; totalnf?: number }
interface Totais { itens: number; aprovados: number; pendentes: number; conferidos: number; divergentes: number }

const APROVADO = (i: Item) => String(i.produc_status ?? '').trim().toUpperCase() === 'APROVADO';

/**
 * CONFERÊNCIA DE NOTA FISCAL (FRMCONFERENCIANOTA) — corte-1. A conferência física é do COLETOR; aqui o
 * supervisor vê o que foi conferido e APROVA (com liberação: login+senha de um autorizador) ou CANCELA.
 */
export function ConferenciaNotaPage() {
  const mensagem = useMensagem();
  const [codnf, setCodnf] = useState('');
  const [nf, setNf] = useState<Nf | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [busy, setBusy] = useState(false);
  // o legado tem uma caixa de código de barras que LOCALIZA a linha numa nota grande (edtCodBarraKeyDown:810)
  const [filtro, setFiltro] = useState('');

  const carregar = async () => {
    if (!codnf) return;
    setBusy(true);
    try {
      const r = await req<{ nf: Nf | null; itens: Item[]; totais: Totais }>(`/compras/conferencia-nota/${Number(codnf)}`);
      setNf(r.nf); setItens(r.itens); setTotais(r.totais); setSel(new Set());
      if (!r.nf) mensagem.erro(new Error('Nota fiscal não encontrada nesta empresa.'));
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todos = () => setSel((s) => (s.size === itens.length ? new Set() : new Set(itens.map((i) => i.codnfprod))));

  const aprovar = async () => {
    if (busy || !sel.size) return;
    if (!login || !senha) { mensagem.erro(new Error('Informe o usuário e a senha do autorizador.')); return; }
    setBusy(true);
    try {
      const r = await req<{ aprovados: number; codoperador_aprova: number }>('/compras/conferencia-nota/aprovar', {
        method: 'POST', body: JSON.stringify({ codnf: Number(codnf), itens: [...sel], login, senha }),
      });
      mensagem.sucesso(`${r.aprovados} item(ns) aprovado(s) pelo operador ${r.codoperador_aprova}.`);
      setSenha(''); await carregar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const cancelar = async () => {
    if (busy || !sel.size) return;
    if (!window.confirm(`Cancelar a aprovação de ${sel.size} item(ns)? Eles voltam para pendente.`)) return;
    setBusy(true);
    try {
      const r = await req<{ cancelados: number }>('/compras/conferencia-nota/cancelar', {
        method: 'POST', body: JSON.stringify({ codnf: Number(codnf), itens: [...sel] }),
      });
      mensagem.sucesso(`${r.cancelados} aprovação(ões) cancelada(s).`);
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const alvo = filtro.trim().toUpperCase();
  const visiveis = alvo
    ? itens.filter((i) => `${i.descricao ?? ''} ${i.codbarra ?? ''} ${i.codprodnota ?? ''} ${i.codproduto}`.toUpperCase().includes(alvo))
    : itens;

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Conferência de Nota Fiscal" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="&Nota fiscal (código)" value={codnf} onChange={(e) => setCodnf(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void carregar()} /></div>
        <Button label="&Abrir" variant="soft" disabled={busy || !codnf} onClick={() => void carregar()} />
        {nf && <div className="flex-1 text-body-sm">
          NF <b>{nf.nronf}</b>/{nf.serie} · {nf.fornecedor} · {brl(nf.totalnf)}
        </div>}
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {[
            { rot: 'Itens', val: totais.itens },
            { rot: 'Conferidos pelo coletor', val: totais.conferidos },
            { rot: 'Aprovados', val: totais.aprovados, ac: true },
            { rot: 'Pendentes', val: totais.pendentes, dg: totais.pendentes > 0 },
            { rot: 'Divergentes', val: totais.divergentes, dg: totais.divergentes > 0 },
          ].map((k) => (
            <div key={k.rot} className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.rot}</div>
              <div className={`text-title-sm font-bold tabular-nums ${k.ac ? 'text-accent' : ''} ${(k as any).dg ? 'text-danger' : ''}`}>{k.val}</div>
            </div>
          ))}
        </div>
      )}

      {itens.length > 0 && (
        <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          {/* a aprovação pede o AUTORIZADOR (não o operador da sessão) — é o código dele que fica gravado */}
          <div className="w-40"><Field label="&Autorizador" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="usuário" /></div>
          <div className="w-40"><Field label="Se&nha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} /></div>
          <Button label="A&provar selecionados" variant="soft" disabled={busy || !sel.size} onClick={() => void aprovar()} />
          <Button label="&Cancelar aprovação" variant="ghost" disabled={busy || !sel.size} onClick={() => void cancelar()} />
          <div className="w-52"><Field label="&Localizar (código ou descrição)" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="filtra a lista" /></div>
          <div className="flex-1 text-right text-body-sm"><b>{sel.size}</b> de {itens.length} selecionado(s)</div>
          <small className="w-full text-fg-muted">
            A contagem é feita no <b>coletor</b> — «Qtd. contada» e «Coleta» vêm dele. <b>Vermelho</b> é divergência
            entre o contado e o da nota: é o sinal para não aprovar. Aprovar exige usuário e senha de quem tem
            permissão, e é o código <b>dele</b> que fica registrado.
          </small>
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs w-8"><input type="checkbox" checked={itens.length > 0 && sel.size === itens.length} onChange={todos} /></th>
              <th className="p-pad-xs">Produto</th>
              <th className="p-pad-xs text-right">Qtd. nota</th><th className="p-pad-xs text-right">Qtd. contada</th>
              <th className="p-pad-xs text-right">Custo</th><th className="p-pad-xs">Status</th>
              <th className="p-pad-xs">Coleta</th><th className="p-pad-xs">Aprovação</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((i) => (
              <tr key={i.codnfprod} className={`border-t border-border ${sel.has(i.codnfprod) ? 'bg-bg-subtle' : ''}`}>
                <td className="p-pad-xs"><input type="checkbox" checked={sel.has(i.codnfprod)} onChange={() => toggle(i.codnfprod)} /></td>
                <td className="p-pad-xs">{i.descricao ?? `#${i.codproduto}`}<br /><span className="text-fg-muted">{i.codbarra ?? i.codprodnota} · {i.unidade}</span></td>
                <td className="p-pad-xs text-right tabular-nums">{q3(i.qtde_nota)}</td>
                {/* o número que decide: contado ≠ nota → VERMELHO, como o legado pinta a linha */}
                <td className={`p-pad-xs text-right tabular-nums ${i.divergente ? 'font-semibold text-danger' : ''}`}>
                  {i.qtde_coletada == null ? <span className="text-fg-muted">não contado</span> : q3(i.qtde_coletada)}
                </td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(i.vl_custo)}</td>
                <td className={`p-pad-xs ${APROVADO(i) ? 'font-semibold text-accent' : 'text-fg-muted'}`}>
                  {String(i.produc_status ?? '').trim() || 'pendente'}
                </td>
                <td className="p-pad-xs text-fg-muted whitespace-nowrap">
                  {i.qtde_coletada == null ? '—' : `${i.data_coleta ? dh(i.data_coleta) + ' · ' : ''}${i.operador_coleta ?? i.usuario_coleta ?? ''}${Number(i.tentativas_coleta) > 1 ? ` · ${i.tentativas_coleta}ª tentativa` : ''}`}
                </td>
                <td className="p-pad-xs text-fg-muted whitespace-nowrap">
                  {i.data_aprovacao_conf ? `${dh(i.data_aprovacao_conf)} · ${i.operador_aprovacao ?? i.codoperador_aprova_coleta}` : '—'}
                </td>
              </tr>
            ))}
            {!visiveis.length && <tr><td colSpan={8} className="p-pad-md text-fg-muted">Informe o código da nota fiscal e clique em Abrir.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
