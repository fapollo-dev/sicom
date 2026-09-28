import { useState } from 'react';
import { SelectField } from '../../shared/ui/SelectField';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { relatorioAgenda, type RelAgendaResposta, type TipoRelAgenda } from './agendaPromocaoApi';

const TIPOS: Array<{ value: TipoRelAgenda; label: string }> = [
  { value: 'vendidos', label: 'Produtos vendidos no período' },
  { value: 'tv', label: 'Produtos vendidos no período oferta em TV' },
  { value: 'radio', label: 'Produtos vendidos no período oferta em rádio' },
  { value: 'tabloide', label: 'Produtos vendidos no período oferta em tabloide' },
  { value: 'interno', label: 'Produtos vendidos no período oferta interna' },
  { value: 'totais', label: 'Produtos vendidos no período totais' },
  { value: 'totais-itens', label: 'Produtos vendidos no período totais com itens' },
  { value: 'por-loja', label: 'Produtos vendidos por loja' },
  { value: 'fim-promocao', label: 'Produtos que sairão da promoção' },
  { value: 'inativos', label: 'Produtos inativos' },
];

const brl = (v: unknown) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qtd = (v: unknown) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const txt = (v: unknown) => (v == null ? '' : String(v));
const dia = (s?: string) => (s ? s.split('-').reverse().join('/') : '');

type Col = { t: string; k: string; f?: (v: unknown) => string; n?: boolean };
const COLS: Partial<Record<TipoRelAgenda, Col[]>> = {
  vendidos: [
    { t: 'Cód. barras', k: 'codbarra' }, { t: 'Descrição', k: 'descricao' }, { t: 'UN', k: 'unidade' },
    { t: 'Qtde', k: 'qtde', f: qtd, n: true }, { t: 'Vr. venda un.', k: 'vrvenda_uni', f: brl, n: true }, { t: 'Vr. custo un.', k: 'vrcusto_uni', f: brl, n: true },
    { t: 'Acréscimo', k: 'acrescimo', f: brl, n: true }, { t: 'Desconto', k: 'desc_promocao', f: brl, n: true },
    { t: 'Total venda', k: 'total_venda', f: brl, n: true }, { t: 'Total custo', k: 'total_custo', f: brl, n: true }, { t: 'Margem %', k: 'margem', f: brl, n: true },
  ],
  totais: [
    { t: 'Qtde', k: 'qtde', f: qtd, n: true }, { t: 'Venda', k: 'vr_total_venda', f: brl, n: true }, { t: 'Diferença p/ o preço de venda', k: 'vr_total_dif_venda_promo', f: brl, n: true },
    { t: 'Venda em promoção', k: 'vr_total_venda_promo', f: brl, n: true }, { t: '% diferença', k: 'vr_total_perc_dif_venda_promo', f: brl, n: true },
  ],
  'fim-promocao': [
    { t: 'Agenda', k: 'codagenda' }, { t: 'Depto', k: 'depto' }, { t: 'Cód. barras', k: 'codbarra' }, { t: 'Descrição', k: 'descricao' }, { t: 'UN', k: 'unidade' },
    { t: 'Vr. venda', k: 'vrvenda', f: brl, n: true }, { t: 'Vr. promoção', k: 'vlrpromocao', f: brl, n: true }, { t: 'Preço 2', k: 'preco2', f: brl, n: true },
  ],
  inativos: [
    { t: 'Depto', k: 'depto' }, { t: 'Cód. barras', k: 'codbarra' }, { t: 'Descrição', k: 'descricao' }, { t: 'UN', k: 'unidade' },
    { t: 'Vr. venda', k: 'vrvenda', f: brl, n: true }, { t: 'Vr. promoção', k: 'vlrpromocao', f: brl, n: true },
    { t: 'TV', k: 'tv' }, { t: 'Rádio', k: 'radio' }, { t: 'Tabloide', k: 'tabloide' }, { t: 'Interno', k: 'interno' }, { t: 'Grupo', k: 'atualizacao_grupo' },
  ],
};
COLS.tv = COLS.radio = COLS.tabloide = COLS.interno = COLS.vendidos;
COLS['totais-itens'] = [{ t: 'Cód. barras', k: 'codbarra' }, { t: 'Descrição', k: 'descricao' }, ...(COLS.totais ?? [])];

function Tabela({ cols, linhas }: { cols: Col[]; linhas: Array<Record<string, unknown>> }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-border text-left">{cols.map((c) => <th key={c.k} className={`p-pad-xs ${c.n ? 'text-right' : ''}`}>{c.t}</th>)}</tr></thead>
      <tbody>
        {linhas.map((l, i) => (
          <tr key={i} className="border-b border-border/50">
            {cols.map((c) => <td key={c.k} className={`p-pad-xs ${c.n ? 'text-right tabular-nums' : ''}`}>{(c.f ?? txt)(l[c.k])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * RELATÓRIOS DA AGENDA (menu "Outros" do uCadAgendaPromocao). O período abre com as datas da agenda (frmPeriodoRelAgenda);
 * as horas são as do início/fim da agenda; no "fim da promoção" só a data final vale. Imprime a folha pelo navegador.
 */
export function AgendaPromocaoRelatorios({ codagenda }: { codagenda: number }) {
  const mensagem = useMensagem();
  const [tipo, setTipo] = useState<TipoRelAgenda>('vendidos');
  const [dtini, setDtini] = useState('');
  const [dtfim, setDtfim] = useState('');
  const [res, setRes] = useState<RelAgendaResposta | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const gerar = async () => {
    setOcupado(true);
    try {
      const r = await relatorioAgenda(codagenda, { tipo, dtini: tipo === 'inativos' || tipo === 'fim-promocao' ? undefined : dtini, dtfim: tipo === 'inativos' ? undefined : dtfim });
      setRes(r);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  const lojas = res?.tipo === 'por-loja' ? [...new Set((res.porProduto ?? []).flatMap((p) => Object.keys(p.lojas)))].sort((a, b) => Number(a) - Number(b)) : [];
  return (
    <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
      <div className="flex flex-wrap items-end gap-gp-sm print:hidden">
        <div className="w-96"><SelectField label="&Relatório" value={tipo} onChange={(v) => { setTipo(v as TipoRelAgenda); setRes(null); }} options={TIPOS} /></div>
        {tipo !== 'inativos' && tipo !== 'fim-promocao' && <div className="w-40"><Field label="Data &inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>}
        {tipo !== 'inativos' && <div className="w-40"><Field label={tipo === 'fim-promocao' ? 'Data fim promoção' : 'Data &final'} type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>}
        <Button label={ocupado ? 'Gerando…' : '&Gerar'} variant="soft" disabled={ocupado} onClick={() => void gerar()} />
        {res && <Button label="Im&primir" variant="ghost" onClick={() => window.print()} />}
      </div>
      {res && (
        <div className="flex flex-col gap-gp-sm overflow-x-auto">
          <div className="text-sm">
            <strong>{TIPOS.find((t) => t.value === res.tipo)?.label}</strong> — agenda {res.agenda.codagenda} {res.agenda.nomepromo ?? ''}
            {res.dtini && <> · {dia(res.dtini)} {res.horaIni} a {dia(res.dtfim)} {res.horaFim}</>}
            {res.data && <> · fim em {dia(res.data)}</>}
            {res.empresas && <> · loja(s) {res.empresas.join(', ')}</>}
          </div>
          {!res.linhas.length && !(res.porProduto ?? []).length ? (
            <small className="text-fg-muted">Nenhum registro encontrado!</small>
          ) : res.tipo === 'por-loja' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left"><th className="p-pad-xs">Cód. barras</th><th className="p-pad-xs">Descrição</th>
                  {lojas.map((l) => <th key={l} className="p-pad-xs text-right" colSpan={3}>Loja {l} — qtde · custo · venda</th>)}</tr>
              </thead>
              <tbody>
                {(res.porProduto ?? []).map((p) => (
                  <tr key={p.codproduto} className="border-b border-border/50">
                    <td className="p-pad-xs">{txt(p.codbarra)}</td><td className="p-pad-xs">{txt(p.descricao)}</td>
                    {lojas.map((l) => [
                      <td key={`${l}q`} className="p-pad-xs text-right tabular-nums">{qtd(p.lojas[l]?.qtde ?? 0)}</td>,
                      <td key={`${l}c`} className="p-pad-xs text-right tabular-nums">{brl(p.lojas[l]?.vrcusto ?? 0)}</td>,
                      <td key={`${l}v`} className="p-pad-xs text-right tabular-nums">{brl(p.lojas[l]?.vrvenda ?? 0)}</td>,
                    ])}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Tabela cols={COLS[res.tipo] ?? []} linhas={res.linhas} />
          )}
          {!!res.departamentos?.length && (
            <div className="max-w-md">
              <div className="text-sm font-semibold">Por departamento</div>
              <Tabela cols={[{ t: 'Departamento', k: 'depto', f: (v) => txt(v ?? 'DEPTO NAO INFORMADO') }, { t: 'Total venda', k: 'vr_total_venda', f: brl, n: true }]} linhas={res.departamentos} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
