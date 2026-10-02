import { useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumnDef, PageHeader } from '@apollosg/design-system';
import type { AnaliseNfDto } from '@apollo/shared';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { Button } from '../../shared/ui/Button';
import { useMensagem } from '../../shared/mensagem';
import { apiHeaders, handle401 } from '../../shared/auth/session';
import { imprimirRelatorio } from '../../shared/fr3/imprimirRelatorio';
import { hojeNaLoja } from '../../shared/tempo';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface Resultado {
  modelo: string;
  linhas: Array<Record<string, unknown>>;
  totais: { notas: number; totalnf: number; totalprod: number; totalisento: number; divergencia: number };
  truncado: boolean;
}

/**
 * ANÁLISE DE NOTAS FISCAIS (`FRMNFANALISE`). Dossiê: `uNFAnalise.md`.
 *
 * A tela do legado é um radio de nove análises com um painel de filtros. Aqui estão as duas do corte-1, e as
 * outras sete aparecem na lista **desabilitadas, dizendo o que falta** — o operador vê o que ainda não veio
 * em vez de procurar um botão que não existe.
 *
 * O que dá valor à tela é o **"somente diferenças"**: a nota cujo rateio contábil não fecha com o total. No
 * cliente são 3.037 das 49.282 (6,2%), e cada uma é um lançamento que vai sair errado.
 */
const MODELOS = [
  { id: 'TRIBUTARIA', n: 1, label: 'Análise de situação tributária', ok: true },
  { id: 'CONFERENCIA', n: 8, label: 'Análise de conferência de notas', ok: true },
  { id: 'PRECIFICACAO', n: 2, label: 'Análise de precificação', ok: true },
  { id: 'TRIBUTARIA_PRODUTOS', n: 3, label: 'Situação tributária por produtos', ok: true },
  { id: 'PRECO_FORNECEDOR', n: 4, label: 'Precificação agrupada por fornecedor', ok: true },
  { id: 'PRECO_FORNECEDOR_ITENS', n: 5, label: 'Precificação agrupada por fornecedor — itens', ok: true },
  { id: 'FORMAS_PAGAMENTO', n: 6, label: 'Análise de formas de pagamento', ok: true },
  { id: 'POR_CST', n: 7, label: 'Situação tributária por CST', ok: true },
  { id: 'ICMS_ST_RECOLHER', n: 9, label: 'Conferência de ICMS-ST a recolher', ok: true },
];

const moeda = (v: unknown) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const data = (v: unknown) => (v == null ? '' : String(v).slice(0, 10).split('-').reverse().join('/'));
const hoje = () => hojeNaLoja();
const inicioMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

export function NfAnalisePage() {
  const mensagem = useMensagem();
  type Modelo = 'TRIBUTARIA' | 'TRIBUTARIA_PRODUTOS' | 'CONFERENCIA' | 'PRECIFICACAO' | 'PRECO_FORNECEDOR' | 'PRECO_FORNECEDOR_ITENS'
    | 'FORMAS_PAGAMENTO' | 'POR_CST' | 'ICMS_ST_RECOLHER';
  const [modelo, setModelo] = useState<Modelo>('TRIBUTARIA');
  const consulta = modelo === 'FORMAS_PAGAMENTO' || modelo === 'POR_CST' || modelo === 'ICMS_ST_RECOLHER';
  const preco = modelo === 'PRECIFICACAO' || modelo === 'PRECO_FORNECEDOR' || modelo === 'PRECO_FORNECEDOR_ITENS';
  const [f, setF] = useState({
    dataIni: inicioMes(), dataFim: hoje(), tipo: 'T' as 'T' | 'E' | 'S',
    nronf: '', razao: '', cfop: '', processadas: 'T' as 'S' | 'N' | 'T',
    incluirDevolucao: false, somenteDiferencas: false, movimentaEstoque: false, empresas: '',
    coddpto: '', codbarra: '', codgrupo: '', codsubgrupo: '', cfopPrecificacao: false, desconsiderarTransfEntrada: true, agrupar: false,
    modalidade: '', cfopEstado: '' as '' | 'D' | 'F',
  });
  const [modalidades, setModalidades] = useState<string[]>([]);
  useEffect(() => {
    if (modelo !== 'FORMAS_PAGAMENTO' || modalidades.length) return;
    fetch(`${BASE}/fiscal/nf-analise/modalidades`, { headers: apiHeaders() }).then((r) => (r.ok ? r.json() : [])).then((m) => setModalidades(m as string[])).catch(() => undefined);
  }, [modelo, modalidades.length]);
  const [res, setRes] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const corpo = (): AnaliseNfDto => ({
    modelo, dataIni: f.dataIni, dataFim: f.dataFim, tipo: f.tipo,
    nronf: f.nronf || null, razao: f.razao || null, cfop: f.cfop ? Number(f.cfop) : null,
    processadas: f.processadas, incluirDevolucao: f.incluirDevolucao, somenteDiferencas: f.somenteDiferencas,
    movimentaEstoque: f.movimentaEstoque,
    empresas: f.empresas.split(',').map((e) => Number(e.trim())).filter((e) => Number.isInteger(e) && e > 0),
    coddpto: f.coddpto ? Number(f.coddpto) : null, codbarra: f.codbarra || null,
    codgrupo: f.codgrupo ? Number(f.codgrupo) : null, codsubgrupo: f.codsubgrupo ? Number(f.codsubgrupo) : null,
    cfopPrecificacao: f.cfopPrecificacao, desconsiderarTransfEntrada: f.desconsiderarTransfEntrada, agrupar: f.agrupar,
    modalidade: f.modalidade || null, cfopEstado: f.cfopEstado || null,
  });
  const gerar = async () => {
    setOcupado(true);
    try {
      const body = corpo();
      const r = await fetch(`${BASE}/fiscal/nf-analise`, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
      handle401(r);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
        throw Object.assign(new Error(env.code), { envelope: env });
      }
      const j = (await r.json()) as Resultado;
      setRes(j);
      if (j.truncado) mensagem.sucesso(`Análise gerada. Só as primeiras ${j.linhas.length.toLocaleString('pt-BR')} notas foram trazidas — reduza o período.`);
    } catch (e) { mensagem.erro(e); } finally { setOcupado(false); }
  };

  // o "[F11] Imprimir": o layout .fr3 do cliente da opção, com os datasets do UdmNFAnalise
  const imprimir = () => {
    imprimirRelatorio('/fiscal/nf-analise/impressao', corpo()).catch((e) => mensagem.erro(e));
  };

  const cols = useMemo<DataTableColumnDef<Record<string, unknown>>[]>(() => {
    if (consulta) {
      const n2 = (v: unknown) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      const c = (field: string, headerName: string, num = false, width = 110): DataTableColumnDef<Record<string, unknown>> =>
        ({ field, headerName, type: 'text', width, ...(num ? { valueGetter: (l: Record<string, unknown>) => n2(l[field]) } : {}) });
      if (modelo === 'FORMAS_PAGAMENTO') return [c('nronf', 'Nº NF', false, 100), c('fornecedor', 'Parceiro', false, 220), c('modalidade', 'Modalidade'), c('nro_parcela', 'Parcela'), c('valor_fat', 'Valor', true), c('totalnf', 'Total NF', true)];
      if (modelo === 'POR_CST') return [c('nronf', 'Nº NF', false, 100), c('parceiro', 'Parceiro', false, 220), c('cfop', 'CFOP', false, 80), c('cst', 'CST', false, 70), c('aliquota', 'Alíq.', false, 70), c('vlrtotal', 'Valor', true), c('vrbasecalculo', 'Base ICMS', true), c('vlr_red_bc', 'Redução BC', true), c('vricm', 'ICMS', true)];
      return [c('nronf', 'Nº NF', false, 100), c('razao_remetente', 'Remetente', false, 200), c('descricao', 'Produto', false, 220), c('valor', 'Valor', true), c('icms_st_bc', 'BC ST', true), c('icms_st_valor', 'ST nota', true), c('icms_st_recolher', 'ST a recolher', true)];
    }
    if (preco) {
      const n2 = (v: unknown) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      return [
        { field: 'nronf', headerName: 'Nº NF', type: 'text', width: 100, isPrimary: true },
        { field: 'razao', headerName: 'Fornecedor', type: 'text' },
        { field: 'codbarra', headerName: 'Cód. barras', type: 'text', width: 130 },
        { field: 'descricao', headerName: 'Produto', type: 'text' },
        { field: 'vrcusto', headerName: 'Custo rep.', type: 'text', width: 100, valueGetter: (l) => n2(l.vrcusto) },
        { field: 'vrvenda', headerName: 'Venda', type: 'text', width: 100, valueGetter: (l) => n2(l.vrvenda) },
        { field: 'markup', headerName: 'Markup %', type: 'text', width: 90, valueGetter: (l) => n2(l.markup) },
        { field: 'markupl2', headerName: 'Margem %', type: 'text', width: 90, valueGetter: (l) => n2(l.markupl2) },
        { field: 'qtde', headerName: 'Estoque', type: 'text', width: 90, valueGetter: (l) => n2(l.qtde) },
        { field: 'totalnf_venda', headerName: 'Total venda', type: 'text', width: 110, valueGetter: (l) => n2(l.totalnf_venda) },
      ];
    }
    const base: DataTableColumnDef<Record<string, unknown>>[] = [
      { field: 'nronf', headerName: 'Nº NF', type: 'text', width: 110, isPrimary: true },
      { field: 'dtcontabil', headerName: 'Contábil', type: 'text', width: 110, valueGetter: (l) => data(l.dtcontabil) },
      { field: 'tipo', headerName: 'Tipo', type: 'text', width: 70, valueGetter: (l) => (l.tipo === 'E' ? 'Entrada' : 'Saída') },
      { field: 'razao', headerName: 'Cliente / Fornecedor', type: 'text' },
      { field: 'cfop', headerName: 'CFOP', type: 'text', width: 90 },
      { field: 'totalnf', headerName: 'Total da nota', type: 'text', width: 130, valueGetter: (l) => moeda(l.totalnf) },
    ];
    if (modelo !== 'CONFERENCIA') {
      base.push(
        { field: 'totalisento', headerName: 'Isento', type: 'text', width: 120, valueGetter: (l) => moeda(l.totalisento) },
        { field: 'rateio_contabil', headerName: 'Rateio contábil', type: 'text', width: 140, valueGetter: (l) => moeda(l.rateio_contabil) },
        { field: 'diferenca', headerName: 'Diferença', type: 'text', width: 130,
          valueGetter: (l) => (Math.abs(Number(l.diferenca ?? 0)) < 0.005 ? '—' : moeda(l.diferenca)) },
      );
    } else {
      base.push(
        { field: 'alterado_por', headerName: 'Alterada por', type: 'text', width: 180 },
        { field: 'alterado_em', headerName: 'Quando', type: 'text', width: 150 },
      );
    }
    return base;
  }, [modelo, preco, consulta]);

  return (
    <div className="flex flex-col gap-gp-md">
      <PageHeader title="Análise de notas fiscais" />

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="grid grid-cols-1 gap-gp-sm sm:grid-cols-2">
          {MODELOS.map((m) => (
            <label key={m.id} className={`flex cursor-pointer items-start gap-gp-sm rounded-radius-md border p-pad-sm ${modelo === m.id ? 'border-fg-accent bg-bg-subtle' : 'border-border'} ${m.ok ? '' : 'opacity-60'}`}>
              <input type="radio" name="modelo" className="mt-1" checked={modelo === m.id} disabled={!m.ok}
                onChange={() => m.ok && setModelo(m.id as Modelo)} />
              <span>
                <span className="block text-body-md">{m.n} — {m.label}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-40"><Field label="Contábil &de" type="date" value={f.dataIni} onChange={(e) => setF({ ...f, dataIni: e.target.value })} /></div>
          <div className="w-40"><Field label="&até" type="date" value={f.dataFim} onChange={(e) => setF({ ...f, dataFim: e.target.value })} /></div>
          <div className="w-36"><SelectField label="&Tipo" options={[{ value: 'T', label: 'Todas' }, { value: 'E', label: 'Entrada' }, { value: 'S', label: 'Saída' }]}
            value={f.tipo} onChange={(v) => setF({ ...f, tipo: (v ?? 'T') as 'T' })} /></div>
          <div className="w-36"><Field label="&Nº NF" value={f.nronf} onChange={(e) => setF({ ...f, nronf: e.target.value })} /></div>
          <div className="w-56"><Field label="&Cliente / fornecedor" value={f.razao} onChange={(e) => setF({ ...f, razao: e.target.value })} placeholder="parte da razão social" /></div>
          <div className="w-28"><Field label="C&FOP" value={f.cfop} onChange={(e) => setF({ ...f, cfop: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="w-44"><SelectField label="&Processadas" options={[{ value: 'T', label: 'Todas' }, { value: 'S', label: 'Só processadas' }, { value: 'N', label: 'Só não processadas' }]}
            value={f.processadas} onChange={(v) => setF({ ...f, processadas: (v ?? 'T') as 'T' })} /></div>
        </div>
        <div className="mt-form-gap flex flex-wrap items-center gap-gp-md">
          <label className="flex items-center gap-gp-sm text-body-sm">
            <input type="checkbox" checked={f.incluirDevolucao} onChange={(e) => setF({ ...f, incluirDevolucao: e.target.checked })} />
            Incluir notas de devolução
          </label>
          {!preco && modelo !== 'FORMAS_PAGAMENTO' && (
            <label className="flex items-center gap-gp-sm text-body-sm">
              <input type="checkbox" checked={f.somenteDiferencas} onChange={(e) => setF({ ...f, somenteDiferencas: e.target.checked })} />
              Somente diferenças <span className="text-fg-muted">(o rateio contábil não fecha com o total)</span>
            </label>
          )}
          <label className="flex items-center gap-gp-sm text-body-sm">
            <input type="checkbox" checked={f.movimentaEstoque} onChange={(e) => setF({ ...f, movimentaEstoque: e.target.checked })} />
            NF que movimenta estoque
          </label>
          {modelo === 'FORMAS_PAGAMENTO' && (
            <div className="w-44"><SelectField label="Forma de pagamento" options={[{ value: '', label: 'Todos' }, ...modalidades.map((m) => ({ value: m, label: m }))]}
              value={f.modalidade} onChange={(v) => setF({ ...f, modalidade: (v as string) ?? '' })} /></div>
          )}
          {(modelo === 'POR_CST' || modelo === 'CONFERENCIA' || modelo === 'ICMS_ST_RECOLHER') && (
            <div className="w-44"><SelectField label="CFOP" options={[{ value: '', label: 'Todos' }, { value: 'D', label: 'Dentro do estado' }, { value: 'F', label: 'Fora do estado' }]}
              value={f.cfopEstado} onChange={(v) => setF({ ...f, cfopEstado: ((v as string) ?? '') as '' | 'D' | 'F' })} /></div>
          )}
          {modelo === 'POR_CST' && (
            <>
              <div className="w-24"><Field label="Depto" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value.replace(/\D/g, '') })} /></div>
              <div className="w-36"><Field label="Produto (barras)" value={f.codbarra} onChange={(e) => setF({ ...f, codbarra: e.target.value.trim() })} /></div>
            </>
          )}
          {preco && (
            <>
              <div className="w-24"><Field label="Depto" value={f.coddpto} onChange={(e) => setF({ ...f, coddpto: e.target.value.replace(/\D/g, '') })} /></div>
              {modelo !== 'PRECO_FORNECEDOR' && (
                <>
                  <div className="w-36"><Field label="Produto (barras)" value={f.codbarra} onChange={(e) => setF({ ...f, codbarra: e.target.value.trim() })} /></div>
                  <div className="w-24"><Field label="Grupo" value={f.codgrupo} onChange={(e) => setF({ ...f, codgrupo: e.target.value.replace(/\D/g, '') })} /></div>
                  <div className="w-24"><Field label="Subgrupo" value={f.codsubgrupo} onChange={(e) => setF({ ...f, codsubgrupo: e.target.value.replace(/\D/g, '') })} /></div>
                  {modelo === 'PRECIFICACAO' && (
                    <label className="flex items-center gap-gp-sm text-body-sm">
                      <input type="checkbox" checked={f.cfopPrecificacao} onChange={(e) => setF({ ...f, cfopPrecificacao: e.target.checked })} /> CFOP precificação
                    </label>
                  )}
                </>
              )}
              {modelo === 'PRECO_FORNECEDOR_ITENS' && (
                <label className="flex items-center gap-gp-sm text-body-sm">
                  <input type="checkbox" checked={f.desconsiderarTransfEntrada} onChange={(e) => setF({ ...f, desconsiderarTransfEntrada: e.target.checked })} /> Desconsiderar CFOPs de transferência de entrada
                </label>
              )}
              {modelo === 'PRECIFICACAO' && (
                <label className="flex items-center gap-gp-sm text-body-sm">
                  <input type="checkbox" checked={f.agrupar} onChange={(e) => setF({ ...f, agrupar: e.target.checked })} /> Agrupar análise de precificação
                </label>
              )}
            </>
          )}
          <div className="w-36"><Field label="Empresas (1,2)" value={f.empresas} onChange={(e) => setF({ ...f, empresas: e.target.value })} placeholder="esta loja" /></div>
          <Button label="&Gerar" disabled={ocupado} onClick={() => void gerar()} />
          <Button label="&Imprimir" variant="soft" disabled={!res} onClick={imprimir} />
        </div>
      </section>

      {res && (
        <div id="nfa-impressao" className="flex flex-col gap-gp-md">
          <section className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
            <div className="flex flex-wrap gap-gp-lg">
              <div><div className="text-body-sm text-fg-muted">Notas</div><div className="text-body-lg tabular-nums">{res.totais.notas.toLocaleString('pt-BR')}{res.truncado && ' +'}</div></div>
              <div><div className="text-body-sm text-fg-muted">Total das notas</div><div className="text-body-lg tabular-nums">{moeda(res.totais.totalnf)}</div></div>
              <div><div className="text-body-sm text-fg-muted">Isento</div><div className="text-body-lg tabular-nums">{moeda(res.totais.totalisento)}</div></div>
              {!preco && modelo !== 'CONFERENCIA' && (
                <div><div className="text-body-sm text-fg-muted">Divergência do rateio</div><div className="text-body-lg tabular-nums">{moeda(res.totais.divergencia)}</div></div>
              )}
            </div>
          </section>
          <DataTable rows={res.linhas.map((l, i) => ({ ...l, __id: `${String(l.codnf)}-${i}` }))} columns={cols} getRowId={(l: Record<string, unknown>) => String(l.__id)} />
        </div>
      )}
    </div>
  );
}
