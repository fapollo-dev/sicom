import { useMemo, useState } from 'react';
import { useOpcoesDoForm } from '../../shared/acesso/useOpcoesDoForm';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { hojeNaLoja } from '../../shared/tempo';
import { useShortcut } from '../../shared/keyboard';
import { LookupField } from '../../shared/ui/LookupField';
import { Pesquisa } from '../../shared/cadmaster/Pesquisa';
import { exportarGradeCsv } from '../../shared/export/exportarGradeCsv';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Linha = Record<string, unknown>;
interface Resultado { empresas: number[]; linhas: Linha[] }

const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: unknown) => `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const inicioMes = () => `${hojeNaLoja().slice(0, 8)}01`;
const MODOS: Array<[string, string]> = [['contem', 'Contém'], ['igual', 'Igual a'], ['comeca', 'Começa com'], ['termina', 'Termina com'], ['diferente', 'Diferente de']];

// a grade do TFrmRelRentabilidadeCategoriasGrid (UFrmRelRentabilidadeCategoriasGrid.dfm): as colunas, os rótulos (DisplayLabel) e a
// ordem do legado; Σ = as 22 somas do rodapé (skSum)
const GRADE: Array<[string, string, number, 'txt' | 'moeda' | 'pct', boolean]> = [
  ['subgrupo', 'Categoria', 200, 'txt', false], ['idproduto', 'PLU', 80, 'txt', false], ['descricao', 'Produto', 200, 'txt', false],
  ['vrcusto', 'Custo', 90, 'moeda', false], ['vrunit', 'Venda', 90, 'moeda', false], ['promocao', 'Prom.', 60, 'txt', false],
  ['totcusto', 'Total custo', 110, 'moeda', true], ['despacess', 'Desp. acessórias', 100, 'moeda', true], ['frete', 'Frete', 90, 'moeda', true],
  ['frete2', 'Frete 2', 90, 'moeda', true], ['st', 'ST', 80, 'moeda', true], ['vrfcpst', 'FCP ST', 80, 'moeda', true], ['ipi', 'IPI', 80, 'moeda', true],
  ['seguro', 'Seguro', 80, 'moeda', true], ['bonificacao', 'Bonificação', 100, 'moeda', true], ['creditoicms', 'Crédito ICMS', 100, 'moeda', true],
  ['creditopiscofins', 'Crédito P/C', 100, 'moeda', true], ['vrcustoreal', 'Total custo real', 115, 'moeda', true], ['totvenda', 'Total venda', 110, 'moeda', true],
  ['debitoicms', 'Débito ICMS', 100, 'moeda', true], ['debitopiscofins', 'Débito P/C', 100, 'moeda', true], ['vendaliquida', 'Total venda líquida', 130, 'moeda', true],
  ['vrperda', 'Perda', 90, 'moeda', true], ['lucro', 'Lucro bruto', 110, 'moeda', true], ['margembruta', 'MLB %', 80, 'pct', false],
  ['despoperacional', 'Desp. op.', 100, 'moeda', true], ['imprenda', 'IR', 90, 'moeda', true], ['contsocial', 'Ct. social', 90, 'moeda', true],
  ['lucrofinal', 'Lucro final', 110, 'moeda', true], ['margemfinal', 'MLF %', 80, 'pct', false],
];
const NIVEIS_FAMILIA = [['dpto', 'modoDpto', 'Dpto', 'DEPARTAMENTO'], ['grupo', 'modoGrupo', 'Grupo', 'GRUPO'], ['subgrupo', 'modoSubgrupo', 'Sub-Grupo', 'SUBGRUPO']] as const;

/**
 * RENTABILIDADE POR CATEGORIAS (`FRMRENTABILIDADECATEGORIAS`). Dossiê: `uRentabilidadeCategorias.md`.
 *
 * O relatório do legado: por subgrupo × produto, da venda ao lucro final (ICMS e PIS/COFINS de entrada e saída, ST, frete, IPI, a
 * despesa operacional, a perda, IR e CSLL), com o índice do subgrupo no ranking e a participação do produto no lucro dele. O [F9]
 * (`btnConsultaClick`) consulta e imprime no Tipo Relatório (completo, simplificado ou totais); no Completo com "Exibe grade" mostra
 * antes a grade (o TFrmRelRentabilidadeCategoriasGrid) e só imprime pelo Imprimir dela.
 */
export function RentabilidadePage() {
  const { tem: pode } = useOpcoesDoForm('FRMRENTABILIDADECATEGORIAS'); // o "[F9] Consultar" (btnConsulta, Tag 1) — permissões de controle
  const mensagem = useMensagem();
  const [f, setF] = useState({
    dataIni: inicioMes(), dataFim: hojeNaLoja(), despesaOperacional: '', empresas: '',
    dpto: '', modoDpto: 'contem', grupo: '', modoGrupo: 'contem', subgrupo: '', modoSubgrupo: 'contem', codfor: '',
    somenteScrapImportado: false, considerarNf: false, tipo: 'COMPLETO', exibeGrade: true,
  });
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pesquisa, setPesquisa] = useState<(typeof NIVEIS_FAMILIA)[number] | null>(null);

  const consulta = () => {
    const q = new URLSearchParams({ dataIni: f.dataIni, dataFim: f.dataFim, tipo: f.tipo });
    if (f.despesaOperacional.trim()) q.set('despesaOperacional', f.despesaOperacional.replace(',', '.'));
    if (f.empresas.trim()) q.set('empresas', f.empresas.replace(/\s/g, ''));
    for (const [k, m] of NIVEIS_FAMILIA) {
      if (f[k].trim()) { q.set(k, f[k].trim().toUpperCase()); q.set(m, f[m]); }
    }
    if (f.codfor.trim()) q.set('codfor', f.codfor.trim());
    if (f.somenteScrapImportado) q.set('somenteScrapImportado', 'true');
    if (f.considerarNf) q.set('considerarNf', 'true');
    return q.toString();
  };

  // a impressão no layout do Tipo Relatório (at&m_rentabilidade_da_familia[_simp|_totais].fr3)
  const imprimir = async () => { await imprimirRelatorio(`/relatorios/rentabilidade/impressao?${consulta()}`).catch((e) => mensagem.erro(e)); };
  const consultar = async () => {
    setOcupado(true);
    try {
      // sem a grade (Simplificado, Totais ou "Exibe grade" desmarcado) o [F9] vai direto à impressão
      if (!(f.tipo === 'COMPLETO' && f.exibeGrade)) { setRes(null); await imprimir(); return; }
      const r = await fetch(`${BASE}/relatorios/rentabilidade/legado?${consulta()}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const j = (await r.json()) as Resultado;
      setRes({ ...j, linhas: j.linhas.map((l, k) => ({ ...l, _k: k })) });
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };
  // F9 = btnConsultaClick (FormKeyDown do uRentabilidadeCategorias; "[F9] Consultar") — com o Consultar habilitado (permissão de controle)
  useShortcut('f9', () => { void consultar(); }, { when: !ocupado && pode('BTNCONSULTA') });

  const fmt = (k: 'txt' | 'moeda' | 'pct') => (v: unknown) => (k === 'moeda' ? moeda(v) : k === 'pct' ? pct(v) : String(v ?? ''));
  const cols = useMemo<DataTableColumnDef<Linha>[]>(() => GRADE.map(([field, headerName, width, k, soma]) => ({
    field, headerName, width, type: k === 'txt' ? 'text' : 'number', valueFormatter: fmt(k),
    ...(field === 'descricao' ? { isPrimary: true } : {}),
    ...(soma ? { aggregate: 'sum' as const, aggregateFormatter: (v: number) => moeda(v) } : {}),
  })), []);
  // o Exportar da grade (BtnExportarExcelClick, "Rentabilidade por categoria.xlsx") — as colunas e a ordem da tela
  const exportar = () => {
    if (!res) return;
    exportarGradeCsv(res.linhas, GRADE.map(([field, titulo, , k]) => ({ titulo, valor: (l: Linha) => fmt(k)(l[field]) })), 'Rentabilidade por categoria');
  };

  const Modo = ({ k }: { k: 'modoDpto' | 'modoGrupo' | 'modoSubgrupo' }) => (
    <select aria-label={`Filtro ${k.slice(4)}`} className="rounded border border-border px-1 py-1 text-body-sm" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
      {MODOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const radio = (nome: string, valor: string, atual: string, rotulo: string, aoMudar: () => void) => (
    <label key={valor} className="flex items-center gap-gp-xs"><input type="radio" name={nome} checked={atual === valor} onChange={aoMudar} /> {rotulo}</label>
  );

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Rentabilidade por categorias" />
      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="&Período" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&a" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-44"><Field label="Despesa &Operacional (%)" value={f.despesaOperacional} onChange={(e) => setF({ ...f, despesaOperacional: e.target.value })} placeholder="da empresa" /></div>
          <div className="w-32"><Field label="&Empresas (1,2)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value })} placeholder="esta loja" /></div>
          <Button label="[F9] &Consultar" disabled={ocupado || !pode('BTNCONSULTA')} onClick={() => void consultar()} />
        </div>
        {/* edtDpto/edtGrupo/edtSubGrupo: o texto da descrição, o [F3] abre a Pesquisa da GET_FAMILIAS_PROD no TIPO do nível, e o modo do SetaFiltro */}
        <div className="mt-form-gap flex flex-wrap items-end gap-gp-sm">
          {NIVEIS_FAMILIA.map((n) => (
            <div key={n[0]} className="flex items-end gap-gp-xs">
              <div className="w-44"><Field label={`${n[2]} - [F3] buscar`} value={f[n[0]]} onChange={(e) => setF({ ...f, [n[0]]: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'F3') { e.preventDefault(); setPesquisa(n); } }} /></div>
              <Modo k={n[1]} />
            </div>
          ))}
          <div className="w-72"><LookupField label="Sub-Grupo do Fornecedor - [F3] buscar" recurso="lookup/parceiros" campoCodigo="codparceiro" descricao="razao"
            fixos={{ frn: 'S', ativado: 'S' }} value={f.codfor || null} onChange={(c) => setF({ ...f, codfor: c ?? '' })} /></div>
        </div>
        <div className="mt-form-gap flex flex-wrap items-start gap-gp-lg text-body-sm">
          <fieldset className="flex items-center gap-gp-sm rounded border border-border px-pad-sm py-1">
            <legend className="px-1 text-fg-muted">Tipo Relatorio</legend>
            {/* RgTipoClick: o "Exibe grade" só vale no Completo (fora dele desmarca e trava) */}
            {[['COMPLETO', 'Completo'], ['SIMPLIFICADO', 'Simplificado'], ['TOTAIS', 'Totais']].map(([v, l]) =>
              radio('rent-tipo', v, f.tipo, l, () => setF({ ...f, tipo: v, exibeGrade: v === 'COMPLETO' ? f.exibeGrade : false })))}
          </fieldset>
          <fieldset className="flex items-center gap-gp-sm rounded border border-border px-pad-sm py-1">
            <legend className="px-1 text-fg-muted">Tipo Consulta</legend>
            {radio('rent-consulta', 'V', f.considerarNf ? 'VN' : 'V', 'Vendas', () => setF({ ...f, considerarNf: false }))}
            {radio('rent-consulta', 'VN', f.considerarNf ? 'VN' : 'V', 'Vendas e Notas Fiscais', () => setF({ ...f, considerarNf: true }))}
          </fieldset>
          <div className="flex flex-col gap-gp-xs">
            <label className="flex items-center gap-gp-xs"><input type="checkbox" checked={f.somenteScrapImportado} onChange={(e) => setF({ ...f, somenteScrapImportado: e.target.checked })} /> Considerar apenas SCRAP's com nota fiscal para calcular perdas</label>
            <label className="flex items-center gap-gp-xs"><input type="checkbox" disabled={f.tipo !== 'COMPLETO'} checked={f.exibeGrade} onChange={(e) => setF({ ...f, exibeGrade: e.target.checked })} /> Exibe grade</label>
          </div>
        </div>
      </section>
      {pesquisa && (
        <Pesquisa resourcePath="lookup/familias" fixos={{ tipo: pesquisa[3] }} onFechar={() => setPesquisa(null)}
          onSelecionar={(l) => { setF((x) => ({ ...x, [pesquisa[0]]: String(l.nome ?? '') })); setPesquisa(null); }} />
      )}
      {res && (
        <section className="flex flex-col gap-gp-sm rounded-radius-md border border-border bg-bg-surface p-pad-md" aria-label="Rentabilidade por categoria">
          <div className="flex flex-wrap items-center gap-gp-sm">
            <span className="text-body-sm font-semibold text-fg-muted">Rentabilidade por categoria</span>
            <span className="flex-1" />
            {/* os botões do TFrmRelVendasMaster: Exportar, Imprimir (mrOk → imprime) e Sair (mrNo) */}
            <Button label="&Exportar" variant="ghost" onClick={exportar} />
            <Button label="&Imprimir" variant="soft" onClick={() => void imprimir()} />
            <Button label="&Sair" variant="ghost" onClick={() => setRes(null)} />
          </div>
          <DataTable persistId="rentabilidade-legado-grade" rows={res.linhas} columns={cols} getRowId={(l: Linha) => String(l._k)} showTotalizers />
        </section>
      )}
    </div>
  );
}
