import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';

/**
 * RELATÓRIO DE ANÁLISE PEDIDO × NF (`FRMRELANALISEPEDIDONF`).
 * Dossiê: `uRelAnalisePedidoNF.md`.
 *
 * As análises do período, com notas e pedidos agregados, fornecedor(es) e comprador(es). "Expandido" abre,
 * embaixo de cada uma, as três grades do dossiê: divergentes, só na NF, só no pedido.
 */
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qt = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dataBr = (v: unknown) => (v == null ? '' : `${String(v).slice(0, 10).split('-').reverse().join('/')} ${String(v).slice(11, 16)}`);
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioDoMes = () => `${hoje().slice(0, 8)}01`;

interface Item extends Record<string, unknown> {
  apnId: number; dataAnalise: string; statusStr: string; totalParcialStr: string; diferencaValor: number;
  notasFiscais: string; pedidos: string; fornecedores: string; compradores: string; operador: string | null;
  divergentes?: Array<Record<string, unknown>>; soNaNf?: Array<Record<string, unknown>>; soNoPedido?: Array<Record<string, unknown>>;
}
interface Resultado { analises: Item[]; total: number; truncado: boolean }

export function RelAnalisePedidoNfPage() {
  const mensagem = useMensagem();
  const [f, setF] = useState({ dataIni: inicioDoMes(), dataFim: hoje(), codparceiro: '', codcomprador: '', expandido: false });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try {
      const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim, expandido: String(f.expandido) });
      if (f.codparceiro.trim()) q.set('codparceiro', f.codparceiro.trim());
      if (f.codcomprador.trim()) q.set('codcomprador', f.codcomprador.trim());
      const r = await fetch(`${BASE}/compras/rel-analise-pedido-nf?${q}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Análise pedido × nota fiscal" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <p className="mb-form-gap text-body-sm text-fg-muted">
          As análises do período (pela data da análise), com as notas e os pedidos numa linha. O filtro de
          fornecedor e de comprador vale para <strong>qualquer</strong> pedido da análise.
        </p>
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&De" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&Até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-32"><Field label="&Fornecedor" value={f.codparceiro} onChange={(e) => setF({ ...f, codparceiro: e.target.value })} /></div>
          <div className="w-32"><Field label="&Comprador" value={f.codcomprador} onChange={(e) => setF({ ...f, codcomprador: e.target.value })} /></div>
          <label className="flex items-center gap-gp-xs text-body-sm">
            <input type="checkbox" checked={f.expandido} onChange={(e) => setF({ ...f, expandido: e.target.checked })} />
            Expandido
          </label>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void buscar()} />
        </div>
      </section>

      {res && (
        <>
          <p className="text-body-sm text-fg-muted">
            {res.total} análise(s){res.truncado ? ' — lista truncada; estreite o período' : ''}.
          </p>
          {res.analises.length === 0 && <p className="text-body-sm text-fg-muted">Nenhuma análise no período.</p>}
          {res.analises.map((a) => (
            <div key={a.apnId} className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
              <table className="w-full min-w-[900px] border-collapse text-body-sm">
                <thead>
                  <tr className="border-b border-border text-left text-fg-muted">
                    <th className="p-pad-xs">Análise</th><th className="p-pad-xs">Data</th>
                    <th className="p-pad-xs">Fornecedor</th><th className="p-pad-xs">Comprador</th>
                    <th className="p-pad-xs">Pedidos</th><th className="p-pad-xs">Notas fiscais</th>
                    <th className="p-pad-xs">Status</th><th className="p-pad-xs">Tipo</th>
                    <th className="p-pad-xs text-right">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="p-pad-xs tabular-nums">{a.apnId}</td>
                    <td className="p-pad-xs">{dataBr(a.dataAnalise)}</td>
                    <td className="p-pad-xs">{a.fornecedores || '—'}</td>
                    <td className="p-pad-xs">{a.compradores || <span className="text-fg-muted">(sem comprador)</span>}</td>
                    <td className="p-pad-xs tabular-nums">{a.pedidos}</td>
                    <td className="p-pad-xs tabular-nums">{a.notasFiscais}</td>
                    <td className="p-pad-xs">{a.statusStr}</td>
                    <td className="p-pad-xs">{a.totalParcialStr}</td>
                    <td className={`p-pad-xs text-right tabular-nums ${Number(a.diferencaValor) !== 0 ? 'font-semibold' : ''}`}>{moeda(a.diferencaValor)}</td>
                  </tr>
                </tbody>
              </table>
              {a.divergentes && (
                <div className="grid gap-gp-sm p-pad-xs md:grid-cols-3">
                  <Grade titulo="Divergentes" vazio="Sem divergências." linhas={a.divergentes.map((d) => [String(d.descricao ?? d.idproduto), `${qt(d.apnd_quantidade_nf)} × ${qt(d.apnd_quantidade_pc)}`, `${moeda(d.apnd_valor_nf)} × ${moeda(d.apnd_valor_pc)}`])} cabecalho={['Produto', 'Qtde NF × pedido', 'Valor NF × pedido']} />
                  <Grade titulo="Só na nota" vazio="Nenhum." linhas={(a.soNaNf ?? []).map((d) => [String(d.descricao ?? d.idproduto), qt(d.apnin_quantidade), moeda(d.apnin_valor)])} cabecalho={['Produto', 'Qtde', 'Valor']} />
                  <Grade titulo="Só no pedido" vazio="Nenhum." linhas={(a.soNoPedido ?? []).map((d) => [String(d.descricao ?? d.idproduto), qt(d.apnip_quantidade), moeda(d.apnip_valor)])} cabecalho={['Produto', 'Qtde', 'Valor']} />
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Grade({ titulo, vazio, cabecalho, linhas }: { titulo: string; vazio: string; cabecalho: string[]; linhas: string[][] }) {
  return (
    <section className="rounded-radius-sm border border-border p-pad-xs">
      <h4 className="mb-1 text-body-sm font-semibold">{titulo}</h4>
      {linhas.length === 0 ? <p className="text-body-sm text-fg-muted">{vazio}</p> : (
        <table className="w-full border-collapse text-body-sm">
          <thead><tr className="border-b border-border text-left text-fg-muted">{cabecalho.map((c) => <th key={c} className="p-pad-xs">{c}</th>)}</tr></thead>
          <tbody>{linhas.map((l, i) => <tr key={i} className="border-b border-border">{l.map((c, j) => <td key={j} className={`p-pad-xs ${j > 0 ? 'tabular-nums' : ''}`}>{c}</td>)}</tr>)}</tbody>
        </table>
      )}
    </section>
  );
}
