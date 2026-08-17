import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: apiHeaders(), ...init });
  handle401(res);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: res.status, code: 'ERRO', message: (b as any)?.message ?? res.statusText };
    throw Object.assign(new Error(env.code ?? res.statusText), { envelope: env, status: res.status, body: b });
  }
  return (await res.json()) as T;
}
const post = <T,>(path: string, body: unknown) => req<T>(path, { method: 'POST', body: JSON.stringify(body) });

const brl = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const atras = (dias: number) => { const d = new Date(Date.now() - dias * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

type Linha = Record<string, unknown>;

/**
 * MANIFESTO DO DFe — corte 1 (local): a fila das NF-e emitidas contra a empresa, com a situação de
 * manifestação de cada uma, histórico de eventos, ignorar com motivo e exportação do XML.
 * A transmissão dos eventos à SEFAZ é o corte 2 (depende do certificado digital).
 */
export function ManifestoDfePage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(atras(30));
  const [dtfim, setDtfim] = useState(hoje());
  const [fornecedor, setFornecedor] = useState('');
  const [canceladas, setCanceladas] = useState('TODOS');
  const [pendentes, setPendentes] = useState(true);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Record<string, unknown> | null>(null);
  const [eventos, setEventos] = useState<Linha[] | null>(null);
  const [chaveEv, setChaveEv] = useState('');
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await post<{ linhas: Linha[]; totais: Record<string, unknown> }>('/compras/manifesto-dfe/listar', {
        dtini, dtfim, fornecedor: fornecedor || undefined, canceladas, pendentes,
      });
      setLinhas(r.linhas); setTotais(r.totais); setEventos(null);
      if (!r.linhas.length) mensagem.sucesso('Nenhuma NF-e no filtro informado.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const verEventos = async (chave: string) => {
    try {
      const r = await req<{ linhas: Linha[] }>(`/compras/manifesto-dfe/eventos/${chave}`);
      setEventos(r.linhas); setChaveEv(chave);
    } catch (e) { mensagem.erro(e); }
  };

  const ignorar = async (l: Linha) => {
    const ig = l.ignorada === 'S';
    const motivo = ig ? null : window.prompt('Motivo para ignorar esta NF-e (obrigatório):');
    if (!ig && !motivo?.trim()) return;
    try {
      await post('/compras/manifesto-dfe/ignorar', { codnfe_naocad: l.codnfe_naocad, motivo: motivo ?? undefined, reverter: ig });
      mensagem.sucesso(ig ? 'NF-e devolvida à fila.' : 'NF-e ignorada.');
      void consultar();
    } catch (e) { mensagem.erro(e); }
  };

  const baixarXml = async (chave: string) => {
    try {
      const r = await req<{ xml: string }>(`/compras/manifesto-dfe/xml/${chave}`);
      const blob = new Blob([r.xml ?? ''], { type: 'application/xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${chave}.xml`; a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { mensagem.erro(e); }
  };

  const manif = (l: Linha) => {
    if (Number(l.confirmacao)) return 'Confirmada';
    if (Number(l.op_nao_realizada)) return 'Op. não realizada';
    if (Number(l.desconhecimento)) return 'Desconhecida';
    if (Number(l.ciencia)) return 'Ciência';
    return '—';
  };

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Manifesto do Destinatário (DF-e)" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="&Emissão de" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="&até" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <div className="w-56"><Field label="&Fornecedor" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="parte da razão social" /></div>
        <div className="w-44"><SelectField label="&Canceladas" value={canceladas} onChange={setCanceladas} options={[
          { value: 'TODOS', label: 'Todas' }, { value: 'CANCELADAS', label: 'Só canceladas' }, { value: 'NAO_CANCELADAS', label: 'Só não canceladas' },
        ]} /></div>
        <label className="flex items-center gap-gp-xs pb-pad-xs text-body-sm">
          <input type="checkbox" checked={pendentes} onChange={(e) => setPendentes(e.target.checked)} />
          Só &pendentes
        </label>
        <Button label="&Buscar notas" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <small className="w-full text-fg-muted">
          As notas emitidas contra a empresa, captadas da SEFAZ. <b>Vermelho</b> = cancelada pelo emitente.
          A manifestação (ciência/confirmação) à SEFAZ chega no próximo corte — aqui você acompanha, ignora
          com motivo e baixa o XML para importar.
        </small>
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {[
            { rot: 'Notas', val: String(totais.linhas) },
            { rot: 'Pendentes', val: String(totais.pendentes), dg: Number(totais.pendentes) > 0 },
            { rot: 'Canceladas pelo emitente', val: String(totais.canceladas) },
            { rot: 'Total', val: brl(totais.total) },
          ].map((k) => (
            <div key={k.rot} className="flex-1 min-w-32 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.rot}</div>
              <div className={`text-title-sm font-bold tabular-nums ${(k as any).dg ? 'text-danger' : ''}`}>{k.val}</div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Emissão</th><th className="p-pad-xs">Fornecedor</th>
              <th className="p-pad-xs">Chave</th><th className="p-pad-xs text-right">Total</th>
              <th className="p-pad-xs">Manifestação</th><th className="p-pad-xs">Situação</th>
              <th className="p-pad-xs">Ações</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={String(l.codnfe_naocad)} className={`border-t border-border ${Number(l.cancelada) ? 'text-danger' : ''}`}>
                <td className="p-pad-xs tabular-nums">{dia(l.dtemissao)}</td>
                <td className="p-pad-xs">{String(l.razao ?? '—')}</td>
                <td className="p-pad-xs tabular-nums text-body-xs">{String(l.chavenfe)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(l.totalnf)}</td>
                <td className="p-pad-xs">{manif(l)}{Number(l.cancelada) ? ' · CANCELADA' : ''}</td>
                <td className="p-pad-xs">
                  {l.importada === 'S' ? 'Importada' : l.ignorada === 'S' ? `Ignorada (${String(l.ignorar_manifesto_motivo ?? '')})` : 'Pendente'}
                </td>
                <td className="p-pad-xs whitespace-nowrap">
                  <button className="underline" onClick={() => void verEventos(String(l.chavenfe))}>eventos</button>
                  {l.tem_xml === true && <>{' · '}<button className="underline" onClick={() => void baixarXml(String(l.chavenfe))}>xml</button></>}
                  {l.importada !== 'S' && <>{' · '}<button className="underline" onClick={() => void ignorar(l)}>{l.ignorada === 'S' ? 'reverter' : 'ignorar'}</button></>}
                </td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={7} className="p-pad-md text-fg-muted">Informe o filtro e busque.</td></tr>}
          </tbody>
        </table>
      </div>

      {eventos && (
        <>
          <div className="text-body-sm font-semibold">Eventos da chave {chaveEv}</div>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className="p-pad-xs">Data</th><th className="p-pad-xs">Tipo</th>
                  <th className="p-pad-xs">Descrição</th><th className="p-pad-xs">Protocolo</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((e, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-pad-xs tabular-nums">{dia(e.data_evento)}</td>
                    <td className="p-pad-xs tabular-nums">{String(e.tipo_evento)}</td>
                    <td className="p-pad-xs">{String(e.descricao_evento ?? '—')}</td>
                    <td className="p-pad-xs tabular-nums">{String(e.protocolo_autorizacao ?? '—')}</td>
                  </tr>
                ))}
                {!eventos.length && <tr><td colSpan={4} className="p-pad-md text-fg-muted">Sem eventos.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
