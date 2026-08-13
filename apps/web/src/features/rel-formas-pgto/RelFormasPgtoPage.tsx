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
const pc = (n: unknown) => (n == null ? '—' : `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

interface Linha { modalidade: string; total_venda: number; participacao: number | null }
interface Totais { total_venda: number; modalidades: number }

/**
 * GRÁFICO DE FORMAS DE PAGAMENTO (rel 08 do hub de Vendas) — participação de cada finalizadora no período,
 * líquida de troco. Sangria, suprimento, desconto e acréscimo ficam de fora (lista fixa do legado).
 */
export function RelFormasPgtoPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ linhas: Linha[]; totais: Totais }>('/relatorios/formas-pgto/consultar', { dtini, dtfim });
      setLinhas(r.linhas); setTotais(r.totais);
      if (!r.linhas.length) mensagem.sucesso('Não há recebimento no período informado.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const max = Math.max(1, ...linhas.map((l) => Math.abs(Number(l.total_venda) || 0)));

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Formas de pagamento" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <small className="w-full text-fg-muted">
          Quanto entrou por cada finalizadora, <b>líquido de troco</b>. Sangria, suprimento, desconto e
          acréscimo não entram.
        </small>
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          <div className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
            <div className="text-body-xs text-fg-muted">Total recebido</div>
            <div className="text-title-sm font-bold tabular-nums text-accent">{brl(totais.total_venda)}</div>
          </div>
          <div className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
            <div className="text-body-xs text-fg-muted">Finalizadoras</div>
            <div className="text-title-sm font-bold tabular-nums">{totais.modalidades}</div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Finalizadora</th>
              <th className="p-pad-xs text-right">Valor</th>
              <th className="p-pad-xs w-1/2">Participação</th>
              <th className="p-pad-xs text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.modalidade} className="border-t border-border">
                <td className="p-pad-xs font-semibold">{l.modalidade}</td>
                <td className={`p-pad-xs text-right tabular-nums ${l.total_venda < 0 ? 'text-danger' : ''}`}>{brl(l.total_venda)}</td>
                <td className="p-pad-xs">
                  <div className="h-3 rounded-radius-sm bg-accent" style={{ width: `${(Math.abs(Number(l.total_venda)) / max) * 100}%` }} />
                </td>
                <td className="p-pad-xs text-right tabular-nums">{pc(l.participacao)}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={4} className="p-pad-md text-fg-muted">Informe o período e consulte.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
