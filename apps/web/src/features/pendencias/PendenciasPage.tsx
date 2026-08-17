import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
  handle401(res);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: res.status, code: 'ERRO', message: (b as any)?.message ?? res.statusText };
    throw Object.assign(new Error(env.code ?? res.statusText), { envelope: env, status: res.status, body: b });
  }
  return (await res.json()) as T;
}

const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

type Linha = Record<string, unknown>;

/**
 * PENDÊNCIAS DO OPERADOR — a fila de trabalho: o que ficou pendente para cada operador (análise de
 * pedido × NF, refazer análise, conferência), com finalizar/reabrir e observação.
 */
export function PendenciasPage() {
  const mensagem = useMensagem();
  const [status, setStatus] = useState('A');
  const [tipo, setTipo] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await post<{ linhas: Linha[]; totais: Record<string, unknown> }>('/compras/pendencias/listar', {
        status: status || undefined, tipo: tipo || undefined,
      });
      setLinhas(r.linhas); setTotais(r.totais);
      if (!r.linhas.length) mensagem.sucesso('Nenhuma pendência no filtro.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const mudarStatus = async (l: Linha, finalizar: boolean) => {
    const obs = finalizar ? window.prompt('Observação (opcional):') ?? undefined : undefined;
    try {
      await post('/compras/pendencias/status', { po_id: l.po_id, finalizar, observacao: obs || undefined });
      mensagem.sucesso(finalizar ? 'Pendência finalizada.' : 'Pendência reaberta.');
      void consultar();
    } catch (e) { mensagem.erro(e); }
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Pendências do operador" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><SelectField label="&Status" value={status} onChange={setStatus} options={[
          { value: 'A', label: 'Abertas' }, { value: 'F', label: 'Finalizadas' }, { value: '', label: 'Todas' },
        ]} /></div>
        <div className="w-72"><SelectField label="&Tipo" value={tipo} onChange={setTipo} options={[
          { value: '', label: 'Todos' },
          { value: 'APN', label: 'Análise de pedido x Nota fiscal' },
          { value: 'RPN', label: 'Refazer análise de pedido x NF' },
          { value: 'CFN', label: 'Conferência (CFN)' },
        ]} /></div>
        <Button label="&Atualizar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <small className="w-full text-fg-muted">Sua fila de trabalho: o que ficou pendente para você resolver.</small>
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          <div className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
            <div className="text-body-xs text-fg-muted">Pendências abertas</div>
            <div className={`text-title-sm font-bold tabular-nums ${Number(totais.abertas) > 0 ? 'text-danger' : ''}`}>{String(totais.abertas)}</div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Data</th><th className="p-pad-xs">Tipo</th>
              <th className="p-pad-xs">Fornecedor</th><th className="p-pad-xs">Status</th>
              <th className="p-pad-xs">Observação</th><th className="p-pad-xs">Criada por</th>
              <th className="p-pad-xs">Ações</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={String(l.po_id)} className="border-t border-border">
                <td className="p-pad-xs tabular-nums">{dia(l.po_data)}</td>
                <td className="p-pad-xs">{String(l.tipo_str)}</td>
                <td className="p-pad-xs">{String(l.fornecedor ?? '—')}</td>
                <td className={`p-pad-xs font-semibold ${l.po_status === 'A' ? 'text-danger' : ''}`}>{String(l.status_str)}</td>
                <td className="p-pad-xs text-fg-muted">{String(l.po_observacao ?? '')}</td>
                <td className="p-pad-xs text-fg-muted">{String(l.nome_origem ?? '—')}</td>
                <td className="p-pad-xs">
                  {l.po_status === 'A'
                    ? <button className="underline" onClick={() => void mudarStatus(l, true)}>finalizar</button>
                    : <button className="underline" onClick={() => void mudarStatus(l, false)}>reabrir</button>}
                </td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={7} className="p-pad-md text-fg-muted">Clique em Atualizar para carregar a fila.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
