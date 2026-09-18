import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * ENTRADAS × FINANCEIRO (`FRMRELENTRADAS_FINAN`). Dossiê: `uRelEntradas_Finan.md`.
 * As notas de entrada do período (por data contábil) e, para a nota escolhida, os títulos a pagar dela. O
 * total destaca quantas notas não têm título nenhum — na loja 1, 346 de 4.007 em 2026.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;

type Nota = { codnf: number; nronf: string; serie: string | null; dtemissao: string; dtcontabil: string; totalprod: number; totalnf: number; cancelada: boolean; codparceiro: number | null; fornecedor: string; titulos: number; valorTitulos: number; quitados: number };
type Resultado = { notas: Nota[]; truncado: boolean; totais: { notas: number; totalprod: number; totalnf: number; semTitulo: number; valorSemTitulo: number; valorTitulos: number; canceladas: number } };
type Titulos = { codnf: number; nronf: string; titulos: Array<Record<string, unknown>>; totais: { titulos: number; valor: number; quitados: number } };

export function RelEntradasFinanPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: inicioDoMes(), dataFim: hoje(), codparceiro: '', somenteSemTitulo: false, vencIni: '', vencFim: '' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [tit, setTit] = useState<Titulos | null>(null);
  const [ocupado, setOcupado] = useState(false);

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
  const buscar = async () => {
    setOcupado(true); setSel(null); setTit(null);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim, somenteSemTitulo: String(f.somenteSemTitulo) });
      if (f.codparceiro.trim()) q.set('codparceiro', f.codparceiro.trim());
      setRes(await pedir<Resultado>(`${BASE}/relatorios/entradas-financeiro?${q}`));
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  const abrir = async (codnf: number) => {
    setSel(codnf);
    try {
      const q = new URLSearchParams();
      if (f.vencIni) q.set('vencIni', f.vencIni);
      if (f.vencFim) q.set('vencFim', f.vencFim);
      setTit(await pedir<Titulos>(`${BASE}/relatorios/entradas-financeiro/${codnf}/titulos?${q}`));
    } catch (e) { mensagem.erro(e); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Entradas × Financeiro" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">As notas de entrada do período (data contábil) e os títulos a pagar de cada uma. Clique na nota para ver os títulos; o filtro de vencimento vale para o grid de baixo.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-32"><Field label="&Fornecedor" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value })} /></div>
          <label className="flex items-center gap-1 pb-2 text-body-sm"><input type="checkbox" checked={f.somenteSemTitulo} onChange={(e) => setF({ ...f, somenteSemTitulo: e.target.checked })} /> só notas sem título</label>
          <div className="w-40"><Field label="Venc. de" type="date" value={f.vencIni} onChange={(e) => setF({ ...f, vencIni: e.target.value })} /></div>
          <div className="w-40"><Field label="Venc. até" type="date" value={f.vencFim} onChange={(e) => setF({ ...f, vencFim: e.target.value })} /></div>
          <Button label="&Consultar" disabled={ocupado} onClick={() => void buscar()} />
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-md text-body-sm">
              <span>Notas <strong className="tabular-nums">{res.totais.notas}</strong></span>
              <span>Produtos <strong className="tabular-nums">{moeda(res.totais.totalprod)}</strong></span>
              <span>Total NF <strong className="tabular-nums">{moeda(res.totais.totalnf)}</strong></span>
              <span>Títulos <strong className="tabular-nums">{moeda(res.totais.valorTitulos)}</strong></span>
              <span className={res.totais.semTitulo > 0 ? 'font-semibold text-fg-danger' : ''}>Sem título <strong className="tabular-nums">{res.totais.semTitulo}</strong> ({moeda(res.totais.valorSemTitulo)})</span>
              {res.totais.canceladas > 0 && <span>Canceladas <strong className="tabular-nums">{res.totais.canceladas}</strong></span>}
              {res.truncado && <span className="text-fg-danger">lista truncada — estreite o período</span>}
            </div>
          </section>
          <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
            <table className="w-full min-w-[1000px] border-collapse text-body-sm">
              <thead><tr className="border-b border-border text-left text-fg-muted">
                <th className="p-pad-xs">Nº NF</th><th className="p-pad-xs">Série</th><th className="p-pad-xs">Emissão</th><th className="p-pad-xs">Contábil</th><th className="p-pad-xs">Fornecedor</th>
                <th className="p-pad-xs text-right">Produtos</th><th className="p-pad-xs text-right">Total NF</th><th className="p-pad-xs text-right">Títulos</th><th className="p-pad-xs text-right">Valor títulos</th><th className="p-pad-xs">Situação</th>
              </tr></thead>
              <tbody>{res.notas.map((n) => (
                <tr key={n.codnf} className={`cursor-pointer border-b border-border hover:bg-bg-muted ${sel === n.codnf ? 'bg-bg-muted' : ''} ${n.cancelada ? 'text-fg-muted line-through' : ''}`} onClick={() => void abrir(n.codnf)}>
                  <td className="p-pad-xs tabular-nums">{n.nronf}</td><td className="p-pad-xs">{n.serie ?? ''}</td><td className="p-pad-xs">{dataBr(n.dtemissao)}</td><td className="p-pad-xs">{dataBr(n.dtcontabil)}</td>
                  <td className="p-pad-xs">{n.fornecedor}</td><td className="p-pad-xs text-right tabular-nums">{moeda(n.totalprod)}</td><td className="p-pad-xs text-right tabular-nums font-semibold">{moeda(n.totalnf)}</td>
                  <td className={`p-pad-xs text-right tabular-nums ${n.titulos === 0 ? 'font-semibold text-fg-danger' : ''}`}>{n.titulos}</td><td className="p-pad-xs text-right tabular-nums">{moeda(n.valorTitulos)}</td>
                  <td className="p-pad-xs">{n.cancelada ? 'cancelada' : n.titulos === 0 ? 'sem título' : n.quitados === n.titulos ? 'quitada' : `${n.quitados}/${n.titulos} quitados`}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </>
      )}

      {tit && (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <h4 className="p-pad-xs text-body-sm font-semibold">Documentos a pagar da NF {tit.nronf} — {tit.totais.titulos} título(s), {moeda(tit.totais.valor)}, {tit.totais.quitados} quitado(s)</h4>
          <table className="w-full min-w-[1100px] border-collapse text-body-sm">
            <thead><tr className="border-b border-border text-left text-fg-muted">
              <th className="p-pad-xs">Cód.</th><th className="p-pad-xs">Duplicata</th><th className="p-pad-xs">Parc.</th><th className="p-pad-xs">Compra</th><th className="p-pad-xs">Vencimento</th><th className="p-pad-xs text-right">Valor</th><th className="p-pad-xs text-right">Juros %</th>
              <th className="p-pad-xs">Tipo</th><th className="p-pad-xs">Banco</th><th className="p-pad-xs">Operador</th><th className="p-pad-xs">Quitada</th><th className="p-pad-xs">Pagamento</th><th className="p-pad-xs">Obs</th>
            </tr></thead>
            <tbody>{tit.titulos.map((t) => (
              <tr key={String(t.codapg)} className="border-b border-border">
                <td className="p-pad-xs tabular-nums">{String(t.codapg)}</td><td className="p-pad-xs">{String(t.duplicata ?? '')}</td><td className="p-pad-xs">{String(t.nrparcela ?? '')}</td>
                <td className="p-pad-xs">{dataBr(t.dtcompra)}</td><td className="p-pad-xs">{dataBr(t.dtvenc)}</td><td className="p-pad-xs text-right tabular-nums font-semibold">{moeda(t.valor)}</td>
                <td className="p-pad-xs text-right tabular-nums">{Number(t.txjuros ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td className="p-pad-xs">{String(t.tipodoc ?? '')}</td><td className="p-pad-xs">{String(t.banco ?? '')}</td><td className="p-pad-xs">{String(t.operador ?? '')}</td>
                <td className="p-pad-xs">{t.quitada ? 'sim' : 'não'}</td><td className="p-pad-xs">{dataBr(t.dtpgto)}</td><td className="p-pad-xs text-fg-muted">{String(t.obs ?? '')}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
