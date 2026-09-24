import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/cadastro/sugestao-promocao';
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: res.status, code: 'ERRO', message: (b as any)?.message ?? res.statusText };
    throw Object.assign(new Error(env.code ?? res.statusText), { envelope: env, status: res.status, body: b });
  }
  return (await res.json()) as T;
}

interface Sugestao {
  idsugest_promo_prod: number; idproduto: number; descricao: string | null; codbarra: string | null;
  nome_operador: string | null; dtcadastro: string | null; indr: string | null; nome_indr_usuario: string | null;
  indr_data: string | null; ultima_promocao: string | null;
}
const dataHora = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}` : '—');
const data = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—');

/**
 * GERENCIAR SUGESTÃO DE PROMOÇÃO (`FRMGERENCIARSUGESTAOPROMOCAO`; a tela não veio no fonte de 2020 — reconstruída do dado de
 * `SUGEST_PROMO_PROD`): os produtos sugeridos para promoção na loja, quem sugeriu e quando, a última promoção do produto;
 * resolver tira a sugestão da lista (exclusão lógica, com o usuário e a data).
 */
export function SugestaoPromocaoPage() {
  const mensagem = useMensagem();
  const [situacao, setSituacao] = useState('abertas');
  const [linhas, setLinhas] = useState<Sugestao[]>([]);
  const [produto, setProduto] = useState('');
  const [busy, setBusy] = useState(false);

  const carregar = async (s = situacao) => {
    try { setLinhas(await req<Sugestao[]>(`${P}?situacao=${s}`)); } catch (e) { mensagem.erro(e); }
  };
  useEffect(() => { void carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sugerir = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await req(P, { method: 'POST', body: JSON.stringify({ idproduto: Number(produto) }) });
      mensagem.sucesso('Sugestão de promoção registrada.');
      setProduto('');
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const resolver = async (s: Sugestao) => {
    if (!window.confirm(`Resolver a sugestão do produto ${s.idproduto} — ${s.descricao ?? ''}?`)) return;
    try {
      await req(`${P}/${s.idsugest_promo_prod}/resolver`, { method: 'POST' });
      mensagem.sucesso('Sugestão resolvida.');
      await carregar();
    } catch (e) { mensagem.erro(e); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Sugestões de promoção" />
      <section className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-44">
          <SelectField label="&Situação" value={situacao} onChange={(v) => { const s = v ?? 'abertas'; setSituacao(s); void carregar(s); }}
            options={[{ value: 'abertas', label: 'Em aberto' }, { value: 'resolvidas', label: 'Resolvidas' }, { value: 'todas', label: 'Todas' }]} />
        </div>
        <div className="w-40"><Field label="Código do &produto" inputMode="numeric" value={produto} onChange={(e) => setProduto(e.target.value.replace(/\D/g, ''))} /></div>
        <Button label="&Sugerir promoção" variant="soft" disabled={busy || !produto} onClick={() => void sugerir()} />
      </section>
      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Produto</th><th className="p-pad-xs">Código de barras</th><th className="p-pad-xs">Sugerido por</th>
              <th className="p-pad-xs">Em</th><th className="p-pad-xs">Última promoção</th><th className="p-pad-xs">Situação</th><th className="p-pad-xs" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((s) => (
              <tr key={s.idsugest_promo_prod} className="border-t border-border">
                <td className="p-pad-xs">{s.idproduto} — {s.descricao ?? ''}</td>
                <td className="p-pad-xs tabular-nums">{s.codbarra ?? '—'}</td>
                <td className="p-pad-xs">{s.nome_operador ?? '—'}</td>
                <td className="p-pad-xs tabular-nums">{dataHora(s.dtcadastro)}</td>
                <td className="p-pad-xs tabular-nums">{data(s.ultima_promocao)}</td>
                <td className="p-pad-xs">{s.indr === 'S' ? `Resolvida por ${s.nome_indr_usuario ?? '—'} em ${dataHora(s.indr_data)}` : 'Em aberto'}</td>
                <td className="p-pad-xs text-right">{s.indr !== 'S' && <button className="underline" onClick={() => void resolver(s)}>resolver</button>}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={7} className="p-pad-md text-fg-muted">Nenhuma sugestão nesta situação.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
