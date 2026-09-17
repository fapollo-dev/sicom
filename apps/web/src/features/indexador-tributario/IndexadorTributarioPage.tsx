import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import {
  isErroResposta, OPERACOES_INDEXADOR, TIPOS_CADASTRO_INDEXADOR,
  type ErroResposta, type IndexadorTributarioDto,
} from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * CADASTRO DO INDEXADOR TRIBUTÁRIO (`FRMCADINDEXADORTRIBUTARIO`).
 * Dossiê: `uCadIndexadorTributario.md`.
 *
 * Para cada figura fiscal — e, dentro dela, EAN, NCM ou fornecedor —, qual alíquota, MVA e redução aplicar.
 * É de onde sai o ICMS-ST de toda entrada de nota.
 *
 * ⚠️ o mesmo NCM tem vários indexadores de propósito (no cliente, um deles tem 285): quem decide é a figura
 * completa, e o desempate é por **especificidade** — EAN vence NCM, que vence fornecedor.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = '/cadastro/indexador-tributario';
const pct = (v: unknown) => `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

interface Linha extends IndexadorTributarioDto {
  codindexadortributario: number; parceiro: string; indr: string | null; usuario: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: res.statusText };
    throw Object.assign(new Error(env.code), { envelope: env });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const vazio = (): IndexadorTributarioDto => ({
  tp_cadastro: 'F', tp_figura: 'N', codfigurafiscal: null, origem: 'MG', destino: 'MG',
  codcfop: null, operacao: 'T', codbarra: null, ncm: null, codparceiro: null, cnpj_cpf: null,
  aliquota_dest: 18, icm_fonte: 12, mva: 0, redcom: 100, reducao: 100, aliquota_fem: 0,
  st_externo: 'N', basesemreducao: null, base_st_com_reducao: null,
  aliquota_fonte_lei_3166: null, aliquota_reduzida_lei_3166: null, considerar_desconto_calc_st: null,
});

export function IndexadorTributarioPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ ncm: '', codbarra: '', codparceiro: '', codcfop: '', incluirExcluidos: 'N' });
  const [lista, setLista] = useState<Linha[]>([]);
  const [editando, setEditando] = useState<number | null>(null);
  const [form, setForm] = useState<IndexadorTributarioDto | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = useCallback(async () => {
    try {
      const q = new URLSearchParams({ incluirExcluidos: f.incluirExcluidos, limite: '500' });
      for (const k of ['ncm', 'codbarra', 'codparceiro', 'codcfop'] as const) if (f[k]) q.set(k, f[k]);
      setLista(await req<Linha[]>(`${P}?${q}`));
    } catch (e) { mensagem.erro(e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, mensagem]);

  useEffect(() => { void buscar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const abrir = (l: Linha | null) => {
    setEditando(l?.codindexadortributario ?? null);
    setForm(l ? { ...(l as IndexadorTributarioDto) } : vazio());
  };

  const salvar = async () => {
    if (!form) return;
    setOcupado(true);
    try {
      if (editando == null) await req(P, { method: 'POST', body: JSON.stringify(form) });
      else await req(`${P}/${editando}`, { method: 'PUT', body: JSON.stringify(form) });
      mensagem.sucesso('Indexador gravado.');
      setForm(null); setEditando(null); await buscar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const excluir = async (l: Linha) => {
    setOcupado(true);
    try { await req(`${P}/${l.codindexadortributario}`, { method: 'DELETE' }); mensagem.sucesso('Excluído (logicamente).'); await buscar(); }
    catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const semDiscriminador = !!form && !form.codbarra && !form.ncm && form.codparceiro == null;

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Indexador tributário" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          Para cada <strong>figura fiscal</strong> — tipo, origem, destino e CFOP — e, dentro dela, EAN, NCM ou
          fornecedor, qual alíquota, MVA e redução aplicar. O mesmo NCM pode ter vários: quem decide é a figura
          completa, com desempate por <strong>especificidade</strong> (EAN &gt; NCM &gt; fornecedor).
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-32"><Field label="&NCM" value={f.ncm} onChange={(e) => setF({ ...f, ncm: e.target.value })} /></div>
          <div className="w-40"><Field label="&EAN" value={f.codbarra} onChange={(e) => setF({ ...f, codbarra: e.target.value })} /></div>
          <div className="w-32"><Field label="&Fornecedor" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value })} /></div>
          <div className="w-28"><Field label="&CFOP" value={f.codcfop} onChange={(e) => setF({ ...f, codcfop: e.target.value })} /></div>
          <label className="flex items-center gap-gp-xs text-body-sm">
            <input type="checkbox" checked={f.incluirExcluidos === 'S'} onChange={(e) => setF({ ...f, incluirExcluidos: e.target.checked ? 'S' : 'N' })} />
            Mostrar excluídos
          </label>
          <Button label="&Buscar" disabled={ocupado} onClick={() => void buscar()} />
          <Button variant="outline" label="&Novo" onClick={() => abrir(null)} />
        </div>
      </section>

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full min-w-[1100px] border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th className="p-pad-xs">Figura</th><th className="p-pad-xs">Tipo</th>
              <th className="p-pad-xs">Orig/Dest</th><th className="p-pad-xs">CFOP</th>
              <th className="p-pad-xs">EAN</th><th className="p-pad-xs">NCM</th>
              <th className="p-pad-xs">Fornecedor</th><th className="p-pad-xs">Alíq.</th>
              <th className="p-pad-xs">Fonte</th><th className="p-pad-xs">MVA</th>
              <th className="p-pad-xs">Red. BC</th><th />
            </tr>
          </thead>
          <tbody>
            {lista.map((l) => (
              <tr key={l.codindexadortributario} className={`border-b border-border ${l.indr === 'E' ? 'text-fg-muted line-through' : ''}`}>
                <td className="p-pad-xs">{l.codfigurafiscal ?? ''}</td>
                <td className="p-pad-xs">{l.tp_cadastro}{l.tp_figura === 'S' ? ' (Simples)' : ''}</td>
                <td className="p-pad-xs">{l.origem}/{l.destino}</td>
                <td className="p-pad-xs">{l.codcfop ?? ''}</td>
                <td className="p-pad-xs font-mono">{l.codbarra ?? ''}</td>
                <td className="p-pad-xs font-mono">{l.ncm ?? ''}</td>
                <td className="p-pad-xs">{l.parceiro || (l.codparceiro ?? '')}</td>
                <td className="p-pad-xs tabular-nums">{pct(l.aliquota_dest)}</td>
                <td className="p-pad-xs tabular-nums">{pct(l.icm_fonte)}</td>
                <td className="p-pad-xs tabular-nums">{pct(l.mva)}</td>
                <td className="p-pad-xs tabular-nums">{pct(l.redcom)}</td>
                <td className="p-pad-xs">
                  {l.indr !== 'E' && (
                    <span className="flex gap-gp-xs">
                      <Button variant="outline" label="Editar" onClick={() => abrir(l)} />
                      <Button variant="outline" label="Excluir" disabled={ocupado} onClick={() => void excluir(l)} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h2 className="text-title-sm">{editando == null ? 'Novo indexador' : `Indexador ${editando}`}</h2>

          <div className="flex flex-wrap items-end gap-gp-sm">
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Tipo de cadastro
              <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
                value={form.tp_cadastro} onChange={(e) => setForm({ ...form, tp_cadastro: e.target.value as 'F' | 'C' })}>
                {TIPOS_CADASTRO_INDEXADOR.map((t) => <option key={t} value={t}>{t === 'F' ? 'Fornecedor' : 'Cliente'}</option>)}
              </select>
            </label>
            <div className="w-28"><Field label="&Figura" value={String(form.codfigurafiscal ?? '')} onChange={(e) => setForm({ ...form, codfigurafiscal: e.target.value ? Number(e.target.value) : null })} /></div>
            <div className="w-24"><Field label="&Origem" value={form.origem ?? ''} onChange={(e) => setForm({ ...form, origem: e.target.value.toUpperCase() })} /></div>
            <div className="w-24"><Field label="&Destino" value={form.destino ?? ''} onChange={(e) => setForm({ ...form, destino: e.target.value.toUpperCase() })} /></div>
            <div className="w-28"><Field label="&CFOP" value={String(form.codcfop ?? '')} onChange={(e) => setForm({ ...form, codcfop: e.target.value ? Number(e.target.value) : null })} /></div>
            <label className="flex flex-col gap-gp-xs text-body-sm">
              Operação
              <select className="h-9 rounded-radius-sm border border-border bg-bg-base px-pad-sm"
                value={form.operacao ?? 'T'} onChange={(e) => setForm({ ...form, operacao: e.target.value as 'T' })}>
                {OPERACOES_INDEXADOR.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-gp-xs text-body-sm">
              <input type="checkbox" checked={form.tp_figura === 'S'} onChange={(e) => setForm({ ...form, tp_figura: e.target.checked ? 'S' : 'N' })} />
              Fornecedor do Simples
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-44"><Field label="&EAN" value={form.codbarra ?? ''} onChange={(e) => setForm({ ...form, codbarra: e.target.value || null })} /></div>
            <div className="w-36"><Field label="N&CM" value={form.ncm ?? ''} onChange={(e) => setForm({ ...form, ncm: e.target.value || null })} /></div>
            <div className="w-32"><Field label="&Parceiro" value={String(form.codparceiro ?? '')} onChange={(e) => setForm({ ...form, codparceiro: e.target.value ? Number(e.target.value) : null })} /></div>
            <div className="w-44"><Field label="CNPJ/CP&F" value={form.cnpj_cpf ?? ''} onChange={(e) => setForm({ ...form, cnpj_cpf: e.target.value || null })} /></div>
          </div>
          {semDiscriminador && (
            <p className="text-body-sm text-fg-danger">
              Informe ao menos um entre <strong>EAN, NCM e fornecedor</strong> — um indexador sem nenhum deles
              casaria com tudo dentro da figura.
            </p>
          )}

          <div className="flex flex-wrap items-end gap-gp-sm">
            <div className="w-32"><Field label="&Alíquota %" type="number" value={String(form.aliquota_dest)} onChange={(e) => setForm({ ...form, aliquota_dest: Number(e.target.value || 0) })} /></div>
            <div className="w-36"><Field label="Alíq. &fonte %" type="number" value={String(form.icm_fonte)} onChange={(e) => setForm({ ...form, icm_fonte: Number(e.target.value || 0) })} /></div>
            <div className="w-28"><Field label="&MVA %" type="number" value={String(form.mva)} onChange={(e) => setForm({ ...form, mva: Number(e.target.value || 0) })} /></div>
            <div className="w-32"><Field label="BC ST &red. %" type="number" value={String(form.redcom)} onChange={(e) => setForm({ ...form, redcom: Number(e.target.value || 0) })} /></div>
            <div className="w-32"><Field label="BC ICMS re&d. %" type="number" value={String(form.reducao)} onChange={(e) => setForm({ ...form, reducao: Number(e.target.value || 0) })} /></div>
            <div className="w-28"><Field label="F&CP %" type="number" value={String(form.aliquota_fem)} onChange={(e) => setForm({ ...form, aliquota_fem: Number(e.target.value || 0) })} /></div>
            <label className="flex items-center gap-gp-xs text-body-sm">
              <input type="checkbox" checked={form.st_externo === 'S'} onChange={(e) => setForm({ ...form, st_externo: e.target.checked ? 'S' : 'N' })} />
              ST a recolher (externo)
            </label>
          </div>

          <div className="flex gap-gp-sm">
            <Button label="&Gravar" disabled={ocupado || semDiscriminador} onClick={() => void salvar()} />
            <Button variant="outline" label="&Cancelar" onClick={() => { setForm(null); setEditando(null); }} />
          </div>
        </section>
      )}
    </div>
  );
}
