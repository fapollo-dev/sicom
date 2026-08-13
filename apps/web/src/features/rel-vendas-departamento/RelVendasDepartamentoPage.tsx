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
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

interface Linha {
  dia?: string; coddpto: number | null; departamento: string;
  total_custo: number; total_venda: number; total_lucro: number; desc_acre: number;
  vr_ticket_medio: number | null; margem: number; rentabilidade: number | null; cupons: number;
}
interface Totais {
  dias: number; total_venda: number; total_custo: number; total_lucro: number; cupons: number;
  ticket_medio_periodo: number | null; cupons_ticket: number; margem: number; rentabilidade: number | null;
}

/**
 * VENDAS DATA / DEPARTAMENTO (rel 38 do hub de Vendas) — dia × departamento, com o resumo do período por
 * departamento (a banda do impresso do legado) e o ticket médio do período (a query auxiliar).
 */
export function RelVendasDepartamentoPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [dptos, setDptos] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ linhas: Linha[]; departamentos: Linha[]; totais: Totais }>(
        '/relatorios/vendas-departamento/consultar', { dtini, dtfim },
      );
      setLinhas(r.linhas); setDptos(r.departamentos); setTotais(r.totais);
      if (!r.linhas.length) mensagem.sucesso('Não há venda no período informado.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const Tabela = ({ dados, comData }: { dados: Linha[]; comData: boolean }) => (
    <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="text-left text-fg-muted">
            {comData && <th className="p-pad-xs">Data</th>}
            <th className="p-pad-xs">Departamento</th>
            <th className="p-pad-xs text-right">Custo</th><th className="p-pad-xs text-right">Venda</th>
            <th className="p-pad-xs text-right">Lucro</th>
            <th className="p-pad-xs text-right">Margem*</th><th className="p-pad-xs text-right">Rentab.</th>
            <th className="p-pad-xs text-right">Ticket médio**</th><th className="p-pad-xs text-right">Cupons</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((l, i) => (
            <tr key={`${l.dia ?? 'p'}-${l.coddpto ?? 'n'}-${i}`} className="border-t border-border">
              {comData && <td className="p-pad-xs tabular-nums">{dia(l.dia)}</td>}
              <td className="p-pad-xs">{l.departamento}</td>
              <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.total_custo)}</td>
              <td className="p-pad-xs text-right tabular-nums">{brl(l.total_venda)}</td>
              <td className={`p-pad-xs text-right tabular-nums ${l.total_lucro < 0 ? 'text-danger' : ''}`}>{brl(l.total_lucro)}</td>
              <td className="p-pad-xs text-right tabular-nums text-fg-muted">{pc(l.margem)}</td>
              <td className="p-pad-xs text-right tabular-nums">{pc(l.rentabilidade)}</td>
              <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.vr_ticket_medio)}</td>
              <td className="p-pad-xs text-right tabular-nums">{l.cupons}</td>
            </tr>
          ))}
          {!dados.length && <tr><td colSpan={comData ? 9 : 8} className="p-pad-md text-fg-muted">Informe o período e consulte.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Vendas por data e departamento" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {[
            { rot: 'Faturamento', val: brl(totais.total_venda), ac: true },
            { rot: 'Custo', val: brl(totais.total_custo) },
            { rot: 'Lucro', val: brl(totais.total_lucro), dg: totais.total_lucro < 0 },
            { rot: 'Rentabilidade', val: pc(totais.rentabilidade) },
            { rot: `Ticket médio do período (${totais.cupons_ticket} cupons)`, val: brl(totais.ticket_medio_periodo) },
          ].map((k) => (
            <div key={k.rot} className="flex-1 min-w-32 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.rot}</div>
              <div className={`text-title-sm font-bold tabular-nums ${(k as any).ac ? 'text-accent' : ''} ${(k as any).dg ? 'text-danger' : ''}`}>{k.val}</div>
            </div>
          ))}
        </div>
      )}

      {!!dptos.length && (
        <>
          <div className="text-body-sm font-semibold">Resumo do período por departamento</div>
          <Tabela dados={dptos} comData={false} />
        </>
      )}

      <div className="text-body-sm font-semibold">Dia a dia</div>
      <Tabela dados={linhas} comData />

      {!!linhas.length && (
        <small className="text-fg-muted">
          * Nesta variante o relatório original calcula <b>Margem = custo ÷ venda × 100</b> (a participação do
          custo), não o markup das telas de Produtos Vendidos. ** O «Ticket médio» da coluna é a <b>média das
          médias</b> (a média, entre cupons, do valor médio do item) — diferente do «Ticket médio do período»
          acima, que é faturamento ÷ cupons. As duas contas são do legado e não fecham entre si.
        </small>
      )}
    </div>
  );
}
