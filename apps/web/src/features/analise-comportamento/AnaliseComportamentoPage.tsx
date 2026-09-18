import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * ANÁLISE DE COMPORTAMENTO DA LOJA (`FRMANALISECOMPORTAMENTO`).
 * Dossiê: `uAnaliseComportamento.md`.
 *
 * Um mês; três blocos (mês anterior, mês atual, ano anterior) × nove linhas × cinco "semanas" fixas de 7
 * dias + total; dois comparativos. O painel de impostos mantém a lista de contas que a linha "Previsão de
 * Impostos" soma.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR');
const pct = (v: unknown) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`);

type Linhas = Record<string, number>;
interface Semana extends Linhas { n: number }
interface Bloco { chave: string; rotulo: string; semanas: Semana[]; total: Linhas }
interface Par { diferenca: number; variacao: number | null }
interface Comparativo { rotulo: string; semanas: Array<{ n: number } & Record<string, Par | number>>; total: Record<string, Par> }
interface Resultado { blocos: Bloco[]; comparativos: Comparativo[] }
interface Imposto { codplc: number; descricao: string; desccodplc: string | null }

const LINHAS: Array<{ k: string; rotulo: string; fmt: (v: unknown) => string }> = [
  { k: 'faturamento', rotulo: 'Faturamento', fmt: moeda },
  { k: 'cmv', rotulo: 'CMV', fmt: moeda },
  { k: 'rentabilidade', rotulo: 'Rentabilidade', fmt: moeda },
  { k: 'impostos', rotulo: 'Previsão Impostos', fmt: moeda },
  { k: 'lucroFinal', rotulo: 'Lucro Final', fmt: moeda },
  { k: 'margemBruta', rotulo: 'Margem Bruta', fmt: pct },
  { k: 'margemFinal', rotulo: 'Margem Final', fmt: pct },
  { k: 'clientes', rotulo: 'Num. Clientes', fmt: inteiro },
  { k: 'ticketMedio', rotulo: 'Ticket Médio', fmt: moeda },
];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function AnaliseComportamentoPage() {
  const mensagem = useMensagem();
  const hoje = new Date();
  const [f, setF] = useState({ mes: String(hoje.getMonth() + 1), ano: String(hoje.getFullYear()), coddpto: '', codgrupo: '', codsubgrupo: '', codsecao: '', codfor: '' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [impostos, setImpostos] = useState<Imposto[] | null>(null);
  const [novoCodplc, setNovoCodplc] = useState('');
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
      const q = new URLSearchParams({ mes: f.mes, ano: f.ano });
      for (const k of ['coddpto', 'codgrupo', 'codsubgrupo', 'codsecao', 'codfor'] as const) if (f[k].trim()) q.set(k, f[k].trim());
      setRes(await pedir<Resultado>(`${BASE}/relatorios/analise-comportamento?${q}`));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const carregarImpostos = async () => {
    try { setImpostos(await pedir<Imposto[]>(`${BASE}/relatorios/analise-comportamento/impostos`)); } catch (e) { mensagem.erro(e); }
  };
  const adicionarImposto = async () => {
    if (!novoCodplc.trim()) return;
    try {
      await pedir(`${BASE}/relatorios/analise-comportamento/impostos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codplcs: [Number(novoCodplc)] }) });
      setNovoCodplc(''); await carregarImpostos();
    } catch (e) { mensagem.erro(e); }
  };
  const removerImposto = async (codplc: number) => {
    try { await pedir(`${BASE}/relatorios/analise-comportamento/impostos/${codplc}`, { method: 'DELETE' }); await carregarImpostos(); } catch (e) { mensagem.erro(e); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Análise de comportamento da loja" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          O mês escolhido, o anterior e o mesmo mês do ano passado, semana a semana (blocos fixos de 7 dias:
          1–7, 8–14, 15–21, 22–28, 29–fim). O recorte por família vale nos três blocos.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40">
            <label className="mb-1 block text-body-sm text-fg-muted">Mês</label>
            <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={f.mes} onChange={(e) => setF({ ...f, mes: e.target.value })}>
              {MESES.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
            </select>
          </div>
          <div className="w-28"><Field label="&Ano" value={f.ano} onChange={(e) => setF({ ...f, ano: e.target.value })} /></div>
          <div className="w-28"><Field label="&Depto" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-28"><Field label="&Grupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value })} /></div>
          <div className="w-28"><Field label="S&ubgrupo" value={f.codsubgrupo} onChange={(e) => setF({ ...f, codsubgrupo: e.target.value })} /></div>
          <div className="w-28"><Field label="&Seção" value={f.codsecao} onChange={(e) => setF({ ...f, codsecao: e.target.value })} /></div>
          <div className="w-28"><Field label="&Fornecedor" value={f.codfor} onChange={(e) => setF({ ...f, codfor: e.target.value })} /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void buscar()} />
          <Button label="&Impostos" variant="outline" onClick={() => void carregarImpostos()} />
        </div>
      </section>

      {impostos && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h3 className="mb-form-gap text-body-sm font-semibold">Contas somadas como "Previsão de Impostos"</h3>
          <div className="mb-form-gap flex flex-wrap items-end gap-gp-sm">
            <div className="w-40"><Field label="Conta do plano (código)" value={novoCodplc} onChange={(e) => setNovoCodplc(e.target.value)} /></div>
            <Button label="&Adicionar" onClick={() => void adicionarImposto()} />
          </div>
          {impostos.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Nenhuma conta marcada — a linha de impostos fica em zero e o Lucro Final é igual à Rentabilidade.</p>
          ) : (
            <table className="w-full border-collapse text-body-sm">
              <tbody>
                {impostos.map((i) => (
                  <tr key={i.codplc} className="border-b border-border">
                    <td className="p-pad-xs tabular-nums">{i.desccodplc ?? i.codplc}</td>
                    <td className="p-pad-xs">{i.descricao}</td>
                    <td className="p-pad-xs text-right"><Button label="Excluir" variant="outline" onClick={() => void removerImposto(i.codplc)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {res && res.blocos.map((b) => (
        <div key={b.chave} className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <h3 className="p-pad-xs text-body-sm font-semibold">{b.rotulo}</h3>
          <table className="w-full min-w-[820px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Linha</th>
                {b.semanas.map((s) => <th key={s.n} className="p-pad-xs text-right">Semana {s.n}</th>)}
                <th className="p-pad-xs text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {LINHAS.map((l) => (
                <tr key={l.k} className="border-b border-border">
                  <td className="p-pad-xs text-fg-muted">{l.rotulo}</td>
                  {b.semanas.map((s) => <td key={s.n} className="p-pad-xs text-right tabular-nums">{l.fmt(s[l.k])}</td>)}
                  <td className={`p-pad-xs text-right tabular-nums font-semibold ${l.k === 'lucroFinal' && Number(b.total[l.k]) < 0 ? 'text-fg-danger' : ''}`}>{l.fmt(b.total[l.k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {res && res.comparativos.map((c) => (
        <div key={c.rotulo} className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <h3 className="p-pad-xs text-body-sm font-semibold">{c.rotulo}</h3>
          <table className="w-full min-w-[820px] border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Linha</th>
                {c.semanas.map((s) => <th key={s.n} className="p-pad-xs text-right">Semana {s.n}</th>)}
                <th className="p-pad-xs text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {LINHAS.map((l) => {
                const cel = (p: Par | undefined) => p == null ? '—' : `${l.fmt(p.diferenca)} (${pct(p.variacao)})`;
                const tot = c.total[l.k];
                return (
                  <tr key={l.k} className="border-b border-border">
                    <td className="p-pad-xs text-fg-muted">Dif {l.rotulo}</td>
                    {c.semanas.map((s) => {
                      const p = s[l.k] as Par | undefined;
                      return <td key={s.n} className={`p-pad-xs text-right tabular-nums ${p && p.diferenca < 0 ? 'text-fg-danger' : p && p.diferenca > 0 ? 'text-fg-success' : ''}`}>{cel(p)}</td>;
                    })}
                    <td className={`p-pad-xs text-right tabular-nums font-semibold ${tot && tot.diferenca < 0 ? 'text-fg-danger' : tot && tot.diferenca > 0 ? 'text-fg-success' : ''}`}>{cel(tot)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
