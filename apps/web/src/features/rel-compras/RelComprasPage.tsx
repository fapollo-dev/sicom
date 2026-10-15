import { useCallback, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { LookupField } from '../../shared/ui/LookupField';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { hojeNaLoja } from '../../shared/tempo';
import { CodigosComPesquisa } from '../../shared/pesquisa/CodigosComPesquisa';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Tipo = 'CATEGORIA' | 'CATEGORIA_ANALITICO' | 'COMPRAS_VENDAS';
interface Linha {
  idempresa?: number; fantasia?: string; data?: string;
  codsecao?: number; desc_secao?: string;
  coddpto?: number; descricao_departamento?: string;
  codgrupo?: number; desc_grupo?: string;
  codsubgrupo?: number; desc_subgrupo?: string;
  idproduto?: number; descricao?: string;
  total_compra: number; total_venda: number; total_porc: number;
}
interface Loja { idempresa: number; fantasia: string; total_compra: number; total_porc: number }
interface Resultado { tipo: Tipo; considerar: string | null; campoData: string; linhas: Linha[]; lojas: Loja[]; totais: { compra: number; venda: number } }
/** um nó da árvore da grade: a loja, a data, a seção, o departamento, o grupo, o subgrupo (e o produto no analítico) */
interface No { id: string; caminho: string[]; rotulo: string; total_compra: number; total_porc: number | null }

const TIPOS: Array<{ v: Tipo; rotulo: string }> = [
  { v: 'CATEGORIA', rotulo: '1 - Compras por categoria' },
  { v: 'CATEGORIA_ANALITICO', rotulo: '2 - Compras por categoria analítico' },
  { v: 'COMPRAS_VENDAS', rotulo: '3 - Compras/Vendas  departamento' },
];
const DATAS: Array<[string, string]> = [['CONTABIL', 'Contábil'], ['EMISSAO', 'Emissão'], ['CHEGADA', 'Chegada'], ['PROCESSAMENTO', 'Processamento']];
const CONSIDERAR: Array<[string, string]> = [['COMPRAS', 'Compras'], ['VENDAS', 'Vendas'], ['AMBOS', 'Compras e Vendas']];

/**
 * RELATÓRIOS DE COMPRAS (`FRMRELCOMPRAS`, URelCompras.pas sobre o TFrmRelMaster). Dossiê: `uRelCompras.md`.
 *
 * O que a loja comprou, pela árvore de categorias. Como no legado, a ação é o **Imprimir**: nos tipos 1 e 2 com "Exibe grade" ele mostra
 * antes a grade (`TFrmRelComprasPorCategoriaGrid` — loja → data → seção → departamento → grupo → subgrupo [→ produto], o % do último nível
 * dentro do seu pai e o da loja no total) e imprime pelo Imprimir dela; sem a grade (ou no tipo 3, que não tem) vai direto ao layout.
 */
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: unknown) => (v == null ? '' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const dataBr = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => hojeNaLoja();
const cod = (c: unknown, d: unknown) => `${c ?? 0} - ${d ?? 'SEM CADASTRO'}`;

/** a árvore da grade a partir das linhas do último nível (o legado monta as visões mestre-detalhe da mesma consulta) */
function arvore(res: Resultado): No[] {
  const nos = new Map<string, No>();
  const porc = new Map(res.lojas.map((l) => [String(l.idempresa), l.total_porc]));
  for (const l of res.linhas) {
    const niveis: Array<[string, string]> = [
      [`L${l.idempresa}`, cod(l.idempresa, l.fantasia)], [`D${String(l.data ?? '').slice(0, 10)}`, dataBr(l.data)],
      [`S${l.codsecao ?? 0}`, cod(l.codsecao, l.desc_secao)], [`P${l.coddpto ?? 0}`, cod(l.coddpto, l.descricao_departamento)],
      [`G${l.codgrupo ?? 0}`, cod(l.codgrupo, l.desc_grupo)], [`B${l.codsubgrupo ?? 0}`, cod(l.codsubgrupo, l.desc_subgrupo)],
    ];
    if (res.tipo === 'CATEGORIA_ANALITICO') niveis.push([`I${l.idproduto ?? 0}`, cod(l.idproduto, l.descricao)]);
    const caminho: string[] = [];
    niveis.forEach(([k, rotulo], i) => {
      caminho.push(k);
      const id = caminho.join('/');
      const folha = i === niveis.length - 1;
      const no = nos.get(id) ?? { id, caminho: [...caminho], rotulo, total_compra: 0, total_porc: i === 0 ? porc.get(String(l.idempresa)) ?? 0 : null };
      no.total_compra += Number(l.total_compra ?? 0);
      if (folha) no.total_porc = Number(l.total_porc ?? 0);
      nos.set(id, no);
    });
  }
  return [...nos.values()];
}

export function RelComprasPage() {
  const mensagem = useMensagem();
  const vazio = { coddpto: '', codgrupo: '', codsubgrupo: '', codsecao: '', idproduto: '', codparceiro: '', cfops: '' };
  // o FormShow chama o CmbTipoRelatorioChange com o combo vazio: cai no ramo do tipo 3 (Considerar ligado em Compras, sem grade)
  const [f, setF] = useState({
    tipo: '' as '' | Tipo, dataIni: hoje(), dataFim: hoje(), campoData: 'CONTABIL', considerar: 'COMPRAS', exibeGrade: false,
    empresas: '', niveis: '', ...vazio,
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const categoria = f.tipo === 'CATEGORIA' || f.tipo === 'CATEGORIA_ANALITICO';
  const niveisDoTipo = f.tipo === 'CATEGORIA' ? 5 : f.tipo === 'CATEGORIA_ANALITICO' ? 6 : 0;

  // CmbTipoRelatorioChange: nos tipos 1 e 2 o Considerar desliga e o "Exibe grade" volta marcado; no 3, o contrário
  const mudarTipo = (tipo: '' | Tipo) => {
    const cat = tipo === 'CATEGORIA' || tipo === 'CATEGORIA_ANALITICO';
    setF({ ...f, tipo, considerar: cat ? '' : 'COMPRAS', exibeGrade: cat, niveis: '' });
    setRes(null);
  };
  const consulta = () => {
    const q = new URLSearchParams({ tipo: f.tipo, dataIni: f.dataIni, dataFim: f.dataFim });
    if (f.campoData) q.set('campoData', f.campoData);
    if (f.tipo === 'COMPRAS_VENDAS' && f.considerar) q.set('considerar', f.considerar);
    if (f.niveis) q.set('niveis', f.niveis);
    for (const k of ['coddpto', 'codgrupo', 'codsubgrupo', 'codsecao', 'idproduto', 'codparceiro', 'cfops'] as const) if (f[k].trim()) q.set(k, f[k].trim());
    if (f.empresas.trim()) q.set('empresas', f.empresas.replace(/\s/g, ''));
    return q.toString();
  };
  // Validacoes + OnExitData do TFrmRelMaster
  const validar = () => {
    if (!f.dataIni || !f.dataFim) { mensagem.erro('Favor informar a data.'); return false; }
    if (f.dataIni > f.dataFim) { mensagem.erro('A data inicial não pode ser maior que a final.'); return false; }
    if (!f.tipo) { mensagem.erro('Selecione um tipo de relatório.'); return false; }
    return true;
  };
  const imprimirLayout = () => imprimirRelatorio(`/relatorios/compras/impressao?${consulta()}`).catch((e) => mensagem.erro(e));
  // o BtnImprimirClick: com "Exibe grade" (tipos 1 e 2) a grade vem antes (AntesImprimir → ExibeGrid); sem ela, direto ao layout
  const imprimir = async () => {
    if (!validar()) return;
    if (!(categoria && f.exibeGrade)) { setRes(null); await imprimirLayout(); return; }
    setOcupado(true);
    try {
      const r = await fetch(`${BASE}/relatorios/compras?${consulta()}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      setRes((await r.json()) as Resultado);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  // BtnLimparClick: os campos em branco, as datas em hoje e os combos vazios
  const limpar = () => { setF({ ...f, ...vazio, tipo: '', campoData: '', niveis: '', dataIni: hoje(), dataFim: hoje() }); setRes(null); };

  const nos = useMemo(() => (res ? arvore(res) : []), [res]);
  const caminho = useCallback((n: No) => n.caminho, []);
  const cols = useMemo<DataTableColumnDef<No>[]>(() => [
    { field: 'rotulo', headerName: 'Categoria', type: 'text', isPrimary: true, treeColumn: true },
    { field: 'total_compra', headerName: 'TOTAL DE COMPRAS (R$)', type: 'text', width: 190, valueGetter: (n) => moeda(n.total_compra) },
    { field: 'total_porc', headerName: 'TOTAL DE COMPRAS (%)', type: 'text', width: 180, valueGetter: (n) => pct(n.total_porc) },
  ], []);
  // o Exportar da grade ("1 - Compras por categoria.xlsx")
  const exportar = () => {
    if (!res) return;
    exportarGradeCsv(res.linhas, [
      { titulo: 'Empresa', valor: (l) => cod(l.idempresa, l.fantasia) }, { titulo: 'Data', valor: (l) => dataBr(l.data) },
      { titulo: 'Seção', valor: (l) => cod(l.codsecao, l.desc_secao) }, { titulo: 'Departamento', valor: (l) => cod(l.coddpto, l.descricao_departamento) },
      { titulo: 'Grupo', valor: (l) => cod(l.codgrupo, l.desc_grupo) }, { titulo: 'Subgrupo', valor: (l) => cod(l.codsubgrupo, l.desc_subgrupo) },
      ...(res.tipo === 'CATEGORIA_ANALITICO' ? [{ titulo: 'Produto', valor: (l: Linha) => cod(l.idproduto, l.descricao) }] : []),
      { titulo: 'TOTAL DE COMPRAS (R$)', valor: (l) => moeda(l.total_compra) }, { titulo: 'TOTAL DE COMPRAS (%)', valor: (l) => pct(l.total_porc) },
    ], '1 - Compras por categoria');
  };
  const familia = (k: 'codsecao' | 'coddpto' | 'codgrupo' | 'codsubgrupo', label: string, tipo: string) => (
    <div className="w-64"><LookupField label={label} recurso="lookup/familias" campoCodigo="codigo" descricao="nome" fixos={{ tipo }}
      value={f[k] || null} onChange={(c) => setF((x) => ({ ...x, [k]: c ?? '' }))} /></div>
  );

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Relatórios de compras" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Tipo de Relatório
            <select aria-label="Tipo de Relatório" className="rounded border border-border px-1 py-1" value={f.tipo} onChange={(e) => mudarTipo(e.target.value as '' | Tipo)}>
              <option value="" />
              {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.rotulo}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Níveis expandidos
            <select aria-label="Níveis expandidos" className="rounded border border-border px-1 py-1" disabled={niveisDoTipo === 0} value={f.niveis} onChange={(e) => setF({ ...f, niveis: e.target.value })}>
              <option value="" />
              {Array.from({ length: niveisDoTipo }, (_, i) => <option key={i} value={String(i + 1)}>{i === 0 ? '1 nível' : `${i + 1} níveis`}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-gp-xs pb-2 text-body-sm">
            <input type="checkbox" disabled={!categoria} checked={f.exibeGrade} onChange={(e) => setF({ ...f, exibeGrade: e.target.checked })} /> Exibe grade
          </label>
          <fieldset className="flex items-center gap-gp-sm rounded border border-border px-pad-sm py-1 text-body-sm" disabled={categoria}>
            <legend className="px-1 text-fg-muted">Considerar:</legend>
            {CONSIDERAR.map(([v, l]) => (
              <label key={v} className="flex items-center gap-gp-xs"><input type="radio" name="relcompras-considerar" checked={f.considerar === v} onChange={() => setF({ ...f, considerar: v })} /> {l}</label>
            ))}
          </fieldset>
          <div className="w-32"><Field label="&Empresas (1,2)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value })} placeholder="esta loja" /></div>
          <Button label="&Imprimir" disabled={ocupado} onClick={() => void imprimir()} />
          <Button label="&Limpar" variant="ghost" onClick={limpar} />
        </div>
        {/* GpbProduto: os códigos com a Pesquisa ([F3]/botão) e a descrição; o código que não existe limpa (EdtCodFornecedorExit) */}
        <fieldset className="mt-form-gap flex flex-wrap items-end gap-gp-sm rounded border border-border p-pad-sm">
          <legend className="px-1 text-body-sm text-fg-muted">Produto</legend>
          {familia('coddpto', 'Departamento', 'DEPARTAMENTO')}
          {familia('codgrupo', 'Grupo', 'GRUPO')}
          {familia('codsubgrupo', 'Subgrupo', 'SUBGRUPO')}
          {familia('codsecao', 'Seção', 'SECAO')}
          <div className="w-72"><LookupField label="Produto" recurso="lookup/produtos" campoCodigo="idproduto" descricao="descricao"
            value={f.idproduto || null} onChange={(c) => setF((x) => ({ ...x, idproduto: c ?? '' }))} /></div>
          {/* PesquisaCFOP: a GET_CFOP de entrada em multisseleção; os marcados substituem a lista */}
          <CodigosComPesquisa label="C&FOP" largura="w-44" value={f.cfops} onChange={(v) => setF({ ...f, cfops: v })} recurso="lookup/cfops" fixos={{ tipo: 'E' }} campo="cfop" />
        </fieldset>
        <fieldset className="mt-form-gap flex flex-wrap items-end gap-gp-sm rounded border border-border p-pad-sm">
          <legend className="px-1 text-body-sm text-fg-muted">Nota fiscal</legend>
          <label className="flex flex-col gap-gp-xs text-body-sm">
            Data
            <select aria-label="Data" className="rounded border border-border px-1 py-1" value={f.campoData} onChange={(e) => setF({ ...f, campoData: e.target.value })}>
              <option value="" />
              {DATAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <div className="w-40"><Field label="Data inicial" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="Data final" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-72"><LookupField label="Fornecedor" recurso="lookup/parceiros" campoCodigo="codparceiro" descricao="fantasia" fixos={{ frn: 'S' }}
            value={f.codparceiro || null} onChange={(c) => setF((x) => ({ ...x, codparceiro: c ?? '' }))} /></div>
        </fieldset>
      </section>
      {res && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md" aria-label="Compras por categoria">
          <div className="flex flex-wrap items-center gap-gp-sm">
            <span className="text-body-sm font-semibold text-fg-muted">Compras por categoria</span>
            <span className="text-body-sm tabular-nums">Total de compras: {moeda(res.totais.compra)}</span>
            <span className="flex-1" />
            <Button label="&Exportar" variant="ghost" onClick={exportar} />
            <Button label="Imprimir" variant="soft" onClick={() => void imprimirLayout()} />
            <Button label="&Sair" variant="ghost" onClick={() => setRes(null)} />
          </div>
          <DataTable rows={nos} columns={cols} getRowId={(n: No) => n.id} getTreeDataPath={caminho} treeData={{ defaultExpanded: true }} />
        </section>
      )}
    </div>
  );
}
