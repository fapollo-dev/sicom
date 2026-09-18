import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * RELATÓRIO DE PERDAS (`FRMRELPERDAS`). Dossiê: `uRelPerdas.md`.
 * Analítico (item a item + resumo por centro de custo) ou sintético (por produto × motivo × setor). Os totais
 * trazem o maior item e a participação dele — o número que no cliente valeu 91% das perdas de um ano.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qt = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const pct = (v: unknown) => `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;

interface Totais { itens: number; scraps: number; qtde: number; custo: number; maiorItem: { codscrap: number; data: string; descricao: string; qtde: number; vrCusto: number; total: number; participacao: number } | null }
interface Resultado { tipo: 'analitico' | 'sintetico'; truncado: boolean; itens?: Array<Record<string, unknown>>; centrosCusto?: Array<Record<string, unknown>>; produtos?: Array<Record<string, unknown>>; totais: Totais }

export function RelPerdasPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: inicioDoMes(), dataFim: hoje(), tipo: 'analitico', codplc: '', codmotivoop: '', codsetor: '', coddpto: '', codfor: '', idproduto: '', codscrap: '' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim, tipo: f.tipo });
      for (const k of ['codplc', 'codmotivoop', 'codsetor', 'coddpto', 'codfor', 'idproduto', 'codscrap'] as const) if (f[k].trim()) q.set(k, f[k].trim());
      const r = await fetch(`${BASE}/cadastro/rel-perdas?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const m = res?.totais.maiorItem;
  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Relatório de perdas" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">Os scraps (perdas e quebras) do período. Analítico lista item a item com o resumo por centro de custo; sintético agrupa por produto, motivo e setor.</p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-36">
            <label className="mb-1 block text-body-sm text-fg-muted">Tipo</label>
            <select className="w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              <option value="analitico">Analítico</option><option value="sintetico">Sintético</option>
            </select>
          </div>
          <div className="w-28"><Field label="C. &custo" value={f.codplc} onChange={(e) => setF({ ...f, codplc: e.target.value })} /></div>
          <div className="w-28"><Field label="&Motivo" value={f.codmotivoop} onChange={(e) => setF({ ...f, codmotivoop: e.target.value })} /></div>
          <div className="w-28"><Field label="&Setor" value={f.codsetor} onChange={(e) => setF({ ...f, codsetor: e.target.value })} /></div>
          <div className="w-28"><Field label="&Depto" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value })} /></div>
          <div className="w-28"><Field label="&Fornecedor" value={f.codfor} onChange={(e) => setF({ ...f, codfor: e.target.value })} /></div>
          <div className="w-28"><Field label="&Produto" value={f.idproduto} onChange={(e) => setF({ ...f, idproduto: e.target.value })} /></div>
          <div className="w-28"><Field label="Scra&p" value={f.codscrap} onChange={(e) => setF({ ...f, codscrap: e.target.value })} /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void buscar()} />
        </div>
      </section>

      {res && (
        <>
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-md text-body-sm">
              <span>Scraps <strong className="tabular-nums">{res.totais.scraps}</strong></span>
              <span>Itens <strong className="tabular-nums">{res.totais.itens}</strong></span>
              <span>Quantidade <strong className="tabular-nums">{qt(res.totais.qtde)}</strong></span>
              <span>Custo <strong className="tabular-nums">{moeda(res.totais.custo)}</strong></span>
              {res.truncado && <span className="text-fg-danger">lista truncada — estreite o período</span>}
            </div>
            {m && (
              <p className={`mt-form-gap text-body-sm ${m.participacao >= 50 ? 'font-semibold text-fg-danger' : 'text-fg-muted'}`}>
                Maior item: scrap {m.codscrap} ({dataBr(m.data)}) · {m.descricao} · {qt(m.qtde)} × {moeda(m.vrCusto)} = {moeda(m.total)} — <strong>{pct(m.participacao)}</strong> do custo do período{m.participacao >= 50 ? '. Confira a quantidade digitada.' : '.'}
              </p>
            )}
          </section>

          {res.tipo === 'analitico' && (
            <>
              <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
                <table className="w-full min-w-[1100px] border-collapse text-body-sm">
                  <thead><tr className="border-b border-border text-left text-fg-muted">
                    <th className="p-pad-xs">Scrap</th><th className="p-pad-xs">Data</th><th className="p-pad-xs">C. custo</th><th className="p-pad-xs">Parceiro</th>
                    <th className="p-pad-xs">Produto</th><th className="p-pad-xs text-right">Qtde</th><th className="p-pad-xs text-right">Custo</th><th className="p-pad-xs text-right">Total</th>
                    <th className="p-pad-xs">Motivo</th><th className="p-pad-xs">Setor</th><th className="p-pad-xs">Depto</th><th className="p-pad-xs">Estoque</th>
                  </tr></thead>
                  <tbody>{(res.itens ?? []).map((i) => (
                    <tr key={String(i.codscrapitem)} className="border-b border-border">
                      <td className="p-pad-xs tabular-nums">{String(i.codscrap)}</td><td className="p-pad-xs">{dataBr(i.data)}</td>
                      <td className="p-pad-xs">{String(i.desccodplc ?? '')} {String(i.centro_custo ?? '')}</td><td className="p-pad-xs">{String(i.parceiro ?? '')}</td>
                      <td className="p-pad-xs">{String(i.descricao)}</td><td className="p-pad-xs text-right tabular-nums">{qt(i.qtde)}</td>
                      <td className="p-pad-xs text-right tabular-nums">{moeda(i.vrCusto)}</td><td className="p-pad-xs text-right tabular-nums font-semibold">{moeda(i.total)}</td>
                      <td className="p-pad-xs">{String(i.motivo_perda ?? '')}</td><td className="p-pad-xs">{String(i.setor ?? '')}</td><td className="p-pad-xs">{String(i.departamento ?? '')}</td>
                      <td className="p-pad-xs">{i.mov_estoque === 'S' ? 'baixado' : 'pendente'}</td>
                    </tr>))}</tbody>
                </table>
              </div>
              <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
                <h4 className="p-pad-xs text-body-sm font-semibold">Por centro de custo</h4>
                <table className="w-full min-w-[600px] border-collapse text-body-sm">
                  <thead><tr className="border-b border-border text-left text-fg-muted"><th className="p-pad-xs">Centro de custo</th><th className="p-pad-xs">Departamento</th><th className="p-pad-xs text-right">Itens</th><th className="p-pad-xs text-right">Total</th></tr></thead>
                  <tbody>{(res.centrosCusto ?? []).map((c, i) => (
                    <tr key={i} className="border-b border-border"><td className="p-pad-xs">{String(c.desccodplc ?? '')} {String(c.centroCusto ?? '(sem centro)')}</td><td className="p-pad-xs">{String(c.departamento ?? '')}</td><td className="p-pad-xs text-right tabular-nums">{String(c.itens)}</td><td className="p-pad-xs text-right tabular-nums font-semibold">{moeda(c.total)}</td></tr>))}</tbody>
                </table>
              </div>
            </>
          )}

          {res.tipo === 'sintetico' && (
            <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
              <table className="w-full min-w-[1000px] border-collapse text-body-sm">
                <thead><tr className="border-b border-border text-left text-fg-muted">
                  <th className="p-pad-xs">Produto</th><th className="p-pad-xs text-right">Qtde</th><th className="p-pad-xs text-right">Custo médio</th><th className="p-pad-xs text-right">Total</th>
                  <th className="p-pad-xs">Motivo</th><th className="p-pad-xs">Setor</th><th className="p-pad-xs">Fornecedor</th><th className="p-pad-xs">Depto</th>
                </tr></thead>
                <tbody>{(res.produtos ?? []).map((p, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="p-pad-xs">{String(p.descricao)}</td><td className="p-pad-xs text-right tabular-nums">{qt(p.qtde)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{moeda(p.vrCusto)}</td><td className="p-pad-xs text-right tabular-nums font-semibold">{moeda(p.total)}</td>
                    <td className="p-pad-xs">{String(p.motivo_perda ?? '')}</td><td className="p-pad-xs">{String(p.setor ?? '')}</td><td className="p-pad-xs">{String(p.fornecedor ?? '')}</td><td className="p-pad-xs">{String(p.departamento ?? '')}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
