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
const q3 = (v: unknown) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const brl = (v: unknown) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

type Linha = Record<string, unknown>;
/** a análise persistida que a pendência APN/RPN aponta (corte-2a — o AbreAnalise do form). */
interface Analise {
  cabecalho: Record<string, unknown>;
  pedidos: Record<string, unknown>[];
  notas: Record<string, unknown>[];
  divergencias: Record<string, unknown>[];
  inexistentes_nf: Record<string, unknown>[];
  inexistentes_pc: Record<string, unknown>[];
}

/**
 * PENDÊNCIAS DO OPERADOR — a fila de trabalho: o que ficou pendente para cada operador (análise de
 * pedido × NF, refazer análise, conferência), com finalizar/reabrir, observação e a ANÁLISE vinculada
 * (corte-2a): a linha APN/RPN abre o detalhe — pedidos, notas do manifesto, divergências e itens fora.
 */
export function PendenciasPage() {
  const mensagem = useMensagem();
  const [status, setStatus] = useState('A');
  const [tipo, setTipo] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Record<string, unknown> | null>(null);
  const [analise, setAnalise] = useState<Analise | null>(null);
  // supervisor do E8: a fila traz pendências de TERCEIROS, então a coluna "Operador" aparece (como no grid legado)
  const [supervisor, setSupervisor] = useState(false);
  const [busy, setBusy] = useState(false);

  const [abrindo, setAbrindo] = useState(false);
  const abrirAnalise = async (l: Linha) => {
    if (abrindo) return; // sem guard, 2 cliques rápidos deixavam no painel a resposta que chegasse por último
    setAbrindo(true);
    try {
      const r = await post<Analise>('/compras/pendencias/analise', { apn_id: Number(l.po_complemento) });
      setAnalise(r);
    } catch (e) { mensagem.erro(e); } finally { setAbrindo(false); }
  };

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await post<{ linhas: Linha[]; totais: Record<string, unknown>; filtro: Record<string, unknown> }>('/compras/pendencias/listar', {
        status: status || undefined, tipo: tipo || undefined,
      });
      setLinhas(r.linhas); setTotais(r.totais);
      setSupervisor(Boolean(r.filtro?.supervisor));
      setAnalise(null); // o detalhe aberto não pertence mais à lista que está na tela
      if (!r.linhas.length) mensagem.sucesso('Nenhuma pendência no filtro.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const mudarStatus = async (l: Linha, finalizar: boolean) => {
    const obs = finalizar ? window.prompt('Observação (opcional):') ?? undefined : undefined;
    try {
      await post('/compras/pendencias/status', { po_id: l.po_id, finalizar, observacao: obs || undefined });
      mensagem.sucesso(finalizar ? 'Pendência finalizada.' : 'Pendência reaberta.');
      setAnalise(null);
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
              {supervisor && <th className="p-pad-xs">Operador</th>}
              <th className="p-pad-xs">Fornecedor</th><th className="p-pad-xs">Status</th>
              <th className="p-pad-xs">Observação</th><th className="p-pad-xs">Criada por</th>
              <th className="p-pad-xs">Ações</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={String(l.po_id)} className="border-t border-border">
                <td className="p-pad-xs tabular-nums">{dia(l.po_data)}</td>
                {/* fora de APN/RPN e A/F o CASE do legado devolve NULL — aqui cai no código cru p/ não ficar vazio */}
                <td className="p-pad-xs">{String(l.tipo_str ?? l.po_tipo_pendencia_operador ?? '')}</td>
                {supervisor && <td className="p-pad-xs">{String(l.nome ?? '—')}</td>}
                <td className="p-pad-xs">{String(l.fornecedor || '—')}</td>
                <td className={`p-pad-xs font-semibold ${l.po_status === 'A' ? 'text-danger' : ''}`}>{String(l.status_str ?? l.po_status ?? '')}</td>
                <td className="p-pad-xs text-fg-muted">{String(l.po_observacao ?? '')}</td>
                <td className="p-pad-xs text-fg-muted">{String(l.nome_origem ?? '—')}</td>
                <td className="p-pad-xs">
                  {/* só APN: numa RPN o legado NÃO abre a análise antiga — gera uma NOVA (GeraNovaAnalise), que é corte-2b */}
                  {String(l.po_tipo_pendencia_operador) === 'APN' && /^\d{1,9}$/.test(String(l.po_complemento ?? '')) && (
                    <><button className="underline" disabled={abrindo} onClick={() => void abrirAnalise(l)}>abrir análise</button>{' · '}</>
                  )}
                  {l.po_status === 'A'
                    ? <button className="underline" onClick={() => void mudarStatus(l, true)}>finalizar</button>
                    : <button className="underline" onClick={() => void mudarStatus(l, false)}>reabrir</button>}
                </td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={supervisor ? 8 : 7} className="p-pad-md text-fg-muted">Clique em Atualizar para carregar a fila.</td></tr>}
          </tbody>
        </table>
      </div>

      {analise && (
        <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="flex items-center justify-between">
            <div className="text-title-sm font-semibold">
              Análise #{String(analise.cabecalho.apn_id)} — {dia(analise.cabecalho.apn_data_analise)}
              <span className="ml-2 text-body-sm text-fg-muted">
                {String(analise.cabecalho.operador ?? '')} · status {String(analise.cabecalho.apn_status ?? '—')}
                {analise.cabecalho.apn_status_finalizacao ? ` · finalização ${String(analise.cabecalho.apn_status_finalizacao)}` : ''}
                {analise.cabecalho.apn_diferenca_valor != null ? ` · diferença ${brl(analise.cabecalho.apn_diferenca_valor)}` : ''}
              </span>
            </div>
            <button className="underline text-body-sm" onClick={() => setAnalise(null)}>fechar</button>
          </div>
          <div className="grid gap-gp-sm md:grid-cols-2">
            <div>
              <div className="text-body-xs font-semibold text-fg-muted">Pedidos ({analise.pedidos.length})</div>
              {analise.pedidos.map((p) => (
                <div key={String(p.codpedcomp)} className="text-body-sm tabular-nums">#{String(p.codpedcomp)} · {String(p.fornecedor ?? '—')} · {dia(p.data)}</div>
              ))}
            </div>
            <div>
              <div className="text-body-xs font-semibold text-fg-muted">Notas do manifesto ({analise.notas.length})</div>
              {analise.notas.map((n, i) => (
                <div key={i} className="text-body-sm tabular-nums">NF {String(n.nronf ?? n.apnn_ref_nf)} · {String(n.razao ?? '—')} · {brl(n.totalnf)}</div>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="text-body-xs font-semibold text-fg-muted">Divergências ({analise.divergencias.length})</div>
            {analise.divergencias.length > 0 && (
              <table className="w-full text-body-sm">
                <thead><tr className="text-left text-fg-muted">
                  <th className="p-pad-xs">Produto</th><th className="p-pad-xs text-right">Qtde NF</th>
                  <th className="p-pad-xs text-right">Qtde Pedido</th><th className="p-pad-xs text-right">Valor NF</th>
                  <th className="p-pad-xs text-right">Valor Pedido</th><th className="p-pad-xs">NF</th>
                </tr></thead>
                <tbody>
                  {analise.divergencias.map((d, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-pad-xs">{String(d.descricao ?? d.idproduto)}<br /><span className="text-fg-muted">{String(d.codbarra ?? '')} · {String(d.unidade ?? '')}</span></td>
                      <td className="p-pad-xs text-right tabular-nums">{q3(d.apnd_quantidade_nf)}</td>
                      <td className="p-pad-xs text-right tabular-nums">{q3(d.apnd_quantidade_pc)}</td>
                      <td className="p-pad-xs text-right tabular-nums">{brl(d.apnd_valor_nf)}</td>
                      <td className="p-pad-xs text-right tabular-nums">{brl(d.apnd_valor_pc)}</td>
                      <td className="p-pad-xs text-fg-muted tabular-nums">{String(d.nronf ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="grid gap-gp-sm md:grid-cols-2">
            <div>
              <div className="text-body-xs font-semibold text-fg-muted">Na NF e fora do pedido ({analise.inexistentes_nf.length})</div>
              {analise.inexistentes_nf.map((x, i) => (
                <div key={i} className="text-body-sm tabular-nums">{String(x.descricao ?? x.idproduto)} · {q3(x.apnin_quantidade)} {String(x.unidade ?? 'un')} · {brl(x.apnin_valor)}</div>
              ))}
            </div>
            <div>
              <div className="text-body-xs font-semibold text-fg-muted">No pedido e fora da NF ({analise.inexistentes_pc.length})</div>
              {analise.inexistentes_pc.map((x, i) => (
                <div key={i} className="text-body-sm tabular-nums">{String(x.descricao ?? x.idproduto)} · {q3(x.apnip_quantidade)} {String(x.unidade ?? 'un')} · {brl(x.apnip_valor)}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
