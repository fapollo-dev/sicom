import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * A ESTEIRA DA NOTA — as dez etapas do manifesto à devolução (mig 292).
 *
 * A etapa pendente não tem data, e a tela mostra isso como "não aconteceu" em vez de um traço vazio —
 * é o estado da esteira, não ausência de dado.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Etapa = {
  ordem: number; processo: string; descricao: string | null; status: string;
  realizada: boolean; dataprocesso: string | null; operador: string | null;
};
type Esteira = {
  chavenfe: string; codnf: number | null; nronf: string | null; virou_nf: boolean;
  concluidas: number; total: number;
  parada_em: { ordem: number; processo: string; descricao: string | null } | null;
  etapas: Etapa[];
};
type Painel = {
  paradas: Array<{ ordem: number; processo: string; descricao: string | null; notas: number }>;
  total_paradas: number;
};

const quando = (d: string | null) =>
  (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null);

export function NfEsteiraPage() {
  const mensagem = useMensagem();
  const [chave, setChave] = useState('');
  const [esteira, setEsteira] = useState<Esteira | null>(null);
  const [painel, setPainel] = useState<Painel | null>(null);

  const pedir = async <T,>(url: string): Promise<T> => {
    const r = await fetch(url, { headers: apiHeaders() });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      throw Object.assign(new Error(env.code), { envelope: env });
    }
    return (await r.json()) as T;
  };
  const carregarPainel = async () => {
    try { setPainel(await pedir<Painel>(`${BASE}/cadastro/nf-esteira?paradas=true`)); }
    catch (e) { mensagem.erro(e); }
  };
  const buscar = async () => {
    if (chave.trim().length !== 44) { mensagem.erro(new Error('A chave da NF-e tem 44 dígitos.')); return; }
    try { setEsteira(await pedir<Esteira>(`${BASE}/cadastro/nf-esteira?chavenfe=${chave.trim()}`)); }
    catch (e) { mensagem.erro(e); }
  };
  useEffect(() => { void carregarPainel(); }, []);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Esteira da nota" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          As dez etapas por que uma nota passa, do manifesto à devolução. A esteira começa quando a nota é
          manifestada, <strong>antes de ela existir no sistema</strong> — por isso a busca é pela chave de
          acesso, e notas que nunca viraram NF também têm esteira.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-[30rem]">
            <Field label="&Chave de acesso (44 dígitos)" value={chave} maxLength={44}
              onChange={(e) => setChave(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }} />
          </div>
          <Button label="&Consultar" onClick={() => void buscar()} />
        </div>
      </section>

      {esteira && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="mb-form-gap flex flex-wrap items-center gap-gp-md text-body-sm">
            <span><strong>{esteira.concluidas}</strong> de {esteira.total} etapas concluídas</span>
            {esteira.virou_nf
              ? <span className="text-fg-muted">nota {esteira.nronf ?? esteira.codnf}</span>
              : <span className="text-fg-muted">manifestada, ainda não virou nota no sistema</span>}
            {esteira.parada_em && (
              <span className="font-semibold text-fg-danger">
                parada em: {esteira.parada_em.descricao ?? esteira.parada_em.processo}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">#</th><th className="p-pad-xs">Etapa</th>
                <th className="p-pad-xs">Situação</th><th className="p-pad-xs">Quando</th>
                <th className="p-pad-xs">Operador</th>
              </tr></thead>
              <tbody>{esteira.etapas.map((e) => (
                <tr key={e.ordem} className={`border-b border-border ${!e.realizada && esteira.parada_em?.ordem === e.ordem ? 'bg-bg-muted' : ''}`}>
                  <td className="p-pad-xs tabular-nums">{e.ordem}</td>
                  <td className="p-pad-xs">{e.descricao ?? e.processo}</td>
                  <td className={`p-pad-xs ${e.realizada ? '' : 'text-fg-muted'}`}>
                    {e.realizada ? 'realizada' : 'não aconteceu'}
                  </td>
                  <td className="p-pad-xs tabular-nums text-fg-muted">{quando(e.dataprocesso) ?? ''}</td>
                  <td className="p-pad-xs text-fg-muted">{e.operador ?? ''}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      )}

      {painel && painel.paradas.length > 0 && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h4 className="mb-form-gap text-body-sm font-semibold">
            Onde as notas estão paradas — {painel.total_paradas.toLocaleString('pt-BR')} no total
          </h4>
          <p className="mb-form-gap text-body-sm text-fg-muted">
            Cada nota conta uma vez só, na <strong>primeira</strong> etapa pendente: as seguintes estão
            pendentes por consequência, e somá-las contaria a mesma nota várias vezes.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">#</th><th className="p-pad-xs">Etapa</th>
                <th className="p-pad-xs text-right">Notas paradas</th>
              </tr></thead>
              <tbody>{painel.paradas.map((p) => (
                <tr key={p.ordem} className="border-b border-border">
                  <td className="p-pad-xs tabular-nums">{p.ordem}</td>
                  <td className="p-pad-xs">{p.descricao ?? p.processo}</td>
                  <td className="p-pad-xs text-right tabular-nums font-semibold">{p.notas.toLocaleString('pt-BR')}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
