import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
  handle401(res);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: res.status, code: 'ERRO', message: (b as any)?.message ?? res.statusText };
    throw Object.assign(new Error(env.code ?? res.statusText), { envelope: env, status: res.status, body: b });
  }
  return (await res.json()) as T;
}

const brl = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

interface Conta { desccodplc: string; descricao: string; pai: string | null; descricao_pai: string | null; pai_principal: string; valor: number }
interface Totais {
  receitas: number; contas_recebidas_sem_conta: number; cartoes_recebidos: number; cheques_recebidos: number;
  despesas: number; resultado: number; custo_mercadoria: number;
}

/** agrupa as contas pelo PAI PRINCIPAL ('1.', '4.'…), que é como o legado monta os blocos da DRE. */
function porBloco(contas: Conta[]) {
  const m = new Map<string, Conta[]>();
  for (const c of contas) {
    const k = c.pai_principal ?? '?';
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(c);
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/**
 * CAIXA D.R.E. (FRMRELATORIOCAIXA) — demonstrativo de caixa por conta gerencial no período: o que entrou,
 * o que saiu (com as despesas RATEADAS por centro de custo) e o resultado.
 */
export function RelCaixaDrePage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [receitas, setReceitas] = useState<Conta[]>([]);
  const [despesas, setDespesas] = useState<Conta[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ receitas: Conta[]; despesas: Conta[]; totais: Totais }>(
        '/relatorios/caixa-dre/consultar', { dtini, dtfim },
      );
      setReceitas(r.receitas); setDespesas(r.despesas); setTotais(r.totais);
      if (!r.receitas.length && !r.despesas.length) mensagem.sucesso('Nenhum movimento de caixa no período.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const Bloco = ({ titulo, contas, extras, cor }: { titulo: string; contas: Conta[]; extras?: [string, number][]; cor: string }) => (
    <div className="flex-1 min-w-80 overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
      <div className={`border-b border-border p-pad-xs text-body-sm font-semibold ${cor}`}>{titulo}</div>
      <table className="w-full text-body-sm">
        <tbody>
          {porBloco(contas).map(([pai, linhas]) => (
            <>
              <tr key={pai} className="border-t border-border bg-bg-subtle">
                <td className="p-pad-xs font-semibold" colSpan={2}>{pai} {linhas[0]?.descricao_pai ?? ''}</td>
                <td className="p-pad-xs text-right tabular-nums font-semibold">
                  {brl(linhas.reduce((s, l) => s + Number(l.valor), 0))}
                </td>
              </tr>
              {linhas.map((c) => (
                <tr key={c.desccodplc} className="border-t border-border">
                  <td className="p-pad-xs tabular-nums text-fg-muted">{c.desccodplc}</td>
                  <td className="p-pad-xs">{c.descricao}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(c.valor)}</td>
                </tr>
              ))}
            </>
          ))}
          {(extras ?? []).filter(([, v]) => v !== 0).map(([rot, v]) => (
            <tr key={rot} className="border-t border-border">
              <td className="p-pad-xs text-fg-muted" colSpan={2}>{rot}</td>
              <td className="p-pad-xs text-right tabular-nums">{brl(v)}</td>
            </tr>
          ))}
          {!contas.length && !(extras ?? []).some(([, v]) => v !== 0) && (
            <tr><td className="p-pad-md text-fg-muted" colSpan={3}>Sem movimento.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Caixa — D.R.E." />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <small className="w-full text-fg-muted">
          Regime de <b>caixa</b>: conta o que entrou e saiu no período, não o que foi faturado. As despesas são
          <b> rateadas por centro de custo</b> e saem líquidas de juros e acréscimo/desconto.
        </small>
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {[
            { rot: 'Receitas', val: totais.receitas, ac: true },
            { rot: 'Despesas', val: totais.despesas },
            { rot: 'Resultado', val: totais.resultado, ac: totais.resultado >= 0, dg: totais.resultado < 0 },
            { rot: 'Custo da mercadoria', val: totais.custo_mercadoria },
          ].map((k) => (
            <div key={k.rot} className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.rot}</div>
              <div className={`text-title-sm font-bold tabular-nums ${k.ac ? 'text-accent' : ''} ${(k as any).dg ? 'text-danger' : ''}`}>{brl(k.val)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-gp-md">
        <Bloco
          titulo="RECEITAS — o que entrou"
          contas={receitas}
          cor="text-accent"
          extras={totais ? [
            ['1.01. CONTAS RECEBIDAS (título sem conta gerencial)', totais.contas_recebidas_sem_conta],
            ['1.03. CARTÕES RECEBIDOS', totais.cartoes_recebidos],
          ] : []}
        />
        <Bloco titulo="DESPESAS — o que saiu (rateado por centro de custo)" contas={despesas} cor="text-danger" />
      </div>
    </div>
  );
}
