import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { CAMPOS_CONFIG_IC, isErroResposta, type ErroResposta } from '@apollo/shared';
import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CONFIGURAÇÃO DA INTEGRAÇÃO CONTÁBIL (`FRMCONFIGINTEGRACAOCONTABIL`).
 * Dossiê: `uTron-integracao-contabil.md` §9.
 *
 * Para cada evento do sistema, qual **situação** o razão usa. As abas e os rótulos são os do legado.
 *
 * ⚠️ o que a tela acrescenta é o aviso: apontar para uma situação **sem as duas pernas** cadastradas é o erro
 * que só aparece muito depois, na hora de contabilizar, longe de quem configurou. Aqui ele aparece agora.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/contabil/config-integracao';

interface Situacao { idsituacao_nf: number; descricao: string; debito: number; credito: number }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: res.statusText };
    throw Object.assign(new Error(env.code), { envelope: env });
  }
  return (await res.json()) as T;
}

export function ConfigIntegracaoContabilPage() {
  const mensagem = useMensagem();
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [situacoes, setSituacoes] = useState<Situacao[]>([]);
  const [semPernas, setSemPernas] = useState<string[]>([]);
  const [mudou, setMudou] = useState<Record<string, number | string | null>>({});
  const [aba, setAba] = useState('Vendas e fechamento de caixa');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await req<{ config: Record<string, unknown>; situacoes: Situacao[]; semPernas: string[] }>(P);
      setConfig(r.config ?? {}); setSituacoes(r.situacoes ?? []); setSemPernas(r.semPernas ?? []); setMudou({});
    } catch (e) { mensagem.erro(e); }
  }, [mensagem]);

  useEffect(() => { void carregar(); }, [carregar]);

  const abas = useMemo(() => [...new Set(CAMPOS_CONFIG_IC.map((c) => c.grupo))], []);
  const daAba = CAMPOS_CONFIG_IC.filter((c) => c.grupo === aba);
  const subs = [...new Set(daAba.map((c) => c.sub ?? ''))];

  const valor = (campo: string) => {
    const v = campo in mudou ? mudou[campo] : config[campo];
    return v == null ? '' : String(v);
  };

  const salvar = async () => {
    if (!Object.keys(mudou).length) return;
    setOcupado(true);
    try {
      await req(P, { method: 'PUT', body: JSON.stringify(mudou) });
      mensagem.sucesso('Configuração gravada.');
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const Linha = ({ campo, label }: { campo: string; label: string }) => {
    const v = valor(campo);
    const sit = situacoes.find((s) => String(s.idsituacao_nf) === v);
    const incompleta = !!sit && (Number(sit.debito) === 0 || Number(sit.credito) === 0);
    return (
      <div className="flex flex-wrap items-center gap-gp-sm border-b border-border py-pad-xs">
        <span className="w-72 text-body-sm">{label}</span>
        <select
          className="h-9 min-w-72 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
          value={v}
          onChange={(e) => setMudou({ ...mudou, [campo]: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">— não contabiliza —</option>
          {situacoes.map((s) => (
            <option key={s.idsituacao_nf} value={s.idsituacao_nf}>
              {s.idsituacao_nf} · {s.descricao}
              {Number(s.debito) === 0 || Number(s.credito) === 0 ? ' (sem as duas pernas)' : ''}
            </option>
          ))}
        </select>
        {incompleta && <span className="text-body-sm text-fg-danger">falta a perna de {Number(sit!.debito) === 0 ? 'débito' : 'crédito'}</span>}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Configuração da integração contábil" />

      {semPernas.length > 0 && (
        <div className="rounded-radius-sm border border-border bg-bg-subtle p-pad-sm text-body-sm text-fg-danger">
          <strong>{semPernas.length} evento(s)</strong> apontam para uma situação sem as duas pernas em
          <code> itens_integracao_contabil</code>. Contabilizar esses eventos vai falhar.
        </div>
      )}

      <div className="flex flex-wrap gap-gp-xs">
        {abas.map((a) => (
          <button key={a} type="button" onClick={() => setAba(a)}
            className={`rounded-radius-sm border px-pad-sm py-pad-xs text-body-sm ${a === aba ? 'border-border bg-bg-subtle font-semibold' : 'border-transparent text-fg-muted hover:bg-bg-subtle'}`}>
            {a}
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        {subs.map((sub) => (
          <div key={sub}>
            {sub && <h3 className="mb-gp-xs mt-gp-sm text-title-sm">{sub}</h3>}
            {daAba.filter((c) => (c.sub ?? '') === sub).map((c) => (
              <Linha key={c.campo} campo={c.campo} label={c.label} />
            ))}
          </div>
        ))}

        {aba === 'Movimentações bancárias' && (
          <div className="mt-gp-md w-64">
            <Field
              label="Fechar período a&té"
              type="date"
              value={valor('chaveamento_periodo').slice(0, 10)}
              onChange={(e) => setMudou({ ...mudou, chaveamento_periodo: e.target.value || null })}
            />
            <p className="mt-gp-xs text-body-sm text-fg-muted">
              A integração só aceita período cuja data final seja <strong>posterior</strong> a esta. No cliente
              está vazio, e por isso hoje não bloqueia nada.
            </p>
          </div>
        )}
      </section>

      <div className="flex gap-gp-sm">
        <Button label="&Gravar" disabled={ocupado || !Object.keys(mudou).length} onClick={() => void salvar()} />
        <Button variant="outline" label="&Desfazer" disabled={!Object.keys(mudou).length} onClick={() => setMudou({})} />
        <span className="self-center text-body-sm text-fg-muted">
          {Object.keys(mudou).length ? `${Object.keys(mudou).length} campo(s) alterado(s)` : 'nenhuma alteração pendente'}
        </span>
      </div>
    </div>
  );
}
