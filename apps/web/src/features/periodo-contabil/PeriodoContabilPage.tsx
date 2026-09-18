import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CADASTRO DE PERÍODO CONTÁBIL (`FRMCADPERIODOCONTABIL`). Dossiê: `uCadPeriodoContabil.md`.
 * A tabela de onde saem as travas de período fechado (NF, títulos, baixas, caixa, cheque, adiantamento, cartão).
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const BLOQ: Array<[string, string]> = [
  ['bloqNf', 'NF'], ['bloqApg', 'A pagar'], ['bloqBaixaApg', 'Baixa a pagar'], ['bloqRcb', 'A receber'], ['bloqBaixaRcb', 'Baixa a receber'],
  ['bloqMovCaixa', 'Mov. caixa'], ['bloqChq', 'Cheque'], ['bloqAdiantamentoForn', 'Adiant. fornecedor'], ['bloqBaixaCrt', 'Baixa cartão'],
];
type Periodo = Record<string, unknown> & { codperiodocontabil: number };
const vazio = () => ({ competenciaContabil: '', competenciaFinanceira: '', competenciaGeracao: '', dataInicio: '', dataFim: '', status: 'N',
  bloqNf: 'N', bloqApg: 'N', bloqBaixaApg: 'N', bloqRcb: 'N', bloqBaixaRcb: 'N', bloqMovCaixa: 'N', bloqChq: 'N', bloqAdiantamentoForn: 'N', bloqBaixaCrt: 'N' } as Record<string, string>);

export function PeriodoContabilPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<Periodo[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [f, setF] = useState<Record<string, string>>(vazio());
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
  const carregar = async () => { try { setLista(await pedir<Periodo[]>(`${BASE}/contabil/periodo-contabil`)); } catch (e) { mensagem.erro(e); } };
  useEffect(() => { void carregar(); }, []);

  const editar = (p: Periodo) => {
    setSel(p.codperiodocontabil);
    const n = vazio();
    for (const k of Object.keys(n)) n[k] = String(p[k] ?? (k.startsWith('bloq') || k === 'status' ? 'N' : ''));
    setF(n);
  };
  const novo = () => { setSel(null); setF(vazio()); };
  const gravar = async () => {
    setOcupado(true);
    try {
      const corpo: Record<string, unknown> = { ...f };
      for (const k of ['competenciaFinanceira', 'competenciaGeracao']) if (!String(corpo[k]).trim()) delete corpo[k];
      await pedir(`${BASE}/contabil/periodo-contabil${sel ? `/${sel}` : ''}`, { method: sel ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
      mensagem.sucesso('Período gravado.'); novo(); await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const excluir = async () => {
    if (!sel || !window.confirm('Excluir este período?')) return;
    try { await pedir(`${BASE}/contabil/periodo-contabil/${sel}`, { method: 'DELETE' }); mensagem.sucesso('Período excluído.'); novo(); await carregar(); } catch (e) { mensagem.erro(e); }
  };
  const flip = (k: string) => setF({ ...f, [k]: f[k] === 'S' ? 'N' : 'S' });

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Períodos contábeis" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">O período fechado bloqueia, por tipo de movimento, tudo o que cair entre o início e o fim. A competência é única por empresa (MMAAAA).</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-32"><Field label="&Competência" value={f.competenciaContabil} placeholder="MMAAAA" onChange={(e) => setF({ ...f, competenciaContabil: e.target.value })} /></div>
          <div className="w-32"><Field label="Comp. &financeira" value={f.competenciaFinanceira} onChange={(e) => setF({ ...f, competenciaFinanceira: e.target.value })} /></div>
          <div className="w-32"><Field label="Comp. &geração" value={f.competenciaGeracao} onChange={(e) => setF({ ...f, competenciaGeracao: e.target.value })} /></div>
          <div className="w-40"><Field label="&Início" type="date" value={f.dataInicio} onChange={(e) => setF({ ...f, dataInicio: e.target.value })} /></div>
          <div className="w-40"><Field label="Fi&m" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <label className="flex items-center gap-gp-xs text-body-sm font-semibold"><input type="checkbox" checked={f.status === 'S'} onChange={() => flip('status')} />Período fechado</label>
        </div>
        <div className="mt-form-gap flex flex-wrap gap-gp-sm">
          {BLOQ.map(([k, r]) => (
            <label key={k} className="flex items-center gap-gp-xs text-body-sm"><input type="checkbox" checked={f[k] === 'S'} onChange={() => flip(k)} />{r}</label>
          ))}
        </div>
        <div className="mt-form-gap flex gap-gp-sm">
          <Button label="&Gravar" disabled={ocupado} onClick={() => void gravar()} />
          <Button label="&Novo" variant="outline" onClick={novo} />
          {sel && <Button label="&Excluir" variant="outline" onClick={() => void excluir()} />}
        </div>
      </section>
      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full min-w-[900px] border-collapse text-body-sm">
          <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Competência</th><th className="p-pad-xs">Início</th><th className="p-pad-xs">Fim</th><th className="p-pad-xs">Situação</th>{BLOQ.map(([k, r]) => <th key={k} className="p-pad-xs text-center">{r}</th>)}</tr></thead>
          <tbody>{lista.map((p) => (
            <tr key={p.codperiodocontabil} onClick={() => editar(p)} className={`cursor-pointer border-b border-border hover:bg-bg-subtle ${sel === p.codperiodocontabil ? 'bg-bg-subtle font-semibold' : ''}`}>
              <td className="p-pad-xs tabular-nums">{String(p.competenciaContabil)}</td><td className="p-pad-xs">{dataBr(p.dataInicio)}</td><td className="p-pad-xs">{dataBr(p.dataFim)}</td>
              <td className={`p-pad-xs ${p.status === 'S' ? 'font-semibold text-fg-danger' : ''}`}>{p.status === 'S' ? 'Fechado' : 'Aberto'}</td>
              {BLOQ.map(([k]) => <td key={k} className="p-pad-xs text-center">{p[k] === 'S' ? '●' : ''}</td>)}
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
