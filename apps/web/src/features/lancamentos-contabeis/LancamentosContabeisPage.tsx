import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { gradeLayoutService } from '../../shared/grade/savedViewsService';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Linha = Record<string, unknown> & { coddiario: number };
interface Resultado { linhas: Linha[]; totais: { registros: number; debito: number; credito: number }; truncado: boolean }
interface Campo { campo: string; tipo: 'numero' | 'texto' | 'data' }
interface Diferenca { codlote: number; datalan: string; valor_debito: number; valor_credito: number; diferenca: number }
/** o nó escolhido na árvore de datas: ano, mês ou dia */
interface No { tipo: 'A' | 'M' | 'D'; ano: number; mes?: number; dia?: number }

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const p2 = (n: number) => String(n).padStart(2, '0');
const ultimoDia = (ano: number, mes: number) => new Date(ano, mes, 0).getDate();
/** o `GetFiltroData` do nó: o dia, o mês inteiro ou o ano inteiro */
const periodo = (n: No): { dataIni: string; dataFim: string } => {
  if (n.tipo === 'D') { const d = `${n.ano}-${p2(n.mes!)}-${p2(n.dia!)}`; return { dataIni: d, dataFim: d }; }
  if (n.tipo === 'M') return { dataIni: `${n.ano}-${p2(n.mes!)}-01`, dataFim: `${n.ano}-${p2(n.mes!)}-${p2(ultimoDia(n.ano, n.mes!))}` };
  return { dataIni: `${n.ano}-01-01`, dataFim: `${n.ano}-12-31` };
};
const descricaoNo = (n: No) => (n.tipo === 'D' ? `do dia ${p2(n.dia!)}/${p2(n.mes!)}/${n.ano}` : n.tipo === 'M' ? `de ${MESES[n.mes! - 1]} de ${n.ano}` : `de ${n.ano}`);

/** o `MontaComboOperacao` do legado (com "Contido em"): texto × número/data */
const OPERACOES: Record<Campo['tipo'], Array<[string, string]>> = {
  texto: [['=', 'Igual a'], ['<>', 'Diferente de'], ['comeca', 'Começado com'], ['termina', 'Terminado com'], ['contem', 'Em Qualquer Lugar'], ['em', 'Contido em']],
  numero: [['=', 'Igual a'], ['<>', 'Diferente de'], ['entre', 'Entre'], ['>', 'Maior que'], ['<', 'Menor que'], ['em', 'Contido em']],
  data: [['=', 'Igual a'], ['<>', 'Diferente de'], ['entre', 'Entre'], ['>', 'Maior que'], ['<', 'Menor que'], ['em', 'Contido em']],
};
/** o nome do campo como o combo do legado mostra (`FormatFirstCharOfString`) */
const rotuloCampo = (c: string) => c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();

/** as colunas da grade: os campos do `SQL_DIARIO` */
const COLUNAS: Array<{ c: string; t: string; w?: number; fmt?: 'moeda' | 'data' }> = [
  { c: 'coddiario', t: 'Código', w: 90 }, { c: 'datalan', t: 'Data', w: 100, fmt: 'data' }, { c: 'contadebito', t: 'Conta débito', w: 110 },
  { c: 'contacredito', t: 'Conta crédito', w: 110 }, { c: 'valor', t: 'Valor', w: 120, fmt: 'moeda' }, { c: 'documento', t: 'Documento', w: 120 },
  { c: 'tipodoc', t: 'Tipo doc.', w: 110 }, { c: 'codhist', t: 'Cód. hist.', w: 90 }, { c: 'deschist', t: 'Histórico', w: 280 },
  { c: 'complemento', t: 'Complemento', w: 140 }, { c: 'desc_conta_debito', t: 'Descrição conta débito', w: 220 },
  { c: 'codiexpandido_deb', t: 'Expandido débito', w: 130 }, { c: 'desc_conta_credito', t: 'Descrição conta crédito', w: 220 },
  { c: 'codiexpandido_cre', t: 'Expandido crédito', w: 130 }, { c: 'origem', t: 'Origem', w: 260 }, { c: 'operacao', t: 'Operação', w: 90 },
  { c: 'codcc', t: 'Centro de custo', w: 110 }, { c: 'codempresa', t: 'Empresa', w: 80 }, { c: 'cod_interno_debito', t: 'Cód. interno débito', w: 130 },
  { c: 'cod_interno_credito', t: 'Cód. interno crédito', w: 130 }, { c: 'codorigem', t: 'Cód. origem', w: 100 }, { c: 'idorigem', t: 'ID origem', w: 100 },
];
const fmt = (v: unknown, f?: 'moeda' | 'data') => (f === 'moeda' ? (v == null ? '' : moeda(v)) : f === 'data' ? dataBr(v) : v == null ? '' : String(v));

/**
 * LANÇAMENTOS CONTÁBEIS (`FRMRELLANCAMENTOSCONTABEIS`, `UFrmRelLancamentosContabeis.pas`). Dossiê: `uRelLancamentosContabeis.md`.
 *
 * O razão por lançamento como o legado: a ÁRVORE DE DATAS (ano anterior e atual; o dia com lançamento em verde, o sem em vermelho; a tela
 * abre no dia de hoje e cada clique filtra), as origens e as empresas marcadas, o "somente partidas dobradas" (que isola as linhas de UM
 * LADO SÓ), o filtro auxiliar sobre qualquer coluna, e o menu: detalhar o documento, totais débito × crédito, diferenças por lote,
 * exportar e importar lançamentos.
 */
export function LancamentosContabeisPage() {
  const mensagem = useMensagem();
  const [arvore, setArvore] = useState<{ hoje: string; anos: number[]; datas: string[] } | null>(null);
  const [no, setNo] = useState<No | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [origens, setOrigens] = useState<Array<{ codorigem: number; descorigem: string; marcada: boolean }>>([]);
  const [empresas, setEmpresas] = useState<Array<{ cod: number; marcada: boolean }>>([]);
  const [campos, setCampos] = useState<Campo[]>([]);
  const [umLado, setUmLado] = useState(false);
  const [aux, setAux] = useState({ campo: '', operador: '=', valor: '', valor2: '' });
  const [lote, setLote] = useState<number | null>(null);
  const [res, setRes] = useState<Resultado | null>(null);
  const [selecionada, setSelecionada] = useState<Linha | null>(null);
  const [diferencas, setDiferencas] = useState<Diferenca[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const req = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
    handle401(r);
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
      throw Object.assign(new Error(env.code), { envelope: env });
    }
    return (await r.json()) as T;
  }, []);

  // `CarregamentoInicial`: a árvore, as origens e as empresas (todas marcadas), o nó de hoje
  const carregar = useCallback(async () => {
    try {
      const [a, o, e, c] = await Promise.all([
        req<{ hoje: string; anos: number[]; datas: string[] }>('/contabil/lancamentos/arvore'),
        req<Array<{ codorigem: number; descorigem: string }>>('/contabil/lancamentos/origens'),
        req<number[]>('/contabil/lancamentos/empresas'),
        req<Campo[]>('/contabil/lancamentos/campos'),
      ]);
      setArvore(a);
      setOrigens(o.map((x) => ({ ...x, marcada: true })));
      setEmpresas(e.map((cod) => ({ cod, marcada: true })));
      setCampos(c);
      const [ano, mes, dia] = a.hoje.split('-').map(Number);
      setAbertos(new Set([`A${ano}`, `M${ano}-${mes}`]));
      setLote(null);
      setNo({ tipo: 'D', ano, mes, dia });
    } catch (e) { mensagem.erro(e); }
  }, [req, mensagem]);
  useEffect(() => { void carregar(); }, [carregar]);

  const consulta = useCallback((n: No, opcoes: { lote?: number | null } = {}) => {
    const q = new URLSearchParams(periodo(n));
    const lt = opcoes.lote !== undefined ? opcoes.lote : lote;
    if (lt) q.set('lote', String(lt));
    else {
      const marcadasO = origens.filter((o) => o.marcada);
      if (!marcadasO.length) q.set('nenhumaOrigem', 'true');
      else if (marcadasO.length < origens.length) q.set('origens', marcadasO.map((o) => o.codorigem).join(','));
      const marcadasE = empresas.filter((x) => x.marcada);
      if (!marcadasE.length) q.set('nenhumaEmpresa', 'true');
      else if (marcadasE.length < empresas.length) q.set('empresas', marcadasE.map((x) => x.cod).join(','));
      if (umLado) q.set('somenteUmLado', 'true');
    }
    if (aux.campo) {
      q.set('campo', aux.campo); q.set('operador', aux.operador); q.set('valor', aux.valor);
      if (aux.operador === 'entre') q.set('valor2', aux.valor2);
    }
    return q;
  }, [origens, empresas, umLado, aux, lote]);

  const filtrar = useCallback(async (n: No | null = no, opcoes: { lote?: number | null } = {}) => {
    if (!n) return;
    setOcupado(true);
    try {
      setRes(await req<Resultado>(`/contabil/lancamentos?${consulta(n, opcoes)}`));
      setSelecionada(null);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  }, [no, consulta, req, mensagem]);

  // o `MtbDatasAfterScroll`: escolher um nó da árvore já filtra
  useEffect(() => { if (no) void filtrar(no, { lote: null }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [no]);
  const escolher = (n: No) => { setLote(null); setNo(n); };

  const comMovimento = useMemo(() => new Set(arvore?.datas ?? []), [arvore]);
  const mesComMov = (ano: number, mes: number) => (arvore?.datas ?? []).some((d) => d.startsWith(`${ano}-${p2(mes)}-`));
  const anoComMov = (ano: number) => (arvore?.datas ?? []).some((d) => d.startsWith(`${ano}-`));
  const alternar = (k: string) => setAbertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const igual = (a: No | null, b: No) => !!a && a.tipo === b.tipo && a.ano === b.ano && a.mes === b.mes && a.dia === b.dia;
  const itemArvore = (n: No, rotulo: string, mov: boolean, chave?: string) => (
    <div className="flex items-center gap-gp-xs">
      {chave ? <button type="button" className="w-4 text-fg-muted" onClick={() => alternar(chave)}>{abertos.has(chave) ? '▾' : '▸'}</button> : <span className="w-4" />}
      <button type="button" onClick={() => escolher(n)}
        className={`rounded px-1 text-left font-semibold ${mov ? 'text-fg-success' : 'text-fg-danger'} ${igual(no, n) ? 'bg-bg-selected' : ''}`}>{rotulo}</button>
    </div>
  );

  const detalhar = async (l: Linha | null = selecionada) => {
    if (!l) { mensagem.erro('Nenhum registro está selecionado para detalhar.'); return; }
    try {
      const d = await req<{ tipo: string; codigo: number; rota: string | null }>(`/contabil/lancamentos/${l.coddiario}/origem`);
      if (d.rota) window.open(d.rota, '_blank');
      else mensagem.sucesso(`Documento de origem: ${d.tipo === 'CHEQUE' ? 'cheque' : 'redução Z'} nº ${d.codigo}.`);
    } catch (e) { mensagem.erro(e); }
  };

  // `MniTotaisDebitoCreditoClick`
  const totais = () => {
    if (!res) return;
    mensagem.sucesso(`Total débito:  ${moeda(res.totais.debito)}\nTotal crédito: ${moeda(res.totais.credito)}`);
  };

  // `MniDiferencasDebitoCreditoClick`: as diferenças do período do nó; o lote escolhido vira o filtro
  const abrirDiferencas = async () => {
    if (!no) return;
    try { setDiferencas(await req<Diferenca[]>(`/contabil/lancamentos/diferencas?${new URLSearchParams(periodo(no))}`)); } catch (e) { mensagem.erro(e); }
  };
  const escolherLote = (codlote: number) => { setDiferencas(null); setLote(codlote); void filtrar(no, { lote: codlote }); };

  // as exportações: a grade (o "Excel" do legado exporta o grid) e o conjunto inteiro (o "CSV", `CriarCsv(MemDiario…)`)
  const exportarGrade = () => res && exportarGradeCsv(res.linhas, COLUNAS.map((c) => ({ titulo: c.t, valor: (l: Linha) => fmt(l[c.c], c.fmt) })), 'LancamentosContabeis');
  const exportarCsv = () => res && exportarGradeCsv(res.linhas, COLUNAS.map((c) => ({ titulo: c.c.toUpperCase(), valor: (l: Linha) => (l[c.c] as string | number | null) ?? '' })), 'GET_DIARIO');

  // `MniImportarArquivoClick`
  const importar = async (file: File | undefined) => {
    if (!file) { mensagem.erro('Selecione um arquivo txt para importar.'); return; }
    try {
      const conteudo = await file.text();
      await req('/contabil/lancamentos/importar', { method: 'POST', body: JSON.stringify({ conteudo }) });
      mensagem.sucesso('Arquivo importado com sucesso.');
      await carregar();
    } catch (e) { mensagem.erro(e); } finally { if (arquivo.current) arquivo.current.value = ''; }
  };

  const tipoAux = campos.find((c) => c.campo === aux.campo)?.tipo ?? 'texto';
  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => COLUNAS.map((c, i) => ({
    field: c.c, headerName: c.t, type: 'text', width: c.w, isPrimary: i === 0, valueGetter: (l: Linha) => fmt(l[c.c], c.fmt),
  })) as DataTableColumnDef<Linha>[], []);

  const checklist = (titulo: string, itens: Array<{ k: string; rotulo: string; marcada: boolean }>, marcar: (k: string | null, v: boolean) => void) => (
    <section className="rounded-radius-md border border-border bg-bg-surface p-pad-sm">
      <div className="mb-gp-xs flex items-center justify-between text-body-sm font-semibold">
        {titulo}
        <span className="flex gap-gp-xs">
          <Button label="Marcar todos" variant="ghost" onClick={() => marcar(null, true)} />
          <Button label="Desmarcar todos" variant="ghost" onClick={() => marcar(null, false)} />
        </span>
      </div>
      <div className="max-h-48 overflow-y-auto text-body-sm">
        {itens.map((i) => (
          <label key={i.k} className="flex items-center gap-gp-xs"><input type="checkbox" checked={i.marcada} onChange={(e) => marcar(i.k, e.target.checked)} />{i.rotulo}</label>
        ))}
      </div>
    </section>
  );

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Lançamentos contábeis" />
      <div className="flex flex-col gap-gp-md lg:flex-row">
        {/* a árvore de datas (`DtvDatas`) */}
        <aside className="rounded-radius-md border border-border bg-bg-surface p-pad-sm text-body-sm lg:w-64">
          <div className="mb-gp-xs flex items-center justify-between font-semibold">Datas <Button label="Atualizar datas" variant="ghost" onClick={() => void carregar()} /></div>
          <div className="max-h-[32rem] overflow-y-auto">
            {(arvore?.anos ?? []).map((ano) => (
              <div key={ano}>
                {itemArvore({ tipo: 'A', ano }, String(ano), anoComMov(ano), `A${ano}`)}
                {abertos.has(`A${ano}`) && MESES.map((nome, k) => (
                  <div key={nome} className="ml-4">
                    {itemArvore({ tipo: 'M', ano, mes: k + 1 }, nome, mesComMov(ano, k + 1), `M${ano}-${k + 1}`)}
                    {abertos.has(`M${ano}-${k + 1}`) && Array.from({ length: ultimoDia(ano, k + 1) }, (_, d) => d + 1).map((dia) => (
                      <div key={dia} className="ml-4">
                        {itemArvore({ tipo: 'D', ano, mes: k + 1, dia }, `${p2(dia)}/${p2(k + 1)}/${ano}`, comMovimento.has(`${ano}-${p2(k + 1)}-${p2(dia)}`))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-gp-md">
          <div className="grid gap-gp-md md:grid-cols-2">
            {checklist('Origem do lançamento', origens.map((o) => ({ k: String(o.codorigem), rotulo: o.descorigem, marcada: o.marcada })),
              (k, v) => setOrigens((os) => os.map((o) => (k == null || String(o.codorigem) === k ? { ...o, marcada: v } : o))))}
            {checklist('Empresas', empresas.map((x) => ({ k: String(x.cod), rotulo: String(x.cod), marcada: x.marcada })),
              (k, v) => setEmpresas((es) => es.map((x) => (k == null || String(x.cod) === k ? { ...x, marcada: v } : x))))}
          </div>

          <section className="flex flex-wrap items-end gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-sm text-body-sm">
            <label className="flex items-center gap-gp-xs" title="Lista só as linhas com uma das contas em branco (débito sem crédito ou crédito sem débito)">
              <input type="checkbox" checked={umLado} onChange={(e) => setUmLado(e.target.checked)} /> Somente partidas dobradas (só de um lado)
            </label>
            {/* o filtro auxiliar (`grpFiltroAuxiliar`) */}
            <label className="flex flex-col gap-gp-xs">Campo
              <select className="rounded border border-border px-1 py-1" value={aux.campo} onChange={(e) => setAux({ ...aux, campo: e.target.value, operador: '=' })}>
                <option value="">Nenhum</option>
                {[...campos].sort((a, b) => a.campo.localeCompare(b.campo)).map((c) => <option key={c.campo} value={c.campo}>{rotuloCampo(c.campo)}</option>)}
              </select>
            </label>
            {aux.campo && (
              <>
                <label className="flex flex-col gap-gp-xs">Operação
                  <select className="rounded border border-border px-1 py-1" value={aux.operador} onChange={(e) => setAux({ ...aux, operador: e.target.value })}>
                    {OPERACOES[tipoAux].map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-gp-xs">Valor
                  <input className="rounded border border-border px-1 py-1" type={tipoAux === 'data' && aux.operador !== 'em' ? 'date' : 'text'} value={aux.valor} onChange={(e) => setAux({ ...aux, valor: e.target.value })} />
                </label>
                {aux.operador === 'entre' && (
                  <label className="flex flex-col gap-gp-xs">e
                    <input className="rounded border border-border px-1 py-1" type={tipoAux === 'data' ? 'date' : 'text'} value={aux.valor2} onChange={(e) => setAux({ ...aux, valor2: e.target.value })} />
                  </label>
                )}
              </>
            )}
            <Button label="&Filtrar" disabled={ocupado || !no} onClick={() => { setLote(null); void filtrar(no, { lote: null }); }} />
            <Button label="&Detalhar" variant="soft" disabled={!selecionada} onClick={() => void detalhar()} />
            <Button label="Totais débito/crédito" variant="ghost" disabled={!res} onClick={totais} />
            <Button label="Diferenças débito × crédito" variant="ghost" disabled={!no} onClick={() => void abrirDiferencas()} />
            <Button label="Exportar Excel" variant="ghost" disabled={!res} onClick={exportarGrade} />
            <Button label="Exportar CSV" variant="ghost" disabled={!res} onClick={exportarCsv} />
            <Button label="Importar arquivo" variant="ghost" onClick={() => arquivo.current?.click()} />
            <input ref={arquivo} type="file" accept=".txt" className="hidden" onChange={(e) => void importar(e.target.files?.[0])} />
          </section>

          {res && (
            <>
              <p className="text-body-sm text-fg-muted">
                Lançamentos {no ? descricaoNo(no) : ''}{lote ? ` · lote ${lote}` : ''} · Registros: {res.totais.registros}
                {res.truncado ? ' · a consulta passou de 50.000 lançamentos: refine pela árvore (mês ou dia) ou pelo filtro auxiliar.' : ''}
              </p>
              <div onDoubleClick={() => void detalhar()}>
                <DataTable persistId="lancamentos-contabeis" savedViewsService={gradeLayoutService} rows={res.linhas} columns={cols}
                  getRowId={(l: Linha) => String(l.coddiario)} onRowClick={(l: Linha) => setSelecionada(l)} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* `TFrmDiferencasDebitoCredito` */}
      {diferencas && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-pad-md" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-radius-md bg-bg-surface p-pad-md">
            <h3 className="mb-gp-sm text-body-lg font-semibold">Diferenças entre débito e crédito</h3>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-body-sm tabular-nums">
                <thead><tr className="text-fg-muted"><th className="text-left">Lote</th><th className="text-left">Data</th><th className="text-right">Débito</th><th className="text-right">Crédito</th><th className="text-right">Diferença</th><th /></tr></thead>
                <tbody>
                  {diferencas.map((d) => (
                    <tr key={`${d.codlote}-${d.datalan}`}>
                      <td>{d.codlote}</td><td>{dataBr(d.datalan)}</td><td className="text-right">{moeda(d.valor_debito)}</td>
                      <td className="text-right">{moeda(d.valor_credito)}</td><td className="text-right">{moeda(d.diferenca)}</td>
                      <td className="text-right"><Button label="Selecionar lote" variant="ghost" onClick={() => escolherLote(d.codlote)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-gp-sm flex justify-end"><Button label="&Sair" variant="soft" onClick={() => setDiferencas(null)} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
