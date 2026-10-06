import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Modal } from '../../shared/ui/Modal';
import { isErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { Field } from '../../shared/ui/Field';
import { useMensagem } from '../../shared/mensagem';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error('erro'), { envelope: isErroResposta(body) ? body : { code: 'ERRO', message: body?.message ?? res.statusText } });
  return body as T;
}

interface Linha { aliquota: string; uf: string; icm: string | null; icm_efetivo: string | null; base: string | null; cst: number | null; csosn: string | null; lei: string | null; codcontabilavista: number | null; codcontabilaprazo: number | null }

/**
 * Cadastro de alíquotas (UcadAliquota) — o editor da DET_ALIQUOTA: escolhe a alíquota, vê a linha de cada UF e edita (duplo clique no
 * legado) ICMS, ICMS efetivo, base, CST, lei e os lançamentos contábeis à vista e a prazo. Não inclui nem exclui linha, como o legado.
 */
export function AliquotasPage() {
  const mensagem = useMensagem();
  const [aliquotas, setAliquotas] = useState<Array<{ aliquota: string; descricao: string | null }>>([]);
  const [aliq, setAliq] = useState<string>('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [edit, setEdit] = useState<Linha | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { req<typeof aliquotas>('/cadastro/det-aliquota/aliquotas').then(setAliquotas).catch((e) => mensagem.erro(e)); }, []);
  const carregar = async (a: string) => {
    setAliq(a);
    if (!a) { setLinhas([]); return; }
    try { setLinhas(await req<Linha[]>(`/cadastro/det-aliquota?aliquota=${encodeURIComponent(a)}`)); } catch (e) { mensagem.erro(e); }
  };
  const gravar = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await req(`/cadastro/det-aliquota/${encodeURIComponent(edit.aliquota)}/${encodeURIComponent(edit.uf)}`, { method: 'PUT', body: JSON.stringify({
        icm: edit.icm, icm_efetivo: edit.icm_efetivo, base: edit.base, cst: edit.cst, lei: edit.lei, codcontabilavista: edit.codcontabilavista, codcontabilaprazo: edit.codcontabilaprazo }) });
      mensagem.sucesso(`Alíquota ${edit.aliquota} de ${edit.uf} gravada.`);
      setEdit(null);
      await carregar(aliq);
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  const n = (v: unknown) => (v == null || v === '' ? undefined : Number(v));
  const set = <K extends keyof Linha>(k: K, v: Linha[K]) => setEdit((e) => (e ? { ...e, [k]: v } : e));

  return (
    <div className="flex flex-col gap-form-gap p-pad-md">
      <PageHeader title="Alíquotas" />
      <div className="max-w-md">
        <SelectField label="&Alíquota" options={aliquotas.map((a) => ({ value: a.aliquota, label: `${a.aliquota}${a.descricao ? ` - ${a.descricao}` : ''}` }))}
          value={aliq || undefined} onChange={(v) => void carregar(v || '')} placeholder="Selecione a alíquota…" />
      </div>
      {linhas.length > 0 && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">UF</th><th className="p-pad-xs text-right">ICMS</th><th className="p-pad-xs text-right">ICMS efetivo</th><th className="p-pad-xs text-right">Base</th>
                <th className="p-pad-xs">CST</th><th className="p-pad-xs">Lei</th><th className="p-pad-xs">Contábil à vista</th><th className="p-pad-xs">Contábil a prazo</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.uf} className="cursor-pointer border-b border-border/50 hover:bg-bg-muted" onDoubleClick={() => setEdit({ ...l })} title="Duplo clique para editar">
                  <td className="p-pad-xs">{l.uf}</td><td className="p-pad-xs text-right tabular-nums">{l.icm ?? ''}</td><td className="p-pad-xs text-right tabular-nums">{l.icm_efetivo ?? ''}</td>
                  <td className="p-pad-xs text-right tabular-nums">{l.base ?? ''}</td><td className="p-pad-xs">{l.cst ?? ''}</td><td className="p-pad-xs">{l.lei ?? ''}</td>
                  <td className="p-pad-xs">{l.codcontabilavista ?? ''}</td><td className="p-pad-xs">{l.codcontabilaprazo ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={`Alíquota ${edit.aliquota} — ${edit.uf}`}
          primaryAction={{ label: 'Gravar', onClick: () => void gravar(), disabled: busy }} secondaryAction={{ label: 'Cancelar', onClick: () => setEdit(null) }}>
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <NumberField label="ICMS" value={n(edit.icm)} onChange={(v) => set('icm', v == null ? null : String(v))} decimais={2} />
            <NumberField label="ICMS efetivo" value={n(edit.icm_efetivo)} onChange={(v) => set('icm_efetivo', v == null ? null : String(v))} decimais={2} />
            <NumberField label="Base" value={n(edit.base)} onChange={(v) => set('base', v == null ? null : String(v))} decimais={2} />
            <NumberField label="CST" value={n(edit.cst)} onChange={(v) => set('cst', v == null ? null : Number(v))} decimais={0} />
            <div className="sm:col-span-2"><Field label="Lei" value={edit.lei ?? ''} onChange={(e) => set('lei', e.target.value || null)} /></div>
            <NumberField label="Lançamento contábil à vista" value={n(edit.codcontabilavista)} onChange={(v) => set('codcontabilavista', v == null ? null : Number(v))} decimais={0} />
            <NumberField label="Lançamento contábil a prazo" value={n(edit.codcontabilaprazo)} onChange={(v) => set('codcontabilaprazo', v == null ? null : Number(v))} decimais={0} />
          </div>
        </Modal>
      )}
    </div>
  );
}
