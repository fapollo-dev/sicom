import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * GERAR FINANCEIRO EM LOTE (`FRMGERARFINANCEIROLOTE`). Dossiê: `uGerarFinanceiroLote.md`.
 * A cobrança mensal dos clientes de valor fixo: escolhe os clientes, o vencimento e o banco, e gera um
 * título a receber para cada um. Cliente que já tem título igual (mesmo vencimento, valor e banco) é
 * descartado — é a guarda que evita cobrar duas vezes o mesmo mês.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);

type Cand = { codparceiro: number; razao: string; fantasia: string | null; fixo: number; vencPrev: number | null };
type Res = { simulado: boolean; gerados: Array<Record<string, unknown>>; descartados: Array<Record<string, unknown>>; totais: { clientes: number; gerados: number; descartados: number; valor: number; jaExistiam: number; semValorFixo: number } };

export function GerarFinanceiroLotePage() {
  const mensagem = useMensagem();
  const [cands, setCands] = useState<Cand[]>([]);
  const [soma, setSoma] = useState(0);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [q, setQ] = useState('');
  const [f, setF] = useState({ dtvenc: hoje(), codbco: '', usarVencimentoCliente: false });
  const [res, setRes] = useState<Res | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const pedir = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(url, { ...init, headers: { ...apiHeaders(), ...(init?.headers ?? {}) } });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      throw Object.assign(new Error(env.code), { envelope: env });
    }
    return (await r.json()) as T;
  };
  const carregar = async () => {
    try {
      const r = await pedir<{ itens: Cand[]; soma: number }>(`${BASE}/cobranca/gerar-financeiro-lote/candidatos?${new URLSearchParams({ q: q.trim() })}`);
      setCands(r.itens); setSoma(r.soma); setSel(new Set(r.itens.map((c) => c.codparceiro)));
    } catch (e) { mensagem.erro(e); }
  };
  useEffect(() => { void carregar(); }, []);
  const alternar = (cod: number) => { const n = new Set(sel); if (n.has(cod)) n.delete(cod); else n.add(cod); setSel(n); };
  const executar = async (simular: boolean) => {
    if (sel.size === 0) return mensagem.erro(new Error('Selecione ao menos um cliente.'));
    if (!simular && !window.confirm(`Gerar ${sel.size} título(s) com vencimento em ${dataBr(f.dtvenc)}?`)) return;
    setOcupado(true);
    try {
      setRes(await pedir<Res>(`${BASE}/cobranca/gerar-financeiro-lote`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientes: [...sel], dtvenc: f.dtvenc, codbco: Number(f.codbco || 0), usarVencimentoCliente: f.usarVencimentoCliente, simular }),
      }));
      if (!simular) { mensagem.sucesso('Geração efetuada.'); await carregar(); }
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const selecionados = cands.filter((c) => sel.has(c.codparceiro));
  const somaSel = selecionados.reduce((s, c) => s + c.fixo, 0);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Gerar financeiro em lote" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">Um título a receber por cliente, no valor fixo cadastrado nele. Simule antes: a simulação mostra quem entraria e quem seria descartado por já ter título igual.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&Vencimento" type="date" value={f.dtvenc} onChange={(e) => setF({ ...f, dtvenc: e.target.value })} /></div>
          <div className="w-28"><Field label="&Banco" value={f.codbco} onChange={(e) => setF({ ...f, codbco: e.target.value.replace(/\D/g, '') })} /></div>
          <label className="flex items-center gap-1 pb-2 text-body-sm"><input type="checkbox" checked={f.usarVencimentoCliente} onChange={(e) => setF({ ...f, usarVencimentoCliente: e.target.checked })} /> usar o dia de vencimento do cliente</label>
          <Button label="&Simular" variant="outline" disabled={ocupado} onClick={() => void executar(true)} />
          <Button label="&Gerar financeiro" disabled={ocupado} onClick={() => void executar(false)} />
        </div>
      </section>

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-72"><Field label="&Cliente" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void carregar(); }} /></div>
          <Button label="&Buscar" variant="outline" onClick={() => void carregar()} />
          <span className="pb-2 text-body-sm text-fg-muted">{cands.length} cliente(s) com valor fixo · total {moeda(soma)} · selecionados {sel.size} ({moeda(somaSel)})</span>
        </div>
        <div className="mt-form-gap overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-body-sm">
            <thead><tr className="border-b border-border text-left text-fg-muted">
              <th className="p-pad-xs"><input type="checkbox" checked={sel.size === cands.length && cands.length > 0} onChange={(e) => setSel(e.target.checked ? new Set(cands.map((c) => c.codparceiro)) : new Set())} /></th>
              <th className="p-pad-xs">Código</th><th className="p-pad-xs">Cliente</th><th className="p-pad-xs text-right">Valor fixo</th><th className="p-pad-xs text-right">Dia venc.</th>
            </tr></thead>
            <tbody>{cands.map((c) => (
              <tr key={c.codparceiro} className="border-b border-border">
                <td className="p-pad-xs"><input type="checkbox" checked={sel.has(c.codparceiro)} onChange={() => alternar(c.codparceiro)} /></td>
                <td className="p-pad-xs tabular-nums">{c.codparceiro}</td><td className="p-pad-xs">{c.razao}</td>
                <td className="p-pad-xs text-right tabular-nums font-semibold">{moeda(c.fixo)}</td><td className="p-pad-xs text-right tabular-nums">{c.vencPrev ?? ''}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </section>

      {res && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex flex-wrap gap-gp-md text-body-sm">
            <span className="font-semibold">{res.simulado ? 'Simulação' : 'Geração concluída'}</span>
            <span>Títulos <strong className="tabular-nums">{res.totais.gerados}</strong> ({moeda(res.totais.valor)})</span>
            <span>Descartados <strong className="tabular-nums">{res.totais.descartados}</strong> — já existiam {res.totais.jaExistiam}, sem valor fixo {res.totais.semValorFixo}</span>
          </div>
          {res.descartados.length > 0 && (
            <div className="mt-form-gap overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse text-body-sm">
                <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Cliente</th><th className="p-pad-xs">Motivo</th><th className="p-pad-xs">Título existente</th></tr></thead>
                <tbody>{res.descartados.map((d, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="p-pad-xs">{String(d.codparceiro)} · {String(d.razao ?? '')}</td>
                    <td className="p-pad-xs">{d.motivo === 'JA_EXISTE' ? 'já existe título igual' : 'sem valor fixo cadastrado'}</td>
                    <td className="p-pad-xs tabular-nums">{d.codrcb == null ? '' : String(d.codrcb)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
