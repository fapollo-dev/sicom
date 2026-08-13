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
const n2 = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

interface Hora { hora: number; total_venda: number; quantidade: number; dias: number; media_quantidade: number }
interface Det { horario: string; total_venda: number }
interface Totais {
  total_venda: number; horas_com_venda: number; pico_hora: number | null; pico_valor: number | null;
  dias_no_periodo: number; caixas_no_pico: number | null;
}

/**
 * VENDAS POR HORA (rel 07 do hub de Vendas) — o perfil do dia: quanto se vendeu em cada hora e quantos caixas
 * estavam abertos nela. As duas leituras juntas é o que responde «tinha caixa suficiente no pico?».
 */
export function RelVendasHoraPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [detalhe, setDetalhe] = useState(false);
  const [horas, setHoras] = useState<Hora[]>([]);
  const [det, setDet] = useState<Det[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ horas: Hora[]; detalhe: Det[]; totais: Totais }>(
        '/relatorios/vendas-hora/consultar', { dtini, dtfim, detalhe },
      );
      setHoras(r.horas); setDet(r.detalhe); setTotais(r.totais);
      if (!r.horas.length) mensagem.sucesso('Não há venda no período informado.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const maxVenda = Math.max(1, ...horas.map((h) => Number(h.total_venda) || 0));
  const maxCaixas = Math.max(1, ...horas.map((h) => Number(h.quantidade) || 0));

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Vendas por hora" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <label className="flex items-center gap-gp-xs pb-pad-xs text-body-sm">
          <input type="checkbox" checked={detalhe} onChange={(e) => setDetalhe(e.target.checked)} />
          Detalhar por &horário exato
        </label>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <small className="w-full text-fg-muted">
          É o <b>perfil</b> do dia: num período de vários dias as horas <b>somam</b> entre os dias (não é uma
          série temporal). «Caixas» conta as sessões de caixa abertas naquela hora; a média divide pelos dias em
          que havia caixa aberto nela.
        </small>
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {[
            { rot: 'Faturamento', val: brl(totais.total_venda), ac: true },
            { rot: 'Hora de pico', val: totais.pico_hora == null ? '—' : `${String(totais.pico_hora).padStart(2, '0')}h` },
            { rot: 'Faturamento no pico', val: brl(totais.pico_valor) },
            { rot: 'Caixas no pico', val: totais.caixas_no_pico == null ? '—' : String(totais.caixas_no_pico) },
            { rot: 'Dias no período', val: String(totais.dias_no_periodo) },
          ].map((k) => (
            <div key={k.rot} className="flex-1 min-w-32 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.rot}</div>
              <div className={`text-title-sm font-bold tabular-nums ${(k as any).ac ? 'text-accent' : ''}`}>{k.val}</div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Hora</th>
              <th className="p-pad-xs text-right">Faturamento</th>
              <th className="p-pad-xs w-1/3">Perfil</th>
              <th className="p-pad-xs text-right">Caixas</th><th className="p-pad-xs text-right">Dias</th>
              <th className="p-pad-xs text-right">Média de caixas</th>
            </tr>
          </thead>
          <tbody>
            {horas.map((h) => (
              <tr key={h.hora} className={`border-t border-border ${totais?.pico_hora === h.hora ? 'bg-bg-subtle' : ''}`}>
                <td className="p-pad-xs tabular-nums font-semibold">{String(h.hora).padStart(2, '0')}h</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(h.total_venda)}</td>
                {/* barra dupla: faturamento (accent) e caixas abertos (traço) — mesma leitura do gráfico do legado */}
                <td className="p-pad-xs">
                  <div className="h-2 rounded-radius-sm bg-accent" style={{ width: `${(Number(h.total_venda) / maxVenda) * 100}%` }} />
                  <div className="mt-0.5 h-1 rounded-radius-sm bg-fg-muted" style={{ width: `${(Number(h.quantidade) / maxCaixas) * 100}%` }} />
                </td>
                <td className="p-pad-xs text-right tabular-nums">{h.quantidade || '—'}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{h.dias || '—'}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{h.dias ? n2(h.media_quantidade) : '—'}</td>
              </tr>
            ))}
            {!horas.length && <tr><td colSpan={6} className="p-pad-md text-fg-muted">Informe o período e consulte.</td></tr>}
          </tbody>
        </table>
      </div>

      {!!det.length && (
        <>
          <div className="text-body-sm font-semibold">Detalhe por horário exato ({det.length} horários)</div>
          <div className="max-h-96 overflow-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full text-body-sm">
              <tbody>
                {det.map((d) => (
                  <tr key={d.horario} className="border-t border-border">
                    <td className="p-pad-xs tabular-nums">{d.horario}</td>
                    <td className="p-pad-xs text-right tabular-nums">{brl(d.total_venda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
