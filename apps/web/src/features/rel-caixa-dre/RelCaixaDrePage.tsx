import { useState } from 'react';
import { PageHeader } from '@apollosg/design-system';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { CheckboxField } from '../../shared/ui/CheckboxField';
import { LookupField } from '../../shared/ui/LookupField';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
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

const brl = (n: unknown) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

interface Conta { desccodplc: string; descricao: string; pai: string | null; descricao_pai: string | null; pai_principal: string; valor: number }
interface Totais {
  receitas: number; contas_recebidas_sem_conta: number; cartoes_recebidos: number; cheques_recebidos: number;
  despesas: number; resultado: number; custo_mercadoria: number;
}

/** agrupa as contas pelo PAI PRINCIPAL ('1.', '4.'…), que é como o legado monta os blocos da DRE. */
function porBloco(contas: Conta[]) {
  const m = new Map<string, Conta[]>();
  for (const c of contas) {
    const k = c.pai_principal ?? '?';
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(c);
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/**
 * CAIXA D.R.E. (o trAnual do FRMRELATORIOCAIXA) — demonstrativo de caixa por conta gerencial no período: o que entrou,
 * o que saiu (com as despesas RATEADAS por centro de custo) e o resultado.
 */
function AnualDre({ dtini, dtfim }: { dtini: string; dtfim: string }) {
  const mensagem = useMensagem();
  const [receitas, setReceitas] = useState<Conta[]>([]);
  const [despesas, setDespesas] = useState<Conta[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [busy, setBusy] = useState(false);

  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ receitas: Conta[]; despesas: Conta[]; totais: Totais }>(
        '/relatorios/caixa-dre/consultar', { dtini, dtfim },
      );
      setReceitas(r.receitas); setDespesas(r.despesas); setTotais(r.totais);
      if (!r.receitas.length && !r.despesas.length) mensagem.sucesso('Nenhum movimento de caixa no período.');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };

  const Bloco = ({ titulo, contas, extras, cor }: { titulo: string; contas: Conta[]; extras?: [string, number][]; cor: string }) => (
    <div className="flex-1 min-w-80 overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
      <div className={`border-b border-border p-pad-xs text-body-sm font-semibold ${cor}`}>{titulo}</div>
      <table className="w-full text-body-sm">
        <tbody>
          {porBloco(contas).map(([pai, linhas]) => (
            <>
              <tr key={pai} className="border-t border-border bg-bg-subtle">
                <td className="p-pad-xs font-semibold" colSpan={2}>{pai} {linhas[0]?.descricao_pai ?? ''}</td>
                <td className="p-pad-xs text-right tabular-nums font-semibold">
                  {brl(linhas.reduce((s, l) => s + Number(l.valor), 0))}
                </td>
              </tr>
              {linhas.map((c) => (
                <tr key={c.desccodplc} className="border-t border-border">
                  <td className="p-pad-xs tabular-nums text-fg-muted">{c.desccodplc}</td>
                  <td className="p-pad-xs">{c.descricao}</td>
                  <td className="p-pad-xs text-right tabular-nums">{brl(c.valor)}</td>
                </tr>
              ))}
            </>
          ))}
          {(extras ?? []).filter(([, v]) => v !== 0).map(([rot, v]) => (
            <tr key={rot} className="border-t border-border">
              <td className="p-pad-xs text-fg-muted" colSpan={2}>{rot}</td>
              <td className="p-pad-xs text-right tabular-nums">{brl(v)}</td>
            </tr>
          ))}
          {!contas.length && !(extras ?? []).some(([, v]) => v !== 0) && (
            <tr><td className="p-pad-md text-fg-muted" colSpan={3}>Sem movimento.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex flex-col gap-gp-md">
      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
        <small className="w-full text-fg-muted">
          Regime de <b>caixa</b>: conta o que entrou e saiu no período, não o que foi faturado. As despesas são
          <b> rateadas por centro de custo</b> e saem líquidas de juros e acréscimo/desconto.
        </small>
      </div>

      {totais && (
        <div className="flex flex-wrap gap-gp-sm">
          {[
            { rot: 'Receitas', val: totais.receitas, ac: true },
            { rot: 'Despesas', val: totais.despesas },
            { rot: 'Resultado', val: totais.resultado, ac: totais.resultado >= 0, dg: totais.resultado < 0 },
            { rot: 'Custo da mercadoria', val: totais.custo_mercadoria },
          ].map((k) => (
            <div key={k.rot} className="flex-1 min-w-36 rounded-radius-md border border-border bg-bg-surface p-pad-sm">
              <div className="text-body-xs text-fg-muted">{k.rot}</div>
              <div className={`text-title-sm font-bold tabular-nums ${k.ac ? 'text-accent' : ''} ${(k as any).dg ? 'text-danger' : ''}`}>{brl(k.val)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-gp-md">
        <Bloco
          titulo="RECEITAS — o que entrou"
          contas={receitas}
          cor="text-accent"
          extras={totais ? [
            ['1.01. CONTAS RECEBIDAS (título sem conta gerencial)', totais.contas_recebidas_sem_conta],
            ['1.03. CARTÕES RECEBIDOS', totais.cartoes_recebidos],
          ] : []}
        />
        <Bloco titulo="DESPESAS — o que saiu (rateado por centro de custo)" contas={despesas} cor="text-danger" />
      </div>
    </div>
  );
}

type Regime = 'EMISSAO' | 'VENCIMENTO' | 'ANUAL';
type Linha = Record<string, any>;
const MODELOS = ['Totalizado', 'Recursos', 'Recursos totalizado', 'Agrupado Geral'] as const;
const dataBr = (d: unknown) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const sel = 'w-full rounded-radius-sm border border-border bg-bg-surface p-pad-xs text-body-sm';

/** os filtros da tela do legado → o corpo da consulta/impressão (o SetFiltro de uRelatorioCaixa.pas) */
export function corpoCompetencia(f: {
  regime: 'EMISSAO' | 'VENCIMENTO'; dtini: string; dtfim: string; empresas: string; codoperador?: string; codfiscal?: string; codpdv?: string;
  plc: string; tpconta: string; obs: string; modelo: number; ordenacao: number; dataNota: 'DTCONTABIL' | 'DTEMISSAO';
  cmv: boolean; taxasCartao: boolean; notasFiscais: boolean; custoReposicao: boolean; expandido: boolean;
}) {
  const lojas = f.empresas.split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0);
  const n = (v?: string) => (v && Number(v) > 0 ? Number(v) : null);
  return {
    dtini: f.dtini, dtfim: f.dtfim, regime: f.regime, modelo: f.modelo,
    ...(f.modelo === 1 ? { ordenacao: f.ordenacao } : {}),
    ...(lojas.length ? { empresas: lojas } : {}),
    codoperador: n(f.codoperador), codfiscal: n(f.codfiscal), codpdv: n(f.codpdv),
    plc: f.plc.trim() || null, tpconta: f.tpconta === '' ? null : Number(f.tpconta), obs: f.obs.trim() || null,
    cmv: f.cmv, taxasCartao: f.regime === 'EMISSAO' && f.taxasCartao, notasFiscais: f.notasFiscais, custoReposicao: f.custoReposicao,
    ...(f.regime === 'EMISSAO' ? { dataNota: f.dataNota } : {}),
    expandido: (f.modelo === 0 || f.modelo === 2) && f.expandido,
  };
}

/**
 * RELATÓRIO DE CAIXA (FRMRELATORIOCAIXA, uRelatorioCaixa.pas/.dfm). O cbbRelatorios do legado escolhe o modelo: Competência (emissão)
 * e (vencimento) — o livro-caixa por centro de custo (`TRelCompetencia`) com as opções de C.M.V., taxas de cartão e notas fiscais — e o
 * "Anual" (a D.R.E. de caixa). O operador e o fiscal de caixa se excluem (escolher um zera o outro — edtCodOperadorExit/edtFiscalCXExit);
 * as taxas de cartão só na emissão; o campo data das notas só na emissão; a ordenação só no modelo Recursos; "Planos de contas
 * expandidos" só no Totalizado e no Recursos totalizado; o custo de reposição vem marcado (o .dfm). O Imprimir é a opção BTNIMPRIMIR.
 */
export function RelCaixaDrePage() {
  const mensagem = useMensagem();
  const { tem } = useOpcoesDoForm('FRMRELATORIOCAIXA');
  const [regime, setRegime] = useState<Regime>('EMISSAO');
  const [dtini, setDtini] = useState(hoje());
  const [dtfim, setDtfim] = useState(hoje());
  const [empresas, setEmpresas] = useState('');
  const [codoperador, setCodoperador] = useState<string | undefined>();
  const [codfiscal, setCodfiscal] = useState<string | undefined>();
  const [codpdv, setCodpdv] = useState<string | undefined>();
  const [plc, setPlc] = useState('');
  const [tpconta, setTpconta] = useState('');
  const [obs, setObs] = useState('');
  const [modelo, setModelo] = useState(0);
  const [ordenacao, setOrdenacao] = useState(0);
  const [dataNota, setDataNota] = useState<'DTCONTABIL' | 'DTEMISSAO'>('DTCONTABIL');
  const [cmv, setCmv] = useState(false);
  const [taxasCartao, setTaxasCartao] = useState(false);
  const [notasFiscais, setNotasFiscais] = useState(false);
  const [custoReposicao, setCustoReposicao] = useState(true);
  const [expandido, setExpandido] = useState(false);
  const [pesquisandoPlc, setPesquisandoPlc] = useState(false);
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [busy, setBusy] = useState(false);

  const competencia = regime !== 'ANUAL';
  const corpo = () => corpoCompetencia({
    regime: regime === 'VENCIMENTO' ? 'VENCIMENTO' : 'EMISSAO', dtini, dtfim, empresas, codoperador, codfiscal, codpdv, plc, tpconta, obs,
    modelo, ordenacao, dataNota, cmv, taxasCartao, notasFiscais, custoReposicao, expandido,
  });
  const trocarRegime = (r: Regime) => { setRegime(r); if (r !== 'EMISSAO') setTaxasCartao(false); setLinhas(null); };
  const consultar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await req<{ linhas: Linha[] }>('/relatorios/caixa-competencia/consultar', corpo());
      setLinhas(r.linhas);
      if (!r.linhas.length) mensagem.erro('Dados não encontrados com os Filtros informados, Verifique!');
    } catch (e) { mensagem.erro(e); } finally { setBusy(false); }
  };
  const imprimir = () => { imprimirRelatorio('/relatorios/caixa-competencia/impressao', corpo()).catch((e) => mensagem.erro(e)); };
  const credito = (linhas ?? []).reduce((s, l) => s + Number(l.total_credito ?? 0), 0);
  const debito = (linhas ?? []).reduce((s, l) => s + Number(l.total_debito ?? 0), 0);

  return (
    <div className="flex flex-col gap-gp-md p-pad-md">
      <PageHeader title="Relatório de caixa" />

      <div className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="w-56">
          <label className="mb-1 block text-body-sm text-fg-muted" htmlFor="rcx-relatorio">Relatório</label>
          <select id="rcx-relatorio" className={sel} value={regime} onChange={(e) => trocarRegime(e.target.value as Regime)}>
            <option value="EMISSAO">Competencia (emissão)</option>
            <option value="VENCIMENTO">Competencia (vencimento)</option>
            <option value="ANUAL">Anual (D.R.E.)</option>
          </select>
        </div>
        <div className="w-40"><Field label="&Data inicial" type="date" value={dtini} onChange={(e) => setDtini(e.target.value)} /></div>
        <div className="w-40"><Field label="Data &final" type="date" value={dtfim} onChange={(e) => setDtfim(e.target.value)} /></div>
        {competencia && <div className="w-40"><Field label="Empresas (1,2)" value={empresas} onChange={(e) => setEmpresas(e.target.value)} placeholder="esta loja" /></div>}
      </div>

      {competencia ? (
        <>
          <div className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap items-end gap-gp-sm">
              <div className="w-72"><LookupField label="&Operador" recurso="lookup/operadores-caixa" campoCodigo="codigo" descricao="nome" parametros={{ sigla: 'OPE' }}
                value={codoperador ?? null} onChange={(c) => { setCodoperador(c); if (c) setCodfiscal(undefined); }} /></div>
              <div className="w-72"><LookupField label="Fiscal de ca&ixa" recurso="lookup/operadores-caixa" campoCodigo="codigo" descricao="nome" parametros={{ sigla: 'SUP' }}
                value={codfiscal ?? null} onChange={(c) => { setCodfiscal(c); if (c) setCodoperador(undefined); }} /></div>
              <div className="w-64"><LookupField label="&PDV" recurso="lookup/pdvs-da-loja" campoCodigo="numero_pdv" descricao="descricao"
                value={codpdv ?? null} onChange={(c) => setCodpdv(c)} /></div>
            </div>
            <div className="flex flex-wrap items-end gap-gp-sm">
              <div className="w-48" onKeyDown={(e) => { if (e.key === 'F3') { e.preventDefault(); setPesquisandoPlc(true); } }}>
                <Field label="Centro de custo (F3)" value={plc} onChange={(e) => setPlc(e.target.value)} placeholder="ex.: 4.07" />
              </div>
              <div className="w-40">
                <label className="mb-1 block text-body-sm text-fg-muted" htmlFor="rcx-tpconta">Tipo de conta</label>
                <select id="rcx-tpconta" className={sel} value={tpconta} onChange={(e) => setTpconta(e.target.value)}>
                  <option value="" />
                  <option value="0">1 - RECEITA</option>
                  <option value="1">2 - DESPESA</option>
                  <option value="2">3 - NEUTRA</option>
                </select>
              </div>
              <div className="w-72"><Field label="O&bservação" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
            </div>
            <div className="flex flex-wrap items-start gap-gp-md">
              <fieldset className="flex flex-col gap-gp-xs" role="radiogroup" aria-label="Modelo do relatório">
                <legend className="text-body-sm text-fg-muted">Relatório</legend>
                {MODELOS.map((m, i) => (
                  <label key={m} className="flex items-center gap-gp-xs text-body-sm">
                    <input type="radio" name="rcx-modelo" checked={modelo === i} onChange={() => setModelo(i)} />{m}
                  </label>
                ))}
              </fieldset>
              {modelo === 1 && (
                <fieldset className="flex flex-col gap-gp-xs" role="radiogroup" aria-label="Ordenação por centro de custo">
                  <legend className="text-body-sm text-fg-muted">Ordenação por centro de custo</legend>
                  {['Código', 'Descrição'].map((m, i) => (
                    <label key={m} className="flex items-center gap-gp-xs text-body-sm">
                      <input type="radio" name="rcx-ordem" checked={ordenacao === i} onChange={() => setOrdenacao(i)} />{m}
                    </label>
                  ))}
                </fieldset>
              )}
              {regime === 'EMISSAO' && (
                <fieldset className="flex flex-col gap-gp-xs" role="radiogroup" aria-label="Campo data para filtro de notas">
                  <legend className="text-body-sm text-fg-muted">Campo data para filtro de notas</legend>
                  {([['DTCONTABIL', 'Data contábil'], ['DTEMISSAO', 'Data de emissão']] as const).map(([v, m]) => (
                    <label key={v} className="flex items-center gap-gp-xs text-body-sm">
                      <input type="radio" name="rcx-datanota" checked={dataNota === v} onChange={() => setDataNota(v)} />{m}
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="flex flex-col gap-gp-xs">
                <CheckboxField label="Utilizar C.M.V no relatório" value={cmv ? 'S' : 'N'} onChange={(v) => setCmv(v === 'S')} />
                <CheckboxField label="Utilizar taxas de cartão no relatório" value={taxasCartao ? 'S' : 'N'} disabled={regime !== 'EMISSAO'} onChange={(v) => setTaxasCartao(v === 'S')} />
                <CheckboxField label="Utilizar valores de notas fiscais no relatório" value={notasFiscais ? 'S' : 'N'} onChange={(v) => setNotasFiscais(v === 'S')} />
                <CheckboxField label="Utilizar custo de reposição" value={custoReposicao ? 'S' : 'N'} onChange={(v) => setCustoReposicao(v === 'S')} />
                {(modelo === 0 || modelo === 2) && (
                  <CheckboxField label="Planos de contas expandidos" value={expandido ? 'S' : 'N'} onChange={(v) => setExpandido(v === 'S')} />
                )}
              </div>
            </div>
            <div className="flex gap-gp-sm">
              <Button label="&Consultar" variant="soft" disabled={busy} onClick={() => void consultar()} />
              <Button label="Imprimir" variant="filled" disabled={!tem('BTNIMPRIMIR')} onClick={imprimir} />
            </div>
          </div>

          {linhas && linhas.length > 0 && (
            <div className="overflow-x-auto rounded-radius-md border border-border bg-bg-surface">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="bg-bg-subtle text-left">
                    {['Data', 'Centro de custo', 'Descrição', 'Recurso', 'Observação', 'Parceiro', 'NF', 'Crédito', 'Débito'].map((t) => (
                      <th key={t} className={`p-pad-xs ${t === 'Crédito' || t === 'Débito' ? 'text-right' : ''}`}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-pad-xs tabular-nums">{dataBr(l.data)}</td>
                      <td className="p-pad-xs tabular-nums">{l.desccodplc}</td>
                      <td className="p-pad-xs">{l.descricao}</td>
                      <td className="p-pad-xs">{l.tiporecurso}</td>
                      <td className="p-pad-xs">{l.obs}</td>
                      <td className="p-pad-xs">{l.razao}</td>
                      <td className="p-pad-xs tabular-nums">{l.nronf}</td>
                      <td className="p-pad-xs text-right tabular-nums">{brl(l.total_credito)}</td>
                      <td className="p-pad-xs text-right tabular-nums">{brl(l.total_debito)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border font-semibold">
                    <td className="p-pad-xs" colSpan={7}>{linhas.length} lançamento(s) · saldo {brl(credito + debito)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{brl(credito)}</td>
                    <td className="p-pad-xs text-right tabular-nums">{brl(debito)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {pesquisandoPlc && (
            <Pesquisa resourcePath="lookup/plc" onSelecionar={(r) => { setPlc(String(r.codigo_extenso ?? r.desccodplc ?? '')); setPesquisandoPlc(false); }}
              onFechar={() => setPesquisandoPlc(false)} />
          )}
        </>
      ) : (
        <AnualDre dtini={dtini} dtfim={dtfim} />
      )}
    </div>
  );
}
