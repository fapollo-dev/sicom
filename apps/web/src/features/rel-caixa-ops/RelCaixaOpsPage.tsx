import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
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

type Linha = Record<string, unknown>;

/**
 * OPERAÇÕES DE CAIXA (rel 04/05 do hub de Vendas) — sangrias & suprimentos e o histórico de liberações do PDV.
 */
export function RelCaixaOpsPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [modo, setModo] = useState('sangrias');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ linhas: Linha[]; totais: Record<string, unknown> }>(
        `/relatorios/caixa-ops/${modo}`, { dtini, dtfim },
      );
      setLinhas(r.linhas); setTotais(r.totais);
      if (!r.linhas.length) mensagem.sucesso('Nenhum registro no período informado.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Operações de caixa" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-72"><SelectField label="&Relatório" value={modo} onChange={(v) => { setModo(v); setLinhas([]); setTotais(null); }} options={[
          { value: 'sangrias', label: 'Sangrias e suprimentos (rel 04)' },
          { value: 'liberacoes', label: 'Histórico de liberações do PDV (rel 05)' },
        ]} /></div>
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
      </div>

      {totais && modo === 'sangrias' && (
        <div className="flex flex-wrap gap-gp-sm">
          <div className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
            <div className="text-body-xs text-fg-muted">Sangrias</div>
            <div className="text-title-sm font-bold tabular-nums text-danger">{brl(totais.sangrias)}</div>
          </div>
          <div className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
            <div className="text-body-xs text-fg-muted">Suprimentos</div>
            <div className="text-title-sm font-bold tabular-nums text-accent">{brl(totais.suprimentos)}</div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            {modo === 'sangrias' ? (
              <tr className="text-left text-fg-muted">
                <th className="p-pad-xs">Data</th><th className="p-pad-xs">Hora</th>
                <th className="p-pad-xs">PDV</th><th className="p-pad-xs">Operador</th>
                <th className="p-pad-xs">Operação</th><th className="p-pad-xs">Descrição</th>
                <th className="p-pad-xs text-right">Sangria</th><th className="p-pad-xs text-right">Suprimento</th>
              </tr>
            ) : (
              <tr className="text-left text-fg-muted">
                <th className="p-pad-xs">Data</th><th className="p-pad-xs">Hora</th>
                <th className="p-pad-xs">PDV</th><th className="p-pad-xs">Histórico</th>
                <th className="p-pad-xs">Responsável</th><th className="p-pad-xs">Usuário</th>
                <th className="p-pad-xs text-right">Cupom</th><th className="p-pad-xs">Motivo</th>
              </tr>
            )}
          </thead>
          <tbody>
            {linhas.map((l, i) => modo === 'sangrias' ? (
              <tr key={i} className="border-t border-border">
                <td className="p-pad-xs tabular-nums">{dia(l.data)}</td>
                <td className="p-pad-xs tabular-nums text-fg-muted">{String(l.hora ?? '—')}</td>
                <td className="p-pad-xs">{String(l.descricao_pdv ?? l.nropdv ?? '—')}</td>
                <td className="p-pad-xs">{String(l.usuario ?? '—')}</td>
                <td className={`p-pad-xs font-semibold ${l.operacao === 'SANGRIA' ? 'text-danger' : 'text-accent'}`}>{String(l.operacao)}</td>
                <td className="p-pad-xs text-fg-muted">{String(l.descricao_hist ?? '')}</td>
                <td className="p-pad-xs text-right tabular-nums">{Number(l.sangrias) ? brl(l.sangrias) : '—'}</td>
                <td className="p-pad-xs text-right tabular-nums">{Number(l.suprimentos) ? brl(l.suprimentos) : '—'}</td>
              </tr>
            ) : (
              <tr key={i} className="border-t border-border">
                <td className="p-pad-xs tabular-nums">{dia(l.data)}</td>
                <td className="p-pad-xs tabular-nums text-fg-muted">{String(l.hora ?? '—')}</td>
                <td className="p-pad-xs tabular-nums">{String(l.codecf ?? '—')}</td>
                <td className="p-pad-xs">{String(l.historico ?? '—')}</td>
                <td className="p-pad-xs font-semibold">{String(l.responsavel ?? '—')}</td>
                <td className="p-pad-xs text-fg-muted">{String(l.usuario ?? '—')}</td>
                <td className="p-pad-xs text-right tabular-nums">{String(l.nrocupom ?? '—')}</td>
                <td className="p-pad-xs text-fg-muted">{String(l.motivo ?? '')}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={8} className="p-pad-md text-fg-muted">Informe o período e consulte.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
