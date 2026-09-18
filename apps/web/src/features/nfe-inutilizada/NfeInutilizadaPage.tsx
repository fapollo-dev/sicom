import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * NF-e / NFC-e INUTILIZADAS (`FRMNFE_INUTILIZADA`). Dossiê: `uNFE_Inutilizada.md`.
 * O livro das numerações queimadas — o que explica ao fisco o buraco na sequência das notas.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;

interface Item { codinutilizacao: number; data: string; tiponf: string; serie: string | null; numeracaoIni: number; numeracaoFim: number; numeros: number; protocolo: string | null }
interface Consulta { itens: Item[]; truncado: boolean; totais: { registros: number; numeros: number; semProtocolo: number; series: number } }
interface Buracos { tiponf: string; serie: string; numeros: number[]; total: number }

const vazio = () => ({ data: hoje(), tiponf: 'NFCE', serie: '', numeracaoIni: '', numeracaoFim: '', protocolo: '' });

export function NfeInutilizadaPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: inicioDoMes(), dataFim: hoje(), tiponf: '', serie: '', numero: '' });
  const [res, setRes] = useState<Consulta | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, string>>(vazio());
  const [buracos, setBuracos] = useState<Buracos | null>(null);
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
  const consultar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim });
      if (f.tiponf) q.set('tiponf', f.tiponf);
      if (f.serie.trim()) q.set('serie', f.serie.trim());
      if (f.numero.trim()) q.set('numero', f.numero.trim());
      setRes(await pedir<Consulta>(`${BASE}/fiscal/nfe-inutilizada?${q}`));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const novo = () => { setSel(null); setForm(vazio()); };
  const gravar = async () => {
    setOcupado(true);
    try {
      const corpo = {
        data: form.data, tiponf: form.tiponf, serie: form.serie.trim() || null,
        numeracaoIni: Number(form.numeracaoIni || 0), numeracaoFim: Number(form.numeracaoFim || form.numeracaoIni || 0),
        protocolo: form.protocolo.trim() || null,
      };
      await pedir(`${BASE}/fiscal/nfe-inutilizada${sel ? `/${sel}` : ''}`, { method: sel ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
      mensagem.sucesso('Inutilização gravada.'); novo(); await consultar();
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const excluir = async () => {
    if (!sel || !window.confirm('Excluir este registro de inutilização?')) return;
    try { await pedir(`${BASE}/fiscal/nfe-inutilizada/${sel}`, { method: 'DELETE' }); mensagem.sucesso('Registro excluído.'); novo(); await consultar(); } catch (e) { mensagem.erro(e); }
  };
  const verBuracos = async () => {
    try {
      const q = new URLSearchParams({ tiponf: f.tiponf || 'NFCE', serie: f.serie.trim(), dataIni: f.dataIni, dataFim: f.dataFim });
      setBuracos(await pedir<Buracos>(`${BASE}/fiscal/nfe-inutilizada/buracos?${q}`));
    } catch (e) { mensagem.erro(e); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="NF-e inutilizadas" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">Os números de nota que foram queimados e inutilizados junto à SEFAZ. É o registro que explica o buraco na sequência — sem ele, a numeração fica com falha sem justificativa.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&Data" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></div>
          <div className="w-28">
            <label className="mb-1 block text-body-sm text-fg-muted">Tipo</label>
            <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={form.tiponf} onChange={(e) => setForm({ ...form, tiponf: e.target.value })}>
              <option value="NFCE">NFC-e</option><option value="NFE">NF-e</option>
            </select>
          </div>
          <div className="w-20"><Field label="&Série" value={form.serie} maxLength={3} onChange={(e) => setForm({ ...form, serie: e.target.value })} /></div>
          <div className="w-32"><Field label="Nº &inicial" value={form.numeracaoIni} onChange={(e) => setForm({ ...form, numeracaoIni: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-32"><Field label="Nº &final" value={form.numeracaoFim} onChange={(e) => setForm({ ...form, numeracaoFim: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-52"><Field label="&Protocolo" value={form.protocolo} maxLength={30} onChange={(e) => setForm({ ...form, protocolo: e.target.value })} /></div>
          <Button label={sel ? '&Gravar' : '&Incluir'} disabled={ocupado || !form.numeracaoIni} onClick={() => void gravar()} />
          <Button label="&Novo" variant="outline" onClick={novo} />
          {sel && <Button label="E&xcluir" variant="ghost" onClick={() => void excluir()} />}
        </div>
      </section>

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-28">
            <label className="mb-1 block text-body-sm text-fg-muted">Tipo</label>
            <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={f.tiponf} onChange={(e) => setF({ ...f, tiponf: e.target.value })}>
              <option value="">todos</option><option value="NFCE">NFC-e</option><option value="NFE">NF-e</option>
            </select>
          </div>
          <div className="w-20"><Field label="Série" value={f.serie} maxLength={3} onChange={(e) => setF({ ...f, serie: e.target.value })} /></div>
          <div className="w-32"><Field label="Número" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value.replace(/\D/g, '') })} /></div>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void consultar()} />
          <Button label="&Buracos da numeração" variant="outline" onClick={() => void verBuracos()} />
        </div>
        {res && (
          <>
            <div className="mt-form-gap flex flex-wrap gap-gp-md text-body-sm">
              <span>Registros <strong className="tabular-nums">{res.totais.registros}</strong></span>
              <span>Números inutilizados <strong className="tabular-nums">{res.totais.numeros}</strong></span>
              <span>Séries <strong className="tabular-nums">{res.totais.series}</strong></span>
              <span className={res.totais.semProtocolo > 0 ? 'font-semibold text-fg-danger' : ''}>Sem protocolo <strong className="tabular-nums">{res.totais.semProtocolo}</strong></span>
              {res.truncado && <span className="text-fg-danger">lista truncada</span>}
            </div>
            <div className="mt-form-gap overflow-x-auto">
              <table className="w-full min-w-[800px] border-collapse text-body-sm">
                <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Data</th><th className="p-pad-xs">Tipo</th><th className="p-pad-xs">Série</th><th className="p-pad-xs text-right">Nº inicial</th><th className="p-pad-xs text-right">Nº final</th><th className="p-pad-xs text-right">Números</th><th className="p-pad-xs">Protocolo</th></tr></thead>
                <tbody>{res.itens.map((i) => (
                  <tr key={i.codinutilizacao} className={`cursor-pointer border-b border-border hover:bg-bg-muted ${sel === i.codinutilizacao ? 'bg-bg-muted' : ''}`}
                      onClick={() => { setSel(i.codinutilizacao); setForm({ data: String(i.data).slice(0, 10), tiponf: i.tiponf, serie: (i.serie ?? '').trim(), numeracaoIni: String(i.numeracaoIni), numeracaoFim: String(i.numeracaoFim), protocolo: i.protocolo ?? '' }); }}>
                    <td className="p-pad-xs">{dataBr(i.data)}</td><td className="p-pad-xs">{i.tiponf}</td><td className="p-pad-xs">{(i.serie ?? '').trim()}</td>
                    <td className="p-pad-xs text-right tabular-nums">{i.numeracaoIni}</td><td className="p-pad-xs text-right tabular-nums">{i.numeracaoFim}</td>
                    <td className="p-pad-xs text-right tabular-nums">{i.numeros}</td>
                    <td className={`p-pad-xs tabular-nums ${i.protocolo ? '' : 'text-fg-danger'}`}>{i.protocolo ?? 'sem protocolo'}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {buracos && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <h4 className="text-body-sm font-semibold">Números sem nota e sem inutilização — série {buracos.serie || '(vazia)'}, {buracos.tiponf}</h4>
          <p className={`mt-form-gap text-body-sm ${buracos.total > 0 ? 'text-fg-danger' : 'text-fg-muted'}`}>
            {buracos.total === 0 ? 'Nenhum buraco no período: toda numeração está emitida ou inutilizada.' : `${buracos.total} número(s): ${buracos.numeros.slice(0, 80).join(', ')}${buracos.total > 80 ? '…' : ''}`}
          </p>
        </section>
      )}
    </div>
  );
}
