import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/** EXPORTAÇÃO DE NF-e (`FRMEXPORTANFE`). Dossiê: `uExportaNFe.md`. */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;
interface Nota { codnf: number; nronf: string; serie: string; modelo: string; dtemissao: string; chavenfe: string; statusnfe: string | null; totalnf: number; razao: string | null; temXml: boolean }
const STATUS: Record<string, string> = { P: 'Autorizada', C: 'Cancelada', D: 'Denegada' };

export function ExportaNfePage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: inicioDoMes(), dataFim: hoje(), modelo: '55', status: 'todas' });
  const [notas, setNotas] = useState<Nota[] | null>(null);
  const [xml, setXml] = useState<{ chavenfe: string | null; xml: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const pedir = async <T,>(url: string): Promise<T> => {
    const r = await fetch(url, { headers: apiHeaders() });
    handle401(r);
    if (!r.ok) { const b = await r.json().catch(() => ({})); const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText }; throw Object.assign(new Error(env.code), { envelope: env }); }
    return (await r.json()) as T;
  };
  const buscar = async () => {
    setOcupado(true);
    try { setXml(null); setNotas((await pedir<{ notas: Nota[] }>(`${BASE}/fiscal/nf-exportacao?${new URLSearchParams(f)}`)).notas); } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const verXml = async (codnf: number) => { try { setXml(await pedir(`${BASE}/fiscal/nf-exportacao/${codnf}/xml`)); } catch (e) { mensagem.erro(e); } };
  const copiar = async () => { if (!xml) return; try { await navigator.clipboard.writeText(xml.xml); mensagem.sucesso('XML copiado.'); } catch { mensagem.erro(new Error('Não foi possível copiar.')); } };
  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Exportação de NF-e" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">As notas eletrônicas do período. Abra uma nota para ver o XML autorizado guardado e copiá-lo. Transmitir, cancelar e carta de correção estão na tela da nota.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-36"><label className="mb-1 block text-body-sm text-fg-muted">Modelo</label><select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })}><option value="55">NF-e (55)</option><option value="65">NFC-e (65)</option><option value="todos">Todos</option></select></div>
          <div className="w-40"><label className="mb-1 block text-body-sm text-fg-muted">Situação</label><select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="todas">Todas</option><option value="autorizadas">Autorizadas</option><option value="canceladas">Canceladas</option></select></div>
          <Button label="&Buscar" disabled={ocupado} onClick={() => void buscar()} />
        </div>
      </section>
      {notas && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full min-w-[1000px] border-collapse text-body-sm">
            <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Nº</th><th className="p-pad-xs">Série</th><th className="p-pad-xs">Emissão</th><th className="p-pad-xs">Destinatário</th><th className="p-pad-xs">Chave</th><th className="p-pad-xs">Situação</th><th className="p-pad-xs text-right">Total</th><th className="p-pad-xs">XML</th></tr></thead>
            <tbody>{notas.length === 0 && <tr><td colSpan={8} className="p-pad-md text-center text-fg-muted">Nenhuma nota eletrônica no período.</td></tr>}
              {notas.map((n) => (
                <tr key={n.codnf} className="border-b border-border">
                  <td className="p-pad-xs tabular-nums">{n.nronf}</td><td className="p-pad-xs">{n.serie}</td><td className="p-pad-xs">{dataBr(n.dtemissao)}</td><td className="p-pad-xs">{n.razao ?? ''}</td>
                  <td className="p-pad-xs font-mono text-xs">{n.chavenfe}</td>
                  <td className={`p-pad-xs ${n.statusnfe === 'C' ? 'text-fg-danger' : ''}`}>{STATUS[n.statusnfe ?? ''] ?? (n.statusnfe ?? 'Não enviada')}</td>
                  <td className="p-pad-xs text-right tabular-nums">{moeda(n.totalnf)}</td>
                  <td className="p-pad-xs">{n.temXml ? <Button label="Ver XML" variant="outline" onClick={() => void verXml(n.codnf)} /> : <span className="text-fg-muted">sem XML</span>}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {xml && (
        <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
          <div className="mb-form-gap flex items-center gap-gp-sm"><h3 className="text-body-sm font-semibold">XML — {xml.chavenfe}</h3><Button label="&Copiar XML" variant="outline" onClick={() => void copiar()} /></div>
          <pre className="max-h-96 overflow-auto rounded-radius-sm border border-border p-pad-xs text-xs">{xml.xml}</pre>
        </section>
      )}
    </div>
  );
}
