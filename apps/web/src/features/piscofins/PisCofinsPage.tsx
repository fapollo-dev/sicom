import { useEffect, useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/** CADASTRO DE PIS/COFINS (`FRMCADPISCOFINS`). Dossiê: `uCadPisCofins.md`. */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
type Sit = Record<string, unknown> & { idpiscofins: number };
const vazio = () => ({ descricao: '', aliqPisEnt: '0', aliqPisSai: '0', aliqCofinsEnt: '0', aliqCofinsSai: '0', cstPisEnt: '', cstPisSai: '', cstCofinsEnt: '', cstCofinsSai: '', idTipoCredito: '', exigeNatureza: 'N' } as Record<string, string>);

export function PisCofinsPage() {
  const mensagem = useMensagem();
  const [lista, setLista] = useState<Sit[]>([]);
  const [tipos, setTipos] = useState<Array<{ id_tipocredito: number; descricao: string }>>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [f, setF] = useState<Record<string, string>>(vazio());
  const [ocupado, setOcupado] = useState(false);

  const pedir = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(url, { ...init, headers: { ...apiHeaders(), ...(init?.headers ?? {}) } });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      throw Object.assign(new Error(env.code), { envelope: env });
    }
    return (await r.json()) as T;
  };
  const carregar = async () => {
    try { setLista(await pedir<Sit[]>(`${BASE}/cadastro/piscofins`)); setTipos(await pedir(`${BASE}/cadastro/piscofins/tipos-credito`)); } catch (e) { mensagem.erro(e); }
  };
  useEffect(() => { void carregar(); }, []);
  const editar = (s: Sit) => { setSel(s.idpiscofins); const n = vazio(); for (const k of Object.keys(n)) n[k] = s[k] == null ? (k === 'exigeNatureza' ? 'N' : '') : String(s[k]); setF(n); };
  const novo = () => { setSel(null); setF(vazio()); };
  const gravar = async () => {
    setOcupado(true);
    try {
      const corpo: Record<string, unknown> = { descricao: f.descricao, exigeNatureza: f.exigeNatureza };
      for (const k of ['aliqPisEnt', 'aliqPisSai', 'aliqCofinsEnt', 'aliqCofinsSai']) corpo[k] = Number(f[k] || 0);
      for (const k of ['cstPisEnt', 'cstPisSai', 'cstCofinsEnt', 'cstCofinsSai', 'idTipoCredito']) corpo[k] = f[k].trim() === '' ? null : Number(f[k]);
      await pedir(`${BASE}/cadastro/piscofins${sel ? `/${sel}` : ''}`, { method: sel ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
      mensagem.sucesso('Situação gravada.'); novo(); await carregar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const excluir = async () => {
    if (!sel || !window.confirm('Excluir esta situação de PIS/COFINS?')) return;
    try { await pedir(`${BASE}/cadastro/piscofins/${sel}`, { method: 'DELETE' }); mensagem.sucesso('Situação excluída.'); novo(); await carregar(); } catch (e) { mensagem.erro(e); }
  };
  const pct = (v: unknown) => `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Situações de PIS/COFINS" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">A situação que cada produto aponta: alíquotas e CSTs de entrada e saída, o tipo de crédito do SPED (tabela 4.3.6) e se exige natureza de receita. Situação em uso por produtos não pode ser excluída.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-72"><Field label="&Descrição" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></div>
          <div className="w-28"><Field label="PIS ent. %" value={f.aliqPisEnt} onChange={(e) => setF({ ...f, aliqPisEnt: e.target.value })} /></div>
          <div className="w-28"><Field label="PIS saí. %" value={f.aliqPisSai} onChange={(e) => setF({ ...f, aliqPisSai: e.target.value })} /></div>
          <div className="w-28"><Field label="COFINS ent. %" value={f.aliqCofinsEnt} onChange={(e) => setF({ ...f, aliqCofinsEnt: e.target.value })} /></div>
          <div className="w-28"><Field label="COFINS saí. %" value={f.aliqCofinsSai} onChange={(e) => setF({ ...f, aliqCofinsSai: e.target.value })} /></div>
          <div className="w-24"><Field label="CST PIS ent." value={f.cstPisEnt} onChange={(e) => setF({ ...f, cstPisEnt: e.target.value })} /></div>
          <div className="w-24"><Field label="CST PIS saí." value={f.cstPisSai} onChange={(e) => setF({ ...f, cstPisSai: e.target.value })} /></div>
          <div className="w-24"><Field label="CST COF ent." value={f.cstCofinsEnt} onChange={(e) => setF({ ...f, cstCofinsEnt: e.target.value })} /></div>
          <div className="w-24"><Field label="CST COF saí." value={f.cstCofinsSai} onChange={(e) => setF({ ...f, cstCofinsSai: e.target.value })} /></div>
          <div className="w-96">
            <label className="mb-1 block text-body-sm text-fg-muted">Tipo de crédito (SPED 4.3.6)</label>
            <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={f.idTipoCredito} onChange={(e) => setF({ ...f, idTipoCredito: e.target.value })}>
              <option value="">(nenhum)</option>{tipos.map((t) => <option key={t.id_tipocredito} value={String(t.id_tipocredito)}>{t.id_tipocredito} — {t.descricao}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-gp-xs text-body-sm"><input type="checkbox" checked={f.exigeNatureza === 'S'} onChange={() => setF({ ...f, exigeNatureza: f.exigeNatureza === 'S' ? 'N' : 'S' })} />Exige natureza de receita</label>
        </div>
        <div className="mt-form-gap flex gap-gp-sm">
          <Button label="&Gravar" disabled={ocupado} onClick={() => void gravar()} />
          <Button label="&Novo" variant="outline" onClick={novo} />
          {sel && <Button label="&Excluir" variant="outline" onClick={() => void excluir()} />}
        </div>
      </section>
      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full min-w-[1000px] border-collapse text-body-sm">
          <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Cód.</th><th className="p-pad-xs">Descrição</th><th className="p-pad-xs text-right">PIS ent/saí</th><th className="p-pad-xs text-right">COFINS ent/saí</th><th className="p-pad-xs">CST PIS</th><th className="p-pad-xs">CST COFINS</th><th className="p-pad-xs">Crédito</th><th className="p-pad-xs text-right">Produtos</th></tr></thead>
          <tbody>{lista.map((s) => (
            <tr key={s.idpiscofins} onClick={() => editar(s)} className={`cursor-pointer border-b border-border hover:bg-bg-subtle ${sel === s.idpiscofins ? 'bg-bg-subtle font-semibold' : ''}`}>
              <td className="p-pad-xs tabular-nums">{s.idpiscofins}</td><td className="p-pad-xs">{String(s.descricao)}</td>
              <td className="p-pad-xs text-right tabular-nums">{pct(s.aliqPisEnt)} / {pct(s.aliqPisSai)}</td><td className="p-pad-xs text-right tabular-nums">{pct(s.aliqCofinsEnt)} / {pct(s.aliqCofinsSai)}</td>
              <td className="p-pad-xs tabular-nums">{String(s.cstPisEnt ?? '')} / {String(s.cstPisSai ?? '')}</td><td className="p-pad-xs tabular-nums">{String(s.cstCofinsEnt ?? '')} / {String(s.cstCofinsSai ?? '')}</td>
              <td className="p-pad-xs">{s.idTipoCredito ? `${s.idTipoCredito}` : ''}</td><td className="p-pad-xs text-right tabular-nums">{String(s.produtos)}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
