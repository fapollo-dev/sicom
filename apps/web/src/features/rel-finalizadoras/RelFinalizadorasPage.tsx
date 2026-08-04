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
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

interface Modalidade { modalidade: string; destino: string | null; campo: string }
type Linha = Record<string, unknown> & { dia: string; total_venda: number; desconto: number; acrescimo: number; cancelamento: number; total_finalizadoras: number; diferenca: number };
type Totais = Record<string, number>;

/**
 * VENDAS E FINALIZADORAS (FRMRELFINALIZADORAS). Uma linha por DIA: o líquido vendido, desconto, acréscimo,
 * cancelamento e quanto entrou em cada forma de pagamento. A coluna «Diferença» é a conferência do dia
 * (finalizadoras − venda) — é onde o operador acha o furo de fechamento.
 */
export function RelFinalizadorasPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [mods, setMods] = useState<Modalidade[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [part, setPart] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ modalidades: Modalidade[]; linhas: Linha[]; totais: Totais; participacao: Record<string, number | null> }>(
        '/relatorios/finalizadoras/consultar', { dtini, dtfim },
      );
      setMods(r.modalidades); setLinhas(r.linhas); setTotais(r.totais); setPart(r.participacao ?? {});
      if (!r.linhas.length) mensagem.sucesso('Nenhum movimento no período.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const exportar = () => {
    if (!linhas.length) return;
    const cab = ['dia', 'total_venda', 'desconto', 'acrescimo', 'cancelamento', ...mods.map((m) => `fin_${m.campo}`), 'total_finalizadoras', 'diferenca'];
    const cel = (v: unknown) => (typeof v === 'number' ? String(v).replace('.', ',') : v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
    const corpo = linhas.map((l) => cab.map((c) => cel(c === 'dia' ? l.dia : Number(l[c] ?? 0))).join(';'));
    const blob = new Blob(['﻿' + [cab.join(';'), ...corpo].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vendas-finalizadoras-${dtini}_${dtfim}.csv`;
    a.click();
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Vendas e Finalizadoras" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <Button label="&Exportar CSV" variant="ghost" disabled={!linhas.length} onClick={exportar} />
        <small className="w-full text-fg-muted">
          Uma linha por dia. As colunas de pagamento saem das formas cadastradas na empresa; o total soma
          <b> só pagamento</b> (sangria e suprimento ficam fora, como no legado). «Diferença» é informativa —
          um resíduo pequeno é normal.
        </small>
      </div>

      {!!totais?.sem_cadastro && (
        <div className="rounded-radius-md border border-border bg-bg-subtle p-pad-sm text-body-sm text-fg-muted">
          {brl(totais.sem_cadastro)} do movimento de caixa no período são de operações que <b>não são forma de
          pagamento</b> cadastrada (sangria, suprimento, ajustes). Como no legado, elas não têm coluna e <b>não</b>
          entram no total de finalizadoras.
        </div>
      )}

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {[
            { rot: 'Total vendido', val: totais.total_venda, ac: true },
            { rot: 'Finalizadoras', val: totais.total_finalizadoras },
            { rot: 'Diferença (informativa)', val: totais.diferenca },
            { rot: 'Descontos', val: totais.desconto },
            { rot: 'Cancelamentos', val: totais.cancelamento, dg: Number(totais.cancelamento) > 0 },
          ].map((k) => (
            <div key={k.rot} className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.rot}</div>
              <div className={`text-title-sm font-bold tabular-nums ${k.ac ? 'text-accent' : ''} ${(k as any).dg ? 'text-danger' : ''}`}>{brl(k.val)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="sticky left-0 z-10 bg-bg-surface p-pad-xs">Dia</th>
              <th className="p-pad-xs text-right">Vendido</th>
              <th className="p-pad-xs text-right">Desconto</th>
              <th className="p-pad-xs text-right">Acréscimo</th>
              <th className="p-pad-xs text-right">Cancelado</th>
              {mods.map((m) => (
                <th key={m.campo} className="p-pad-xs text-right whitespace-nowrap" title={m.destino ? `destino ${m.destino}` : undefined}>{m.modalidade}</th>
              ))}
              <th className="p-pad-xs text-right">Finalizadoras</th>
              <th className="p-pad-xs text-right">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              return (
                <tr key={l.dia} className="border-t border-border">
                  <td className="sticky left-0 z-10 bg-inherit p-pad-xs tabular-nums">{dia(l.dia)}</td>
                  <td className="p-pad-xs text-right tabular-nums font-semibold">{brl(l.total_venda)}</td>
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.desconto)}</td>
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.acrescimo)}</td>
                  <td className={`p-pad-xs text-right tabular-nums ${Number(l.cancelamento) > 0 ? 'text-danger' : 'text-fg-muted'}`}>{brl(l.cancelamento)}</td>
                  {mods.map((m) => (
                    <td key={m.campo} className="p-pad-xs text-right tabular-nums">
                      {Number(l[`fin_${m.campo}`]) ? brl(l[`fin_${m.campo}`]) : <span className="text-fg-muted">·</span>}
                    </td>
                  ))}
                  <td className="p-pad-xs text-right tabular-nums">{brl(l.total_finalizadoras)}</td>
                  {/* INFORMATIVA: existe resíduo legítimo de R$16 a R$112/dia (arredondamento e movimento de
                      borda), então não há alarme por "≠ 0" — limiar sem base no legado mandaria caçar furo falso. */}
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.diferenca)}</td>
                </tr>
              );
            })}
            {!linhas.length && <tr><td colSpan={mods.length + 7} className="p-pad-md text-fg-muted">Informe o período e clique em Consultar.</td></tr>}
          </tbody>
          {totais && linhas.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="sticky left-0 z-10 bg-bg-surface p-pad-xs">TOTAL</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(totais.total_venda)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(totais.desconto)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(totais.acrescimo)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(totais.cancelamento)}</td>
                {mods.map((m) => <td key={m.campo} className="p-pad-xs text-right tabular-nums">{brl(totais[`fin_${m.campo}`])}</td>)}
                <td className="p-pad-xs text-right tabular-nums">{brl(totais.total_finalizadoras)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(totais.diferenca)}</td>
              </tr>
              {/* PARTICIPAÇÃO % — a última linha da grade do legado (:548-566): cada modalidade sobre o total vendido */}
              <tr className="border-t border-border text-fg-muted">
                <td className="sticky left-0 z-10 bg-bg-surface p-pad-xs">% sobre o vendido</td>
                <td /><td /><td /><td />
                {mods.map((m) => (
                  <td key={m.campo} className="p-pad-xs text-right tabular-nums">
                    {part[`fin_${m.campo}`] == null ? '—' : `${Number(part[`fin_${m.campo}`]).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
                  </td>
                ))}
                <td /><td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
