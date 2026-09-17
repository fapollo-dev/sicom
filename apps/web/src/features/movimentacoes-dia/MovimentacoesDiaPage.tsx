import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * MOVIMENTAÇÕES DO DIA (`FRMMOVIMENTACOESDIA`).
 * Dossiê: `uMovimentacoesDia.md`.
 *
 * O que aconteceu no período e **quem fez**: pedidos, contas pagas, contas recebidas e o log de histórico.
 * O filtro de operador vale nos quatro blocos ao mesmo tempo — é o "o que fulano fez hoje".
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const horaBr = (v: unknown) => (v == null ? '' : String(v).slice(11, 16));
const hoje = () => new Date().toISOString().slice(0, 10);

interface Resultado {
  recebidos: Array<Record<string, unknown>>;
  pagos: Array<Record<string, unknown>>;
  pedidos: Array<Record<string, unknown>>;
  historico: Array<Record<string, unknown>>;
  totais: {
    recebidos: { itens: number; valor: number }; pagos: { itens: number; valor: number };
    pedidos: { itens: number; valor: number }; historico: { itens: number };
  };
}

const ABAS = [
  { k: 'pedidos', rotulo: 'Pedidos' },
  { k: 'pagos', rotulo: 'Contas pagas' },
  { k: 'recebidos', rotulo: 'Contas recebidas' },
  { k: 'historico', rotulo: 'Históricos' },
] as const;

export function MovimentacoesDiaPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: hoje(), dataFim: hoje(), codoperador: '' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [aba, setAba] = useState<string>('pedidos');
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim });
      if (f.codoperador) q.set('codoperador', f.codoperador);
      const r = await fetch(`${BASE}/relatorios/movimentacoes-dia?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const linhas = (res?.[aba as 'pedidos'] ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Movimentações do dia" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          O que aconteceu no período e <strong>quem fez</strong>. Informando o operador, os quatro blocos
          passam a mostrar só o que ele movimentou.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-36"><Field label="&Operador" value={f.codoperador} onChange={(e) => setF({ ...f, codoperador: e.target.value })} /></div>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void buscar()} />
        </div>
      </section>

      {res && (
        <>
          <div className="flex flex-wrap gap-gp-xs">
            {ABAS.map((a) => {
              const t = res.totais[a.k as 'pedidos'];
              return (
                <button key={a.k} type="button" onClick={() => setAba(a.k)}
                  className={`rounded-radius-sm border px-pad-sm py-pad-xs text-body-sm ${a.k === aba ? 'border-border bg-bg-subtle font-semibold' : 'border-transparent text-fg-muted hover:bg-bg-subtle'}`}>
                  {a.rotulo} · {t.itens}
                  {'valor' in t ? <span className="ml-gp-xs tabular-nums">{moeda((t as { valor: number }).valor)}</span> : null}
                </button>
              );
            })}
          </div>

          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full min-w-[820px] border-collapse text-body-sm">
              <thead>
                {aba === 'historico' ? (
                  <tr className="border-b border-border text-left text-fg-muted">
                    <th className="p-pad-xs">Data</th><th className="p-pad-xs">Hora</th>
                    <th className="p-pad-xs">Tabela</th><th className="p-pad-xs">Documento</th>
                    <th className="p-pad-xs">Histórico</th><th className="p-pad-xs">Operador</th>
                  </tr>
                ) : aba === 'pedidos' ? (
                  <tr className="border-b border-border text-left text-fg-muted">
                    <th className="p-pad-xs">Pedido</th><th className="p-pad-xs">Data</th>
                    <th className="p-pad-xs">Cliente</th><th className="p-pad-xs">Itens</th>
                    <th className="p-pad-xs">Valor</th><th className="p-pad-xs">Operador</th>
                  </tr>
                ) : (
                  <tr className="border-b border-border text-left text-fg-muted">
                    <th className="p-pad-xs">Pagamento</th><th className="p-pad-xs">{aba === 'pagos' ? 'Fornecedor' : 'Cliente'}</th>
                    <th className="p-pad-xs">Vencimento</th><th className="p-pad-xs">Documento</th>
                    <th className="p-pad-xs">Pago</th><th className="p-pad-xs">Histórico</th>
                    <th className="p-pad-xs">Operador</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i} className="border-b border-border">
                    {aba === 'historico' ? (
                      <>
                        <td className="p-pad-xs">{dataBr(l.data)}</td>
                        <td className="p-pad-xs">{horaBr(l.data)}</td>
                        <td className="p-pad-xs">{String(l.tabela ?? '')}</td>
                        <td className="p-pad-xs">{String(l.coddoc ?? '')}</td>
                        <td className="p-pad-xs">{String(l.historico ?? '')}</td>
                        <td className="p-pad-xs">{String(l.nome ?? '')}</td>
                      </>
                    ) : aba === 'pedidos' ? (
                      <>
                        <td className="p-pad-xs">{String(l.nropedido ?? '')}</td>
                        <td className="p-pad-xs">{dataBr(l.data)}</td>
                        <td className="p-pad-xs">{String(l.cliente ?? '')}</td>
                        <td className="p-pad-xs tabular-nums">{String(l.itens ?? '')}</td>
                        <td className="p-pad-xs tabular-nums">{moeda(l.valor)}</td>
                        <td className="p-pad-xs">{String(l.operador ?? '')}</td>
                      </>
                    ) : (
                      <>
                        <td className="p-pad-xs">{dataBr(l.data_pagamento)}</td>
                        <td className="p-pad-xs">{String(l.fornecedor ?? l.cliente ?? '')}</td>
                        <td className="p-pad-xs">{dataBr(l.data_venceu)}</td>
                        <td className="p-pad-xs tabular-nums">{moeda(l.valor_documento)}</td>
                        <td className="p-pad-xs tabular-nums font-semibold">{moeda(l.valor_pago)}</td>
                        <td className="p-pad-xs">{String(l.historico ?? '')}</td>
                        <td className="p-pad-xs">{String(l.operador_baixa ?? '')}</td>
                      </>
                    )}
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
