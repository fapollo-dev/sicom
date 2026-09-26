import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { hojeNaLoja } from '../../shared/tempo';

/**
 * FECHAMENTO DE SANGRIA (`FRMFECHAMENTOSANGRIA`) — a tesouraria. Dossiê: `tesouraria-sangria-fechamento.md`.
 * As sangrias da loja no período: AUTENTICAR carimba cada uma; FECHAR junta as marcadas num lote e grava a contagem (o total e, se
 * quiser, as cédulas); o lote pode ser ESTORNADO. O suprimento não entra. A despesa paga no caixa (sangria com descrição) vem
 * desmarcada — na produção ela fica fora do lote em 504 de 508 vezes.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataHora = (v: unknown) => (v == null ? '' : `${String(v).slice(0, 10).split('-').reverse().join('/')} ${String(v).slice(11, 16)}`);
const hoje = () => hojeNaLoja();

interface Sangria {
  codhistsangria: number; data: string; codpdv: number | null; descricao: string | null; valor: number; nome_responsavel: string | null; operador: string | null;
  autenticado: string | null; autenticado_por: string | null; data_autenticado: string | null; lote_autenticado: number | null;
  fechado: string | null; fechado_por: string | null; data_fechado: string | null; lote_fechado: number | null;
}
interface Lote { codcontagem_cedulas: number; lote_fechado: number; valor: number; soma_sangrias: number; sangrias: number; operador: string | null; data: string; divergente: boolean }
interface Consulta { exigeAutenticacao: boolean; sangrias: Sangria[]; lotes: Lote[] }
const CEDULAS: Array<[string, string]> = [['r200', 'R$ 200'], ['r100', 'R$ 100'], ['r50', 'R$ 50'], ['r20', 'R$ 20'], ['r10', 'R$ 10'], ['r5', 'R$ 5'], ['r2', 'R$ 2'],
  ['r1', 'R$ 1'], ['c50', '0,50'], ['c25', '0,25'], ['c10', '0,10'], ['c5', '0,05'], ['c1', '0,01']];

export function FechamentoSangriaPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: hoje(), dataFim: hoje() });
  const [res, setRes] = useState<Consulta | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [cedulas, setCedulas] = useState<Record<string, string>>({});
  const [contando, setContando] = useState(false);
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
  const buscar = async () => {
    setOcupado(true);
    try {
      const r = await pedir<Consulta>(`${BASE}/cobranca/fechamento-sangria?${new URLSearchParams(f)}`);
      setRes(r);
      setSel(new Set(r.sangrias.filter((s) => s.fechado !== 'S' && !s.descricao).map((s) => s.codhistsangria)));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const marcadas = (res?.sangrias ?? []).filter((s) => sel.has(s.codhistsangria));
  const total = marcadas.reduce((t, s) => t + s.valor, 0);
  const acao = async (path: string, body: unknown, ok: (r: any) => string) => {
    setOcupado(true);
    try {
      const r = await pedir<any>(`${BASE}/cobranca/fechamento-sangria${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      mensagem.sucesso(ok(r));
      await buscar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const autenticar = () => {
    const ids = marcadas.filter((s) => s.autenticado !== 'S').map((s) => s.codhistsangria);
    if (!ids.length) return mensagem.erro(new Error('Marque sangrias ainda não autenticadas.'));
    void acao('/autenticar', { sangrias: ids }, (r) => `${r.autenticadas} sangria(s) autenticada(s).`);
  };
  const fechar = () => {
    const ids = marcadas.filter((s) => s.fechado !== 'S').map((s) => s.codhistsangria);
    if (!ids.length) return mensagem.erro(new Error('Marque sangrias abertas para fechar o lote.'));
    const ced = Object.fromEntries(Object.entries(cedulas).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)]));
    setContando(false);
    void acao('/fechar', { sangrias: ids, cedulas: ced }, (r) => `Lote ${r.lote} fechado: ${moeda(r.valor)} (contagem ${r.codcontagem_cedulas}).`);
    setCedulas({});
  };
  const estornar = (l: Lote) => {
    if (!window.confirm(`Estornar o lote ${l.lote_fechado}? As ${l.sangrias} sangria(s) voltam a ficar abertas.`)) return;
    void acao(`/lotes/${l.codcontagem_cedulas}/estornar`, {}, (r) => `Lote ${r.lote} estornado: ${r.sangrias} sangria(s) reabertas.`);
  };
  const alternar = (id: number) => { const s = new Set(sel); if (s.has(id)) s.delete(id); else s.add(id); setSel(s); };
  const status = (s: Sangria) => (s.fechado === 'S' ? `Fechada · lote ${s.lote_fechado}` : s.autenticado === 'S' ? 'Autenticada' : 'Aberta');

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Fechamento de sangria" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="Sangrias &de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void buscar()} />
          <Button label="A&utenticar" variant="soft" disabled={ocupado || marcadas.length === 0} onClick={autenticar} />
          <Button label="&Fechar lote" variant="soft" disabled={ocupado || marcadas.length === 0} onClick={() => setContando(true)} />
        </div>
        {res?.exigeAutenticacao && <p className="mt-form-gap text-body-sm text-fg-muted">Nesta loja só fecha sangria autenticada.</p>}
      </section>

      {contando && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <p className="mb-form-gap text-body-sm">Lote de <strong>{marcadas.filter((s) => s.fechado !== 'S').length}</strong> sangria(s), total <strong className="tabular-nums">R$ {moeda(total)}</strong>. A contagem das cédulas é opcional.</p>
          <div className="grid grid-cols-3 gap-form-gap sm:grid-cols-7">
            {CEDULAS.map(([k, rot]) => (
              <Field key={k} label={rot} inputMode="numeric" value={cedulas[k] ?? ''} onChange={(e) => setCedulas({ ...cedulas, [k]: e.target.value.replace(/\D/g, '') })} />
            ))}
          </div>
          <div className="mt-form-gap flex gap-gp-sm">
            <Button label="Confirmar o fechamento" disabled={ocupado} onClick={fechar} />
            <Button label="Cancelar" variant="soft" onClick={() => setContando(false)} />
          </div>
        </section>
      )}

      {res && (
        <>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full min-w-[980px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs" />
                <th className="p-pad-xs">Data</th><th className="p-pad-xs">PDV</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs text-right">Valor</th>
                <th className="p-pad-xs">Responsável</th><th className="p-pad-xs">Situação</th><th className="p-pad-xs">Autenticada por</th><th className="p-pad-xs">Fechada por</th>
              </tr></thead>
              <tbody>{res.sangrias.map((s) => (
                <tr key={s.codhistsangria} className={`border-b border-border ${s.fechado === 'S' ? 'text-fg-muted' : ''}`}>
                  <td className="p-pad-xs"><input type="checkbox" aria-label={`Marcar a sangria ${s.codhistsangria}`} checked={sel.has(s.codhistsangria)} disabled={s.fechado === 'S'} onChange={() => alternar(s.codhistsangria)} /></td>
                  <td className="p-pad-xs tabular-nums">{dataHora(s.data)}</td><td className="p-pad-xs tabular-nums">{s.codpdv ?? ''}</td>
                  <td className="p-pad-xs">{s.descricao ?? ''}</td><td className="p-pad-xs text-right tabular-nums">{moeda(s.valor)}</td>
                  <td className="p-pad-xs">{s.nome_responsavel ?? ''}</td><td className="p-pad-xs">{status(s)}</td>
                  <td className="p-pad-xs">{s.autenticado === 'S' ? `${s.autenticado_por ?? ''} ${dataHora(s.data_autenticado)}` : ''}</td>
                  <td className="p-pad-xs">{s.fechado === 'S' ? `${s.fechado_por ?? ''} ${dataHora(s.data_fechado)}` : ''}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <p className="text-body-sm text-fg-muted">Marcadas: <strong className="tabular-nums">{marcadas.length}</strong> · total <strong className="tabular-nums">R$ {moeda(total)}</strong></p>
          {res.lotes.length > 0 && (
            <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
              <table className="w-full min-w-[720px] border-collapse text-body-sm">
                <thead><tr className="border-b border-border text-left text-fg-muted">
                  <th className="p-pad-xs">Lote</th><th className="p-pad-xs">Fechado em</th><th className="p-pad-xs">Por</th><th className="p-pad-xs text-right">Sangrias</th>
                  <th className="p-pad-xs text-right">Contagem</th><th className="p-pad-xs text-right">Σ sangrias</th><th className="p-pad-xs" />
                </tr></thead>
                <tbody>{res.lotes.map((l) => (
                  <tr key={l.codcontagem_cedulas} className="border-b border-border">
                    <td className="p-pad-xs tabular-nums">{l.lote_fechado}</td><td className="p-pad-xs tabular-nums">{dataHora(l.data)}</td><td className="p-pad-xs">{l.operador ?? ''}</td>
                    <td className="p-pad-xs text-right tabular-nums">{l.sangrias}</td>
                    <td className={`p-pad-xs text-right tabular-nums ${l.divergente ? 'text-fg-danger' : ''}`}>{moeda(l.valor)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{moeda(l.soma_sangrias)}</td>
                    <td className="p-pad-xs"><Button label="Estornar" variant="soft" disabled={ocupado} onClick={() => estornar(l)} /></td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
