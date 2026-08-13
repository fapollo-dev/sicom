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
const q2 = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

interface Linha {
  dia: string; total_qtde: number; total_venda: number; total_custo: number; total_lucro: number;
  cupons: number; vr_ticket_medio: number; rentabilidade: number; margem: number; lucro_b_percent: number | null;
}
interface Totais {
  dias: number; total_qtde: number; total_venda: number; total_custo: number; total_lucro: number;
  cupons: number; ticket_medio: number; rentabilidade: number; margem: number;
}

/**
 * VENDAS DATA (rel 02 do hub de Vendas) — o fechamento diário: venda, custo, lucro, ticket médio e nº de cupons
 * por dia. A coluna «Rent/Markdown» é a fórmula do legado (divide por venda − 1); ver a nota no rodapé.
 */
export function RelVendasDataPage() {
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
      const r = await req<{ linhas: Linha[]; totais: Totais }>('/relatorios/vendas-data/consultar', { dtini, dtfim });
      setLinhas(r.linhas); setTotais(r.totais);
      if (!r.linhas.length) mensagem.sucesso('Não há venda no período informado.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Vendas por data" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <small className="w-full text-fg-muted">
          Um dia por linha. <b>Cupons</b> conta cupons (não itens), e o <b>ticket médio</b> é o faturamento do dia
          dividido por eles.
        </small>
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {[
            { rot: 'Faturamento', val: brl(totais.total_venda), ac: true },
            { rot: 'Custo', val: brl(totais.total_custo) },
            { rot: 'Lucro', val: brl(totais.total_lucro), dg: totais.total_lucro < 0 },
            { rot: `Cupons (${totais.dias} dia${totais.dias === 1 ? '' : 's'})`, val: String(totais.cupons) },
            { rot: 'Ticket médio', val: brl(totais.ticket_medio) },
            { rot: 'Rentabilidade', val: pc(totais.rentabilidade) },
          ].map((k) => (
            <div key={k.rot} className="flex-1 min-w-32 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.rot}</div>
              <div className={`text-title-sm font-bold tabular-nums ${(k as any).ac ? 'text-accent' : ''} ${(k as any).dg ? 'text-danger' : ''}`}>{k.val}</div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Data</th>
              <th className="p-pad-xs text-right">Qtde</th><th className="p-pad-xs text-right">Custo</th>
              <th className="p-pad-xs text-right">Venda</th><th className="p-pad-xs text-right">Lucro</th>
              <th className="p-pad-xs text-right">Rent/Markdown*</th><th className="p-pad-xs text-right">Margem/Markup</th>
              <th className="p-pad-xs text-right">Ticket médio</th><th className="p-pad-xs text-right">Cupons</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.dia} className="border-t border-border">
                <td className="p-pad-xs tabular-nums">{dia(l.dia)}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{q2(l.total_qtde)}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.total_custo)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(l.total_venda)}</td>
                <td className={`p-pad-xs text-right tabular-nums ${l.total_lucro < 0 ? 'text-danger' : ''}`}>{brl(l.total_lucro)}</td>
                {/* a coluna que o legado exibe — fórmula dele, com o divisor (venda − 1). Ver a nota abaixo. */}
                <td className="p-pad-xs text-right tabular-nums text-fg-muted" title={`Fórmula do legado. Rentabilidade calculada: ${pc(l.rentabilidade)}`}>{pc(l.lucro_b_percent)}</td>
                <td className="p-pad-xs text-right tabular-nums">{pc(l.margem)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(l.vr_ticket_medio)}</td>
                <td className="p-pad-xs text-right tabular-nums">{l.cupons}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={9} className="p-pad-md text-fg-muted">Informe o período e consulte.</td></tr>}
          </tbody>
        </table>
      </div>
      {!!linhas.length && (
        <small className="text-fg-muted">
          * «Rent/Markdown» reproduz a fórmula do relatório original, que divide o custo por
          <b> (venda − 1) </b>em vez de pela venda — por isso ela não fecha com o total de <b>Rentabilidade</b>
          acima, que usa (venda − custo) ÷ venda. Passe o mouse na célula para ver a rentabilidade calculada do dia.
        </small>
      )}
    </div>
  );
}
