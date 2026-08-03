import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
async function req<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
  handle401(res);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: res.status, code: 'ERRO', message: (b as any)?.message ?? res.statusText };
    throw Object.assign(new Error(env.code ?? res.statusText), { envelope: env, status: res.status, body: b });
  }
  return (await res.json()) as T;
}

const brl = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const q3 = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
/** % com denominador 0 vem NULL do backend (fiel ao NULLIF do legado) → célula VAZIA, nunca "0,00%". */
const pct = (n: unknown) => (n == null || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const hoje = () => new Date().toISOString().slice(0, 10);

interface Linha { idempresa: number; idproduto: number; codbarra?: string; descricao?: string; unidade?: string; qtde: number; bruto: number; total_custo: number; total_venda: number; lucro: number; margem: number | null; rentabilidade: number | null; acrescimo: number; desc_promocao: number; vrvenda_uni: number; vrcusto_uni: number; sem_custo?: boolean; departamento?: string; grupo?: string; subgrupo?: string; secao?: string }
interface Totais { qtde: number; total_venda: number; total_custo: number; lucro_bruto: number; margem: number | null; rentabilidade: number | null; acrescimo: number; desc_promocao: number; linhas: number; sem_custo: number }
interface Filtro { truncado?: boolean; max_linhas?: number }

/**
 * RELATÓRIO DE VENDAS (FRMRELVENDAS) — rel 01 "Produtos vendidos no período", a variante dominante do hub legado
 * (11k acessos). 1 linha por produto (ou por empresa×produto) com bruto/acréscimo/desconto/líquido/custo/lucro e
 * margem-markup + rentabilidade-markdown; os 5 KPIs do topo são RECALCULADOS (não são soma das colunas de razão).
 * Cancelados são excluídos por default (fiel). As outras 49 variantes/trilhas do hub são cortes futuros.
 */
export function RelVendasPage() {
  const mensagem = useMensagem();
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [canceladas, setCanceladas] = useState('N');
  const [promocao, setPromocao] = useState('T');
  const [produto, setProduto] = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [custoRep, setCustoRep] = useState(false);
  const [horaIni, setHoraIni] = useState('00:00');
  const [horaFim, setHoraFim] = useState('23:59');
  const [filtrarHora, setFiltrarHora] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const [busy, setBusy] = useState(false);

  const gerar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ linhas: Linha[]; totais: Totais; filtro: Filtro }>('/relatorios/vendas/produtos-vendidos', {
        dtini, dtfim, canceladas, promocao: promocao === 'T' ? undefined : promocao,
        produto: produto || undefined, fornecedor: fornecedor || undefined,
        custoReposicao: custoRep, filtrarHora, horaIni, horaFim,
      });
      setLinhas(r.linhas); setTotais(r.totais); setFiltro(r.filtro);
      if (!r.linhas.length) mensagem.sucesso('Nenhuma venda no período/filtro.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  /** CSV do resultado (o legado exporta XLSX; no web o CSV cobre o caso e abre no Excel). */
  const exportar = () => {
    if (!linhas.length) return;
    const cols = ['idempresa', 'codbarra', 'descricao', 'unidade', 'qtde', 'total_custo', 'total_venda', 'vrcusto_uni', 'vrvenda_uni', 'lucro', 'margem', 'rentabilidade', 'acrescimo', 'desc_promocao', 'departamento', 'grupo', 'subgrupo', 'secao'];
    const linhasCsv = [cols.join(';'), ...linhas.map((l) => cols.map((c) => String((l as any)[c] ?? '').replace('.', ',')).join(';'))];
    const blob = new Blob(['﻿' + linhasCsv.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio-vendas-${dtini}_${dtfim}.csv`;
    a.click();
  };

  const Kpi = ({ rot, val, p = false, destaque = false }: { rot: string; val: unknown; p?: boolean; destaque?: boolean }) => (
    <div className="flex-1 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
      <div className="text-body-xs text-fg-muted">{rot}</div>
      <div className={`text-title-sm font-bold tabular-nums ${destaque ? 'text-accent' : ''}`}>{p ? pct(val) : brl(val)}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Relatório de Vendas — Produtos vendidos no período" />
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        <div className="w-44"><SelectField label="&Canceladas" value={canceladas} onChange={setCanceladas} options={[{ value: 'N', label: 'Não canceladas' }, { value: 'S', label: 'Só canceladas' }, { value: 'T', label: 'Todas' }]} /></div>
        <div className="w-36"><SelectField label="&Promoção" value={promocao} onChange={setPromocao} options={[{ value: 'T', label: 'Todos' }, { value: 'S', label: 'Em promoção' }, { value: 'N', label: 'Sem promoção' }]} /></div>
        <div className="w-48"><Field label="&Produto (descrição)" value={produto} onChange={(e) => setProduto(e.target.value)} placeholder="contém…" /></div>
        <div className="w-48"><Field label="For&necedor" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="contém…" /></div>
        <label className="flex items-center gap-1 text-body-sm"><input type="checkbox" checked={custoRep} onChange={(e) => setCustoRep(e.target.checked)} /> Custo de reposição</label>
        {/* o legado rotula "Filtrar Hora diariamente", mas o SQL dele é UMA janela contínua — o rótulo aqui diz o
            que a query faz de verdade, sem mudar o comportamento (a fidelidade é com o SQL, não com a legenda). */}
        <label className="flex items-center gap-1 text-body-sm"><input type="checkbox" checked={filtrarHora} onChange={(e) => setFiltrarHora(e.target.checked)} /> Filtrar hora</label>
        {filtrarHora && <><div className="w-24"><Field label="De" value={horaIni} onChange={(e) => setHoraIni(e.target.value)} /></div><div className="w-24"><Field label="Até" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} /></div><small className="text-fg-muted">janela contínua: {dtini} {horaIni} → {dtfim} {horaFim}</small></>}
        <Button label="&Gerar" variant="soft" disabled={busy} onClick={() => void gerar()} />
        <Button label="&Exportar CSV" variant="ghost" disabled={!linhas.length} onClick={exportar} />
      </div>

      {filtro?.truncado && (
        <div className="rounded-radius-md border border-danger bg-bg-surface p-pad-sm text-body-sm text-danger">
          <b>Resultado cortado em {filtro.max_linhas?.toLocaleString('pt-BR')} produtos</b> — os totais abaixo cobrem
          apenas as linhas exibidas e estão <b>menores</b> que o período real. Estreite o filtro (departamento,
          fornecedor ou período) para conferir os totais.
        </div>
      )}
      {!!totais?.sem_custo && (
        <div className="rounded-radius-md border border-border bg-bg-subtle p-pad-sm text-body-sm text-fg-muted">
          {totais.sem_custo} produto(s) sem custo registrado na venda — margem e rentabilidade saem em branco (não
          são 0%), e o <b>Total custo</b> / <b>Lucro bruto</b> desses itens está subestimado.
        </div>
      )}

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          <Kpi rot="Total venda (líquido)" val={totais.total_venda} destaque />
          <Kpi rot="Total custo" val={totais.total_custo} />
          <Kpi rot="Lucro bruto" val={totais.lucro_bruto} destaque />
          <Kpi rot="Margem / markup" val={totais.margem} p />
          <Kpi rot="Rentabilidade / markdown" val={totais.rentabilidade} p />
        </div>
      )}

      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <div className="border-b border-border p-pad-xs text-body-sm font-semibold text-fg-muted">{totais ? `${totais.linhas} produto(s)` : 'Informe o período e gere o relatório'}</div>
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Produto</th><th className="p-pad-xs text-right">Qtde</th>
              <th className="p-pad-xs text-right">Custo</th><th className="p-pad-xs text-right">Venda</th>
              <th className="p-pad-xs text-right">Custo un.</th><th className="p-pad-xs text-right">Venda un.</th>
              <th className="p-pad-xs text-right">Lucro</th><th className="p-pad-xs text-right">Margem</th>
              <th className="p-pad-xs text-right">Rentab.</th><th className="p-pad-xs text-right">Acrésc.</th>
              <th className="p-pad-xs text-right">Desc.</th><th className="p-pad-xs">Departamento</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={`${l.idempresa}-${l.idproduto}`} className="border-t border-border">
                <td className="p-pad-xs">{l.descricao}<br /><span className="text-fg-muted">{l.codbarra} · {l.unidade}</span></td>
                <td className="p-pad-xs text-right tabular-nums">{q3(l.qtde)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(l.total_custo)}</td>
                <td className="p-pad-xs text-right tabular-nums font-semibold">{brl(l.total_venda)}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.vrcusto_uni)}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.vrvenda_uni)}</td>
                <td className={`p-pad-xs text-right tabular-nums ${Number(l.lucro) < 0 ? 'text-danger' : ''}`}>{brl(l.lucro)}</td>
                <td className="p-pad-xs text-right tabular-nums">{pct(l.margem)}</td>
                <td className="p-pad-xs text-right tabular-nums">{pct(l.rentabilidade)}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.acrescimo)}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.desc_promocao)}</td>
                <td className="p-pad-xs text-fg-muted">{l.departamento ?? '—'}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={12} className="p-pad-md text-fg-muted">Sem dados.</td></tr>}
          </tbody>
          {totais && linhas.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="p-pad-xs">TOTAL</td>
                <td className="p-pad-xs text-right tabular-nums">{q3(totais.qtde)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(totais.total_custo)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(totais.total_venda)}</td>
                <td /><td />
                <td className="p-pad-xs text-right tabular-nums">{brl(totais.lucro_bruto)}</td>
                <td className="p-pad-xs text-right tabular-nums">{pct(totais.margem)}</td>
                <td className="p-pad-xs text-right tabular-nums">{pct(totais.rentabilidade)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(totais.acrescimo)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(totais.desc_promocao)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
