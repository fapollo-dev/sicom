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
const int = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

interface Linha { dia: string; empresa?: string; cupons: number; total_venda: number; media: number | null }
interface Totais { dias: number; cupons: number; total_venda: number; media: number | null }

/**
 * VALOR DO TICKET MÉDIO (FRMVALORTICKETMEDIO). Uma linha por dia: cupons, total vendido e a média por cupom.
 * O ticket médio do período é RECALCULADO (total ÷ cupons), não a média das médias diárias.
 */
export function RelTicketMedioPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [filtrarHora, setFiltrarHora] = useState(false);
  const [horaPorDia, setHoraPorDia] = useState(false);
  const [horaIni, setHoraIni] = useState('00:00');
  const [horaFim, setHoraFim] = useState('23:59');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ linhas: Linha[]; totais: Totais }>('/relatorios/ticket-medio/consultar', {
        dtini, dtfim, filtrarHora, horaPorDia, horaIni, horaFim,
      });
      setLinhas(r.linhas); setTotais(r.totais);
      if (!r.linhas.length) mensagem.sucesso('Nenhuma venda no período/filtro.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Valor do Ticket Médio" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <label className="flex items-center gap-1 text-body-sm"><input type="checkbox" checked={filtrarHora} onChange={(e) => setFiltrarHora(e.target.checked)} /> Filtrar hora</label>
        {filtrarHora && (
          <>
            <div className="w-24"><Field label="De" value={horaIni} onChange={(e) => setHoraIni(e.target.value)} /></div>
            <div className="w-24"><Field label="Até" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} /></div>
            {/* o legado tem este checkbox separado: sem ele a faixa é UMA janela contínua do início ao fim */}
            <label className="flex items-center gap-1 text-body-sm"><input type="checkbox" checked={horaPorDia} onChange={(e) => setHoraPorDia(e.target.checked)} /> A faixa em cada dia</label>
          </>
        )}
        <Button label="&Processar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <small className="w-full text-fg-muted">
          Sem marcar «a faixa em cada dia», o filtro de hora é <b>uma janela contínua</b> do início ao fim do
          período — é o comportamento do legado. O ticket médio do período é o total dividido pelos cupons.
        </small>
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {[
            { rot: 'Ticket médio do período', val: brl(totais.media), ac: true },
            { rot: 'Cupons', val: int(totais.cupons) },
            { rot: 'Total vendido', val: brl(totais.total_venda) },
            { rot: 'Dias', val: int(totais.dias) },
          ].map((k) => (
            <div key={k.rot} className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.rot}</div>
              <div className={`text-title-sm font-bold tabular-nums ${k.ac ? 'text-accent' : ''}`}>{k.val}</div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Dia</th><th className="p-pad-xs">Empresa</th>
              <th className="p-pad-xs text-right">Cupons</th>
              <th className="p-pad-xs text-right">Total vendido</th>
              <th className="p-pad-xs text-right">Ticket médio</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={`${l.dia}-${l.empresa ?? ''}`} className="border-t border-border">
                <td className="p-pad-xs tabular-nums">{dia(l.dia)}</td>
                <td className="p-pad-xs text-fg-muted">{l.empresa ?? '—'}</td>
                <td className="p-pad-xs text-right tabular-nums">{int(l.cupons)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(l.total_venda)}</td>
                {/* média nula = dia sem cupom identificado; em branco, nunca zero */}
                <td className="p-pad-xs text-right tabular-nums font-semibold">{brl(l.media)}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={5} className="p-pad-md text-fg-muted">Informe o período e clique em Processar.</td></tr>}
          </tbody>
          {totais && linhas.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="p-pad-xs">TOTAL</td><td />
                <td className="p-pad-xs text-right tabular-nums">{int(totais.cupons)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(totais.total_venda)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(totais.media)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
