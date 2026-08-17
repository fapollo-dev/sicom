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

const q3 = (n: unknown) => (n == null ? '' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const brl = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dia = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '—');
// data local do usuário, NÃO o UTC: entre 21h e 24h no Brasil o toISOString() já é o dia seguinte e a janela
// default vinha 1 dia deslocada (o backend resolve o default no fuso do negócio; aqui o campo tem de casar).
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

interface Celula { qtde: number; vrcusto: number; vrvenda: number; vrcustorep: number; qtde_ent?: number; vrcusto_ent?: number }
interface Linha {
  idproduto: number; codbarra?: string; descricao?: string; unidade?: string; fatorcx?: number; fornecedor?: string;
  estoque: number; est_minimo: number; est_maximo: number; dtultent: string | null; qtdeultent: number | null;
  vrcustorep_atual: number | null; celulas: (Celula | null)[];
  total_qtde: number; total_qtde_entrada?: number; dias_com_movimento: number; dias_com_entrada?: number;
  media_dia: number; caixas_giro: number | null; vrcusto_medio: number | null; vrvenda_media: number | null; vrcusto_ent_medio?: number | null;
}
interface Periodo { slot: number; rotulo: string; ini: string; fimIncl: string; dia?: string }
interface Totais { produtos: number; com_giro: number; sem_giro: number; total_qtde: number; total_qtde_entrada: number | null; recebeu_sem_vender: number | null; estoque: number; sem_ultima_entrada: number }
interface Filtro { truncado?: boolean; max_linhas?: number; dataAnalise?: string; periodizacao?: string; de?: string; ate?: string; dias_cobertos?: number; somente_com_movimento?: boolean; unidade?: string; quantidade?: number }
/** linha do modo "Habilita Período": uma faixa só, sem matriz de slots. No ANALÍTICO vem 1 linha por produto×mês/ano. */
interface LinhaPeriodo {
  idproduto: number; codbarra?: string; descricao?: string; unidade?: string; fatorcx?: number; fornecedor?: string;
  mes?: number; // só no modelo ANALÍTICO (nº do mês 1-12 ou o ano, conforme a unidade)
  qtde: number; vrcusto: number; vrvenda: number; vrcustorep: number | null;
  estoque: number; est_minimo: number; est_maximo: number; dtultent: string | null; qtdeultent: number | null;
  media_dia: number | null; caixas_giro: number | null;
}

/**
 * PRÉVIA DO FORNECEDOR / ANÁLISE DE GIRO (FRMRELLISTAPRECOSFORNECEDOR) — corte-1 "15 Dias".
 * Matriz produto × 15 dias: o comprador vê o giro diário de cada item do fornecedor, o saldo, a última entrada e
 * quantas CAIXAS o giro representa — e decide a compra. Produto SEM giro aparece com zero, de propósito (é o que
 * o legado faz e é metade da utilidade: enxergar o que encalhou).
 */
export function PreviaFornecedorPage() {
  const mensagem = useMensagem();
  const [dataAnalise, setDataAnalise] = useState(hoje());
  const [codfor, setCodfor] = useState('');
  const [periodizacao, setPeriodizacao] = useState('15D');
  const [visualizar, setVisualizar] = useState('VENDAS');
  const [ativo, setAtivo] = useState('');
  const [somenteComGiro, setSomenteComGiro] = useState(false);
  const [unidade, setUnidade] = useState('DIAS');
  const [quantidade, setQuantidade] = useState('15');
  const [modelo, setModelo] = useState('SINTETICO');
  const [porPeriodo, setPorPeriodo] = useState<LinhaPeriodo[] | null>(null);
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const [busy, setBusy] = useState(false);

  const gerar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const comum = {
        dataAnalise,
        codfor: codfor ? Number(codfor) : undefined,
        ativo: ativo ? Number(ativo) : undefined,
      };
      if (periodizacao === 'PERIODO') {
        // "Habilita Período": faixa livre, uma linha por produto, só quem teve movimento
        const r = await req<{ linhas: LinhaPeriodo[]; totais: Totais; filtro: Filtro }>(
          '/relatorios/previa-fornecedor/periodo',
          { ...comum, unidade, quantidade: Number(quantidade) || 1, modelo },
        );
        setPorPeriodo(r.linhas); setLinhas([]); setPeriodos([]); setTotais(r.totais); setFiltro(r.filtro);
        if (!r.linhas.length) mensagem.sucesso('Nenhum produto com movimento na faixa.');
        return;
      }
      const r = await req<{ periodos: Periodo[]; linhas: Linha[]; totais: Totais; filtro: Filtro }>(
        '/relatorios/previa-fornecedor/matriz',
        { ...comum, periodizacao, visualizar, somenteComGiro },
      );
      setPorPeriodo(null); setPeriodos(r.periodos); setLinhas(r.linhas); setTotais(r.totais); setFiltro(r.filtro);
      if (!r.linhas.length) mensagem.sucesso('Nenhum produto no filtro (a lista vem de produtos com estoque na empresa).');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const exportar = () => {
    if (!linhas.length) return;
    const cab = ['codbarra', 'descricao', 'unidade', 'estoque', 'minimo', 'maximo', 'ult_entrada', 'qtde_ult_entrada',
      ...periodos.map((p) => (p.ini === p.fimIncl ? p.ini : `${p.ini}_${p.fimIncl}`)), 'total', 'media_dia', 'caixas', 'custo_medio', 'venda_media'];
    // número → vírgula decimal; TEXTO → entre aspas (antes, o replace('.', ',') global virava "LEITE COND, MOÇA"
    // e um ';' na descrição deslocava as colunas do arquivo inteiro).
    const cel = (v: unknown) => (typeof v === 'number' ? String(v).replace('.', ',')
      : v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
    const corpo = linhas.map((l) => [
      l.codbarra ?? '', l.descricao ?? '', l.unidade ?? '', l.estoque, l.est_minimo, l.est_maximo,
      l.dtultent ? String(l.dtultent).slice(0, 10) : '', l.qtdeultent,
      ...periodos.map((_, i) => l.celulas[i]?.qtde ?? null), l.total_qtde, l.media_dia, l.caixas_giro,
      l.vrcusto_medio, l.vrvenda_media,
    ].map(cel).join(';'));
    const blob = new Blob(['﻿' + [cab.join(';'), ...corpo].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `previa-fornecedor-${dataAnalise}.csv`;
    a.click();
  };

  const comEntradas = filtro && (filtro as any).visualizar === 'ENTRADAS_SAIDAS';

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Prévia do Fornecedor — giro por período" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-44"><Field label="Data de &análise" type="date" value={dataAnalise} onChange={(e) => setDataAnalise(e.target.value)} /></div>
        <div className="w-40"><Field label="&Fornecedor (cód.)" value={codfor} onChange={(e) => setCodfor(e.target.value)} placeholder="todos" /></div>
        <div className="w-44"><SelectField label="Perío&do" value={periodizacao} onChange={setPeriodizacao} options={[
          { value: '15D', label: '15 Dias' }, { value: '5D', label: '5 Dias' }, { value: '30D', label: '30 Dias' },
          { value: '5S', label: '5 Semanas' }, { value: '5M', label: '5 Meses' }, { value: '5A', label: '5 Anos' },
          { value: 'ANUAL', label: 'Anual (12 meses)' }, { value: 'PERIODO', label: 'Habilita Período…' },
        ]} /></div>
        {periodizacao === 'PERIODO' && (
          <>
            <div className="w-36"><SelectField label="&Unidade" value={unidade} onChange={(v) => {
              setUnidade(v);
              // fiel a cbPeriodoChange: Dias/Semanas força Sintético (o rádio Modelo desabilita e volta a 0)
              if (v === 'DIAS' || v === 'SEMANAS') setModelo('SINTETICO');
            }} options={[
              { value: 'DIAS', label: 'Dias' }, { value: 'SEMANAS', label: 'Semanas' },
              { value: 'MESES', label: 'Meses' }, { value: 'ANOS', label: 'Anos' },
            ]} /></div>
            <div className="w-28"><Field label="&Qtde" type="number" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} /></div>
            {(unidade === 'MESES' || unidade === 'ANOS') && (
              <div className="w-36"><SelectField label="&Modelo" value={modelo} onChange={setModelo} options={[
                { value: 'SINTETICO', label: 'Sintético' }, { value: 'ANALITICO', label: 'Analítico' },
              ]} /></div>
            )}
          </>
        )}
        <div className="w-52"><SelectField label="&Visualizar" value={visualizar} onChange={setVisualizar} options={[{ value: 'VENDAS', label: 'Vendas' }, { value: 'ENTRADAS_SAIDAS', label: 'Entradas e saídas' }]} /></div>
        <div className="w-56"><SelectField label="Situa&ção" value={ativo} onChange={setAtivo} placeholder="(sem filtro)" options={[
          { value: '1', label: 'Ativo p/ compra = S' }, { value: '2', label: 'Ativo = S' },
          { value: '3', label: 'Ativo p/ compra = N' }, { value: '4', label: 'Ativo = N' },
          { value: '5', label: 'Ativo e ativo p/ compra = S' }, { value: '6', label: 'Ativo e ativo p/ compra = N' },
        ]} /></div>
        <label className="flex items-center gap-1 text-body-sm"><input type="checkbox" checked={somenteComGiro} onChange={(e) => setSomenteComGiro(e.target.checked)} /> Só com giro</label>
        <Button label="&Gerar" variant="soft" disabled={busy} onClick={() => void gerar()} />
        <Button label="&Exportar CSV" variant="ghost" disabled={!linhas.length} onClick={exportar} />
        <small className="w-full text-fg-muted">
          Os períodos terminam na data de análise. A lista sai de <b>produtos com estoque na empresa</b> — item sem
          venda aparece com zero, de propósito: é como se enxerga o que encalhou.
          {filtro?.de && <> Faixa consultada: <b>{dia(filtro.de)}</b> a <b>{dia(filtro.ate)}</b> ({filtro.dias_cobertos} dias);
          a coluna «Méd/dia» divide pelos dias cobertos.</>}
        </small>
      </div>

      {filtro?.truncado && (
        <div className="rounded-radius-md border border-danger bg-bg-surface p-pad-sm text-body-sm text-danger">
          <b>Resultado cortado em {filtro.max_linhas?.toLocaleString('pt-BR')} produtos</b> — os totais cobrem só as
          linhas exibidas. Filtre por fornecedor, departamento ou marca.
        </div>
      )}

      {filtro?.somente_com_movimento && (
        <div className="rounded-radius-md border border-border bg-bg-subtle p-pad-sm text-body-sm text-fg-muted">
          Neste modo o legado só lista <b>quem teve movimento</b> na faixa (o join com o cadastro está dentro da
          soma) — produto sem giro <b>não aparece</b>, ao contrário dos modos de matriz.
        </div>
      )}
      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {[
            { rot: 'Produtos', val: totais.produtos.toLocaleString('pt-BR') },
            { rot: 'Com giro', val: totais.com_giro.toLocaleString('pt-BR'), ac: true },
            { rot: 'Sem giro (encalhe)', val: totais.sem_giro.toLocaleString('pt-BR'), dg: totais.sem_giro > 0 },
            { rot: 'Qtde vendida (15 dias)', val: q3(totais.total_qtde), ac: true },
            ...(comEntradas ? [
              { rot: 'Qtde recebida', val: q3(totais.total_qtde_entrada) },
              // recebeu carga e não vendeu nada: o pior caso p/ o comprador, e ficava escondido enquanto a
              // entrada era contada como "giro".
              { rot: 'Recebeu e não vendeu', val: String(totais.recebeu_sem_vender ?? 0), dg: (totais.recebeu_sem_vender ?? 0) > 0 },
            ] : []),
            { rot: 'Saldo em estoque', val: q3(totais.estoque) },
          ].map((k) => (
            <div key={k.rot} className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.rot}</div>
              <div className={`text-title-sm font-bold tabular-nums ${k.ac ? 'text-accent' : ''} ${(k as any).dg ? 'text-danger' : ''}`}>{k.val}</div>
            </div>
          ))}
        </div>
      )}

      {porPeriodo && (() => {
        // modelo ANALÍTICO (fdMesesAnalitico): 1 linha por produto×mês/ano — ganha a coluna da dimensão
        const analitico = (filtro as any)?.modelo === 'ANALITICO';
        const rotuloMes = (filtro as any)?.unidade === 'ANOS' ? 'Ano' : 'Mês';
        return (
        <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
          <table className="w-full text-body-sm">
            <thead><tr className="text-left text-fg-muted">
              <th className="p-pad-xs">Produto</th>
              {analitico && <th className="p-pad-xs text-right">{rotuloMes}</th>}
              <th className="p-pad-xs text-right">Qtde</th>
              <th className="p-pad-xs text-right">Méd/dia</th><th className="p-pad-xs text-right">Caixas</th>
              <th className="p-pad-xs text-right">Custo méd.</th><th className="p-pad-xs text-right">Venda méd.</th>
              <th className="p-pad-xs text-right">Custo rep.</th><th className="p-pad-xs text-right">Estoque</th>
              <th className="p-pad-xs text-right">Mín/Máx</th><th className="p-pad-xs text-right">Últ. entrada</th>
            </tr></thead>
            <tbody>
              {porPeriodo.map((l) => (
                <tr key={`${l.idproduto}-${l.mes ?? 0}`} className="border-t border-border">
                  <td className="p-pad-xs">{l.descricao}<br /><span className="text-fg-muted">{l.codbarra} · {l.unidade}{l.fatorcx ? ` · cx ${l.fatorcx}` : ''}</span></td>
                  {analitico && <td className="p-pad-xs text-right tabular-nums font-semibold">{l.mes ?? '—'}</td>}
                  <td className="p-pad-xs text-right tabular-nums font-semibold">{q3(l.qtde)}</td>
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted">{l.media_dia == null ? '—' : q3(l.media_dia)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{l.caixas_giro == null ? '—' : q3(l.caixas_giro)}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(l.vrcusto)}</td>
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.vrvenda)}</td>
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.vrcustorep)}</td>
                  <td className={`p-pad-xs text-right tabular-nums ${Number(l.estoque) <= Number(l.est_minimo) ? 'font-semibold text-danger' : ''}`}>{q3(l.estoque)}</td>
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted">{q3(l.est_minimo)}/{q3(l.est_maximo)}</td>
                  <td className="p-pad-xs text-right tabular-nums text-fg-muted whitespace-nowrap">{l.dtultent ? `${dia(l.dtultent)} · ${q3(l.qtdeultent)}` : '—'}</td>
                </tr>
              ))}
              {!porPeriodo.length && <tr><td colSpan={analitico ? 11 : 10} className="p-pad-md text-fg-muted">Nenhum produto com movimento na faixa.</td></tr>}
            </tbody>
          </table>
        </div>
        );
      })()}

      {!porPeriodo && (
      <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="sticky left-0 z-10 bg-bg-surface p-pad-xs">Produto</th>
              <th className="p-pad-xs text-right">Estoque</th>
              <th className="p-pad-xs text-right">Mín/Máx</th>
              <th className="p-pad-xs text-right">Últ. entrada</th>
              {periodos.map((p) => (
                <th key={p.slot} className="p-pad-xs text-right whitespace-nowrap" title={`${p.rotulo} · ${p.ini} a ${p.fimIncl}`}>
                  {p.ini === p.fimIncl ? dia(p.ini) : `${dia(p.ini)}–${dia(p.fimIncl)}`}
                </th>
              ))}
              <th className="p-pad-xs text-right">Total</th>
              <th className="p-pad-xs text-right">Méd/dia</th>
              <th className="p-pad-xs text-right">Caixas</th>
              {/* a ÚNICA coluna monetária do layout Quinzenal do legado (dbdListagemVRCUSTO): média das médias
                  diárias, pulando os dias sem movimento. */}
              <th className="p-pad-xs text-right">Custo méd.</th>
              <th className="p-pad-xs text-right">Venda méd.</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.idproduto} className={`border-t border-border ${l.dias_com_movimento === 0 ? 'bg-bg-subtle' : ''}`}>
                <td className="sticky left-0 z-10 bg-inherit p-pad-xs">
                  {l.descricao}
                  <br /><span className="text-fg-muted">{l.codbarra} · {l.unidade}{l.fatorcx ? ` · cx ${l.fatorcx}` : ''}</span>
                </td>
                <td className={`p-pad-xs text-right tabular-nums ${Number(l.estoque) <= Number(l.est_minimo) ? 'font-semibold text-danger' : ''}`}>{q3(l.estoque)}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{q3(l.est_minimo)}/{q3(l.est_maximo)}</td>
                {/* última entrada é esparsa no dado (12% no golden) → "—", nunca 0 */}
                <td className="p-pad-xs text-right tabular-nums text-fg-muted whitespace-nowrap">
                  {l.dtultent ? `${dia(l.dtultent)} · ${q3(l.qtdeultent)}` : '—'}
                </td>
                {periodos.map((p, i) => {
                  const c = l.celulas[i];
                  return (
                    <td key={p.slot} className="p-pad-xs text-right tabular-nums" title={c ? `custo ${brl(c.vrcusto)} · venda ${brl(c.vrvenda)}${c.qtde_ent ? ` · entrada ${q3(c.qtde_ent)} a ${brl(c.vrcusto_ent)}` : ''}` : undefined}>
                      {c ? (
                        <>
                          <span className={c.qtde ? '' : 'text-fg-muted'}>{q3(c.qtde)}</span>
                          {c.qtde_ent ? <span className="text-accent"> +{q3(c.qtde_ent)}</span> : null}
                        </>
                      ) : <span className="text-fg-muted">·</span>}
                    </td>
                  );
                })}
                <td className="p-pad-xs text-right tabular-nums font-semibold">{q3(l.total_qtde)}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{q3(l.media_dia)}</td>
                <td className="p-pad-xs text-right tabular-nums" title={Number(l.fatorcx) > 1 ? `caixa de ${l.fatorcx}` : 'fator de caixa não cadastrado (1)'}>{l.caixas_giro == null ? '—' : q3(l.caixas_giro)}</td>
                <td className="p-pad-xs text-right tabular-nums">{brl(l.vrcusto_medio)}</td>
                <td className="p-pad-xs text-right tabular-nums text-fg-muted">{brl(l.vrvenda_media)}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={periodos.length + 9} className="p-pad-md text-fg-muted">Informe o filtro e gere a prévia.</td></tr>}
          </tbody>
          {totais && linhas.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="sticky left-0 z-10 bg-bg-surface p-pad-xs">TOTAL</td>
                <td className="p-pad-xs text-right tabular-nums">{q3(totais.estoque)}</td>
                <td /><td />
                {periodos.map((p, i) => (
                  <td key={p.slot} className="p-pad-xs text-right tabular-nums">
                    {q3(linhas.reduce((s, l) => s + (l.celulas[i]?.qtde ?? 0), 0))}
                  </td>
                ))}
                <td className="p-pad-xs text-right tabular-nums">{q3(totais.total_qtde)}</td>
                <td /><td /><td /><td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      )}
    </div>
  );
}
