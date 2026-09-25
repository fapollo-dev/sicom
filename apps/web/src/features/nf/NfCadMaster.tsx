import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Controller, useFieldArray, type UseFormReturn } from 'react-hook-form';
import { Pencil, Trash2, Layers, RefreshCw } from 'lucide-react';
import { DataTable, type DataTableColumnDef, Modal } from '@apollosg/design-system';
import {
  nfSchema,
  NF_FINALIDADE_OPCOES,
  NF_TIPOEMISSAO_OPCOES,
  NF_MODELO_OPCOES_ENTRADA,
  NF_MODELO_OPCOES_SAIDA,
  type CriarNfDto,
  type NfItemDto,
  type NfReferenciaDto,
  type NfContabilItemDto,
  totalProdutoItem,
} from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { DateField } from '../../shared/ui/DateField';
import { TextArea } from '../../shared/ui/TextArea';
import { Button } from '../../shared/ui/Button';
import { Tabs, TabPanel, type TabDef } from '../../shared/ui/Tabs';
import { useResourceOptions, type Opcao } from '../../shared/cadmaster/useResourceOptions';
import { useMensagem } from '../../shared/mensagem';
import { NfItemModal } from './NfItemModal';
import { NfSincronizarModal } from './NfSincronizarModal';
import { NfProcessarModal } from './NfProcessarModal';
import { LiberacaoEstoqueNegativoModal } from './NfLiberacaoEstoqueNegativoModal';
import { NfRotativoModal } from './NfRotativoModal';
import { NfLoteModal } from './NfLoteModal';
import { NfScrapModal } from './NfScrapModal';
import { vincularScrapNf, type CredenciaisLiberacao } from './nfScrapApi';
import { NfVendasModal } from './NfVendasModal';
import { vincularVendasNf } from './nfVendasApi';
import { NfDevolucaoVendasModal } from './NfDevolucaoVendasModal';
import { vincularDevolucaoVendasNf, type CredenciaisDevolucao, type ItemDevolucao } from './nfDevolucaoVendasApi';
import { vincularNfRotativo, type LadoRotativoNf } from '../inventario-rotativo/inventarioRotativoApi';
import { createResourceApi } from '../../shared/cadmaster/resourceApi';
import { configuracaoItemNf, recalcularNf } from './nfFiscalApi';
import { decomporItemNf, lerNf, liberarIndexadorNf, pedeLiberacaoEstoqueNegativo, pendentesDecomposicaoNf, processarNf, repasseAutomaticoNf, reverterNf,
  type PaiDecomposicao } from './nfProcessamentoApi';
import { NfDecomposicaoModal } from './NfDecomposicaoModal';
import { faturamentoDaNota, excluirFinanceiroNf, configuracaoParcelas, gerarParcelas, sequenciaDuplicata, processarFinanceiroNf, type ParcelaGerada } from './nfFaturamentoApi';
import { transmitirNf, cancelarNf, cceNf } from './nfNfeApi';

/** Tipo da nota (parametrização Entrada/Saída — espelha o `ParametroCriacao` 35/36 do legado). */
export type NfTipo = 'E' | 'S';
const TITULO: Record<NfTipo, string> = {
  E: 'Notas Fiscais de Entrada',
  S: 'Notas Fiscais de Saída',
};
/** papel do parceiro por tipo: entrada=fornecedor (FRN), saída=cliente (CLI). */
const PAPEL_FLAG: Record<NfTipo, 'frn' | 'cli'> = { E: 'frn', S: 'cli' };
const PARCEIRO_LABEL: Record<NfTipo, string> = { E: 'Fornecedor', S: 'Cliente' };

/** hoje em ISO 'YYYY-MM-DD' (DTEMISSAO/DTCONTABIL default hoje, como no OnNewRecord do legado). */
const hojeISO = () => new Date().toISOString().slice(0, 10);
const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** combos {value:number} → {value:string} p/ o SelectField. */
const toStr = (opts: ReadonlyArray<{ value: number; label: string }>): Opcao[] =>
  opts.map((o) => ({ value: String(o.value), label: o.label }));

type OpcaoCfop = Opcao & { tipo: string | null };
type OpcaoSituacao = Opcao & { tipo: string | null; qtdeCfop: number; importacaoAuto?: string | null };

type LookupOptions = {
  parceiroOptions: Opcao[];
  transpOptions: Opcao[];
  cfopOptions: OpcaoCfop[];
  situacaoOptions: OpcaoSituacao[];
  /** a situação do CABEÇALHO: só as do tipo da nota que têm CFOP (a consulta do legado faz JOIN com os CFOPs dela) */
  situacaoNfOptions?: Opcao[];
  plcOptions: Opcao[];
  aliquotaOptions: Opcao[];
  unidadeOptions: Opcao[];
  produtoOptions: Opcao[];
  modeloOptions: Opcao[];
};

/**
 * NOTA FISCAL (tela-coroa) — UI fiel ao LEGADO (`TfrmNF`): banda de cabeçalho + barra de abas em
 * folder (Cálculo de impostos / Itens / Financeiro / NF's Referência / Dados Gerais / Transporte /
 * Lançamentos contábeis + abas de fase futura) e barra de ações NF-e no rodapé — POSIÇÕES do legado,
 * VISUAL do design system (tokens Apollo). Construída sobre o `<CadMaster>` (largo) + o engine agregado.
 *
 * Wiring por fase: Cadastro/Itens/Cálculo (F1/F2), Financeiro (F4), Contábil (F5), NFe/SEFAZ (F6).
 * As abas presentes-mas-inertes (Pedidos/Serviço/Importação/Devoluções/NFe Avulsa/NF devolução/Acesso
 * XML/Carta Correção como aba) reproduzem o strip do legado; o conteúdo entra em fases futuras (dossiê §10).
 * As TRAVAS de estado (proc/contabilizado/enviada/cancelada) desabilitam os campos (o servidor reforça 422).
 */
export function NfCadMaster({ tipo }: { tipo: NfTipo }) {
  const flag = PAPEL_FLAG[tipo];

  // ── LOOKUPs ──
  const { data: parceiroOptions = [] } = useResourceOptions(
    'cadastro/parceiros',
    (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao}` }),
    { campo: flag, operador: 'igual', valor: 'S' },
  );
  const { data: transpOptions = [] } = useResourceOptions(
    'cadastro/parceiros',
    (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao}` }),
    { campo: 'tra', operador: 'igual', valor: 'S' },
  );
  const { data: cfopOptions = [] } = useResourceOptions('cadastro/cfops', (c: any): OpcaoCfop => ({
    value: String(c.codcfop).trim(),
    label: `${c.codcfop} - ${c.descricao}`,
    tipo: c.tipo ?? null,
  }));
  const { data: situacaoOptions = [] } = useResourceOptions('cadastro/situacoes-nf', (s: any): OpcaoSituacao => ({
    value: String(s.idsituacao_nf),
    label: `${s.idsituacao_nf} - ${s.descricao}`,
    tipo: s.tipo ?? null,
    qtdeCfop: Number(s.qtde_cfop ?? 0),
    importacaoAuto: s.importacao_auto_nf ? String(s.importacao_auto_nf).trim().toUpperCase() : null,
  }));
  const { data: plcOptions = [] } = useResourceOptions('cadastro/plc', (c: any) => ({
    value: String(c.codplc),
    label: `${c.desccodplc ?? c.codplc} - ${c.descricao}`,
  }));
  const { data: aliquotaOptions = [] } = useResourceOptions('cadastro/aliquotas', (a: any) => ({
    value: String(a.codigo),
    label: `${a.codigo} - ${a.descricao}`,
  }));
  const { data: unidadeOptions = [] } = useResourceOptions('cadastro/unidades', (u: any) => ({
    value: String(u.sigla),
    label: `${u.sigla} - ${u.descricao}`,
  }));
  const { data: produtoOptions = [] } = useResourceOptions('cadastro/produtos', (r: any) => ({
    value: String(r.idproduto ?? r.codigo),
    label: `${r.codbarra} - ${r.descricao}`,
  }));

  const modeloOptions = tipo === 'E' ? toStr(NF_MODELO_OPCOES_ENTRADA) : toStr(NF_MODELO_OPCOES_SAIDA);
  const opts: LookupOptions = {
    parceiroOptions, transpOptions, cfopOptions, situacaoOptions,
    plcOptions, aliquotaOptions, unidadeOptions, produtoOptions, modeloOptions,
  };

  const defaultValues = useMemo<Partial<CriarNfDto>>(
    () => ({
      tipo,
      modelo: 55,
      nronf: '',
      serie: '1',
      dtemissao: hojeISO(),
      dtcontabil: hojeISO(),
      tipoemissao: '0',
      finalidade: '1',
      proc: 'N',
      cancelada: 'N',
      contabilizado: 'N',
      codparceiro: undefined,
      itens: [],
      referencias: [],
      contabil: [],
    }),
    [tipo],
  );

  return (
    <CadMaster<CriarNfDto>
      titulo={TITULO[tipo]}
      resourcePath="fiscal/nf"
      pk="codnf"
      log={{ form: 'FRMNF', chave: 'CODNF' }}
      schema={nfSchema}
      defaultValues={defaultValues}
      largura="6xl"
      gerenciaEdicaoInterna
      filtroPesquisa={{ campo: 'tipo', operador: 'igual', valor: tipo }}
      colunasPesquisa={[
        { campo: 'codnf', label: 'Código', tipo: 'text', largura: 100 },
        { campo: 'nronf', label: 'Número', tipo: 'text', largura: 120 },
        { campo: 'serie', label: 'Série', tipo: 'text', largura: 90 },
        { campo: 'parceiro', label: PARCEIRO_LABEL[tipo], tipo: 'text' },
        { campo: 'dtemissao', label: 'Emissão', tipo: 'date', largura: 130 },
        { campo: 'statusnfe', label: 'Status', tipo: 'text', largura: 100 },
        { campo: 'totalnf', label: 'Total', tipo: 'text', largura: 130 },
      ]}
      campos={({ form, editavel }) => <NfForm form={form} editavel={editavel} tipo={tipo} opts={opts} />}
    />
  );
}

// ═══════════════════════════════ Formulário tabulado (layout do legado) ═══════════════════════════════

const DEFERRED_TABS = new Set(['pedidos', 'servico', 'cce', 'impexp', 'devcompra', 'avulsa', 'nfdev', 'xml']);

/**
 * as opções que dependem da SITUAÇÃO (UCadSituacaoNF.md C2): a situação do cabeçalho só lista as do tipo da nota que
 * têm CFOP (TfrmConsultaSituacaoDocumento, uNF.pas:15996 — a consulta faz JOIN com os CFOPs da situação); o CFOP, do
 * cabeçalho e do item, só os do tipo da nota e, com situação que tem CFOP, só os dela (btnAddCFOPClick, uNF.pas:2955;
 * btnCFOPClick, uItensNF.pas:1080). O valor já gravado continua na lista — a NF antiga abre como está.
 */
function useOpcoesDaSituacao(form: UseFormReturn<CriarNfDto>, tipo: NfTipo, opts: LookupOptions): LookupOptions {
  const sit = Number(form.watch('idsituacao_nf') ?? 0);
  const cfopAtual = String(form.watch('cfop') ?? '').trim();
  const { data: cfopsDaSituacao } = useQuery({
    queryKey: ['cadastro/situacoes-nf', sit, 'cfops'],
    queryFn: () => createResourceApi<{ cfops?: Array<{ codcfop: unknown }> }>('cadastro/situacoes-nf').ler(sit),
    enabled: sit > 0,
    select: (r) => new Set((r.cfops ?? []).map((c) => String(c.codcfop).trim())),
  });
  return useMemo(() => {
    const situacaoNfOptions = opts.situacaoOptions.filter((o) => (o.tipo === tipo && o.qtdeCfop > 0) || Number(o.value) === sit);
    const filtroSit = sit > 0 && cfopsDaSituacao && cfopsDaSituacao.size > 0 ? cfopsDaSituacao : null;
    const cfopOptions = opts.cfopOptions.filter((o) =>
      o.value === cfopAtual || ((!o.tipo || o.tipo === tipo) && (!filtroSit || filtroSit.has(o.value))));
    return { ...opts, situacaoNfOptions, cfopOptions };
  }, [opts, tipo, sit, cfopAtual, cfopsDaSituacao]);
}

function NfForm({
  form,
  editavel,
  tipo,
  opts,
}: {
  form: UseFormReturn<CriarNfDto>;
  editavel: boolean;
  tipo: NfTipo;
  opts: LookupOptions;
}) {
  // aba ativa (o legado abre em "Cálculo de impostos"; começamos em Itens, que é onde se digita)
  const [aba, setAba] = useState('itens');
  const optsNf = useOpcoesDaSituacao(form, tipo, opts);

  // TRAVA de estado (espelha dsNFStateChange + bloqueios do btnEditar do legado):
  const proc = form.watch('proc');
  const statusnfe = form.watch('statusnfe');
  const contabilizado = form.watch('contabilizado');
  const cancelada = form.watch('cancelada');
  // (sem trava pelo financeiro: o `btnEditarClick` do legado não barra a nota com título — corte D do faturamento)
  const travado =
    proc === 'S' || contabilizado === 'S' ||
    cancelada === 'S' || statusnfe === 'P' || statusnfe === 'D' || statusnfe === 'C';
  const liberado = editavel && !travado;

  // strip de abas do legado (2 linhas → flex-wrap). Abas de fase futura entram como `disabled`.
  const mainTabs: TabDef[] = [
    { id: 'calc', label: 'Cálculo de impostos' },
    { id: 'itens', label: 'Itens da nota' },
    { id: 'fin', label: 'Financeiro' },
    { id: 'ref', label: "NF's Referência" },
    { id: 'dados', label: 'Dados Gerais / Obs' },
    { id: 'transp', label: 'Transporte' },
    { id: 'contabil', label: 'Lançamentos contábeis' },
    { id: 'pedidos', label: 'Pedidos', disabled: true },
    { id: 'servico', label: 'Serviço', disabled: true },
    { id: 'cce', label: 'Carta Correção', disabled: true },
    { id: 'impexp', label: 'Importação/Exportação', disabled: true },
    { id: 'devcompra', label: 'Devoluções da Compra', disabled: true },
    { id: 'avulsa', label: 'NFe Avulsa', disabled: true },
    { id: 'nfdev', label: 'NF de devolução', disabled: true },
    { id: 'xml', label: 'Acesso ao XML', disabled: true },
  ];

  return (
    <div className="flex flex-col gap-form-gap">
      {travado && (
        <div className="rounded-radius-base border border-border bg-bg-subtle p-pad-sm text-fg-muted">
          Nota{' '}
          {proc === 'S'
            ? 'processada'
            : cancelada === 'S' || statusnfe === 'C'
              ? 'cancelada'
              : contabilizado === 'S'
                ? 'contabilizada'
                : 'enviada à Receita'}{' '}
          — edição bloqueada.
        </div>
      )}

      {/* BANDA DE CABEÇALHO (posições do legado: Tipo/Modelo/Nº/Série/Emissão/… + Destinatário + Total NF) */}
      <CabecalhoBand form={form} editavel={liberado} tipo={tipo} opts={optsNf} />

      {/* BARRA DE ABAS + CONTEÚDO (folder tabs do legado) */}
      <div>
        <Tabs tabs={mainTabs} active={aba} onChange={setAba} />
        <TabPanel>
          {aba === 'calc' && <CalcTab form={form} liberado={liberado} />}
          {aba === 'itens' && <ItensSection form={form} editavel={liberado} opts={optsNf} />}
          {aba === 'fin' && <FinTab form={form} liberado={liberado} tipo={tipo} />}
          {aba === 'ref' && <ReferenciasSection form={form} editavel={liberado} />}
          {aba === 'dados' && <DadosGeraisTab form={form} editavel={liberado} />}
          {aba === 'transp' && <TransporteSection form={form} editavel={liberado} transpOptions={opts.transpOptions} />}
          {aba === 'contabil' && (
            <ContabilSection form={form} editavel={liberado} situacaoOptions={opts.situacaoOptions} plcOptions={opts.plcOptions} />
          )}
          {DEFERRED_TABS.has(aba) && <PlaceholderTab nome={mainTabs.find((t) => t.id === aba)?.label ?? ''} />}
        </TabPanel>
      </div>

      {/* BARRA DE AÇÕES NF-e (rodapé do legado): Processar/Reverter (F3) + NFe/SEFAZ (F6) + strip inerte. */}
      <AcoesNfeBar form={form} />
    </div>
  );
}

/** aba presente no legado, conteúdo de fase futura (dossiê §10). Mantém a fidelidade do strip. */
function PlaceholderTab({ nome }: { nome: string }) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center gap-gp-xs text-center text-fg-muted">
      <span className="text-body-sm font-semibold text-fg-default">{nome}</span>
      <small>Aba do legado — conteúdo previsto para fase futura (ver dossiê §10).</small>
    </div>
  );
}

// ───────────────────────────── Banda de cabeçalho ─────────────────────────────

function CabecalhoBand({
  form,
  editavel,
  tipo,
  opts,
}: {
  form: UseFormReturn<CriarNfDto>;
  editavel: boolean;
  tipo: NfTipo;
  opts: LookupOptions;
}) {
  const err = form.formState.errors;
  const totalnf = Number(form.watch('totalnf')) || 0;
  const chavenfe = form.watch('chavenfe') as string | undefined;
  const tipoLabel = tipo === 'E' ? 'Entrada' : 'Saída';

  return (
    <fieldset disabled={!editavel} className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
      <div className="mb-form-gap flex items-center gap-gp-sm">
        <span className="rounded-radius-base bg-bg-subtle px-pad-sm py-pad-xs text-body-sm font-semibold text-fg-default">
          {tipoLabel}
        </span>
        <span className="text-fg-muted">·</span>
        <span className="text-body-sm text-fg-muted">Cabeçalho da nota</span>
        <span className="ml-auto text-body-sm text-fg-muted">Total da nota</span>
        <span className="rounded-radius-base bg-bg-subtle px-pad-sm py-pad-xs text-body-sm font-semibold text-fg-default tabular-nums">
          R$ {fmtBRL(totalnf)}
        </span>
      </div>

      {/* linha 1: Modelo / Nº / Série / Emissão / Data contábil / Tipo de emissão */}
      <div className="grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-6">
        <Controller
          control={form.control}
          name="modelo"
          render={({ field }) => (
            <SelectField
              label="&Modelo"
              options={opts.modeloOptions}
              value={field.value != null ? String(field.value) : undefined}
              onChange={(v) => field.onChange(v ? Number(v) : undefined)}
              placeholder="Selecione…"
              error={err.modelo?.message as string | undefined}
            />
          )}
        />
        <Field
          label="&Número"
          inputMode="numeric"
          error={err.nronf?.message as string | undefined}
          {...form.register('nronf')}
        />
        <Field label="&Série" error={err.serie?.message as string | undefined} {...form.register('serie')} />
        <Controller
          control={form.control}
          name="dtemissao"
          render={({ field }) => (
            <DateField
              label="&Emissão"
              value={(field.value as string) || undefined}
              onChange={(v) => field.onChange(v ?? '')}
              error={err.dtemissao?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="dtcontabil"
          render={({ field }) => (
            <DateField
              label="Data &contábil"
              value={(field.value as string) || undefined}
              onChange={(v) => field.onChange(v ?? '')}
              error={err.dtcontabil?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="tipoemissao"
          render={({ field }) => (
            <SelectField
              label="&Tipo de emissão"
              options={NF_TIPOEMISSAO_OPCOES as unknown as Opcao[]}
              value={field.value ?? undefined}
              onChange={(v) => field.onChange(v || undefined)}
              placeholder="Selecione…"
              error={err.tipoemissao?.message as string | undefined}
            />
          )}
        />
      </div>

      {/* o TOTAL NF da entrada: o valor da nota em papel, que o operador confere (obrigatório no gravar; no processar da nota de terceiros
          tem de bater com o total calculado — uNF.pas:4644, :15003). Na importada vem do XML e fica travado */}
      {tipo === 'E' && (
        <div className="mt-form-gap grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-6">
          <Controller
            control={form.control}
            name={'validatotalnf' as never}
            render={({ field }) => (
              <CurrencyField
                label="Total N&F"
                value={field.value != null && String(field.value) !== '' ? Number(field.value) : undefined}
                onChange={(v) => field.onChange(v)}
                disabled={String(form.watch('nf_importacao_nfe' as never) ?? '') === 'S' && Number(field.value) > 0}
                error={(err as Record<string, { message?: string }>).validatotalnf?.message}
              />
            )}
          />
          {Number(form.watch('validatotalnf' as never)) > 0 && Number(form.watch('validatotalnf' as never)).toFixed(2) !== totalnf.toFixed(2) && (
            <small className="self-end pb-pad-xs text-body-sm text-warning">Não confere com o total da nota (R$ {fmtBRL(totalnf)}).</small>
          )}
        </div>
      )}

      {/* linha 2: CFOP / Situação / Finalidade */}
      <div className="mt-form-gap grid grid-cols-1 gap-form-gap sm:grid-cols-3">
        <Controller
          control={form.control}
          name="cfop"
          render={({ field }) => (
            <SelectField
              label="C&FOP"
              options={opts.cfopOptions}
              value={field.value ?? undefined}
              onChange={(v) => field.onChange(v || undefined)}
              placeholder="Selecione o CFOP…"
              error={err.cfop?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="idsituacao_nf"
          render={({ field }) => (
            <SelectField
              label="&Situação (natureza)"
              options={opts.situacaoNfOptions ?? opts.situacaoOptions}
              value={field.value != null ? String(field.value) : undefined}
              onChange={(v) => field.onChange(v ? Number(v) : undefined)}
              placeholder="Selecione a situação…"
              error={err.idsituacao_nf?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="finalidade"
          render={({ field }) => (
            <SelectField
              label="&Finalidade da nota"
              options={NF_FINALIDADE_OPCOES as unknown as Opcao[]}
              value={field.value ?? undefined}
              onChange={(v) => field.onChange(v || undefined)}
              placeholder="Selecione…"
              error={err.finalidade?.message as string | undefined}
            />
          )}
        />
      </div>

      {/* linha 3: Destinatário / Remetente (parceiro, largo) */}
      <div className="mt-form-gap">
        <Controller
          control={form.control}
          name="codparceiro"
          render={({ field }) => (
            <SelectField
              label={`&${PARCEIRO_LABEL[tipo]} (destinatário / remetente)`}
              options={opts.parceiroOptions}
              value={field.value != null ? String(field.value) : undefined}
              onChange={(v) => field.onChange(v ? Number(v) : undefined)}
              placeholder={`Selecione o ${PARCEIRO_LABEL[tipo].toLowerCase()}…`}
              error={err.codparceiro?.message as string | undefined}
            />
          )}
        />
      </div>

      {chavenfe && (
        <div className="mt-form-gap flex flex-wrap items-center gap-gp-sm">
          <span className="text-body-sm text-fg-muted">Chave NFe</span>
          <code className="font-mono text-sm text-fg-default">{chavenfe}</code>
        </div>
      )}
    </fieldset>
  );
}

// ───────────────────────────── Aba: Cálculo de impostos (totais read-only + sub-abas) ─────────────────────────────

function Ro({ label, value }: { label: string; value: number }) {
  return (
    <label className="flex flex-col gap-gp-xs">
      <span className="text-body-sm text-fg-muted">{label}</span>
      <span className="rounded-radius-base border border-border bg-bg-subtle px-pad-sm py-pad-xs text-right tabular-nums text-fg-default">
        {fmtBRL(value)}
      </span>
    </label>
  );
}

function CalcTab({ form, liberado }: { form: UseFormReturn<CriarNfDto>; liberado: boolean }) {
  const [sub, setSub] = useState('internos');
  const w = (n: keyof CriarNfDto) => Number(form.watch(n as any)) || 0;
  const subTabs: TabDef[] = [
    { id: 'internos', label: 'Impostos Internos' },
    { id: 'stext', label: 'ICMS ST Externo', disabled: true },
    { id: 'inter', label: 'ICMS Interestadual', disabled: true },
    { id: 'ret', label: 'Retenções' },
    { id: 'tribdev', label: 'Tributos devolvidos', disabled: true },
  ];
  return (
    <div className="flex flex-col gap-form-gap">
      <Tabs tabs={subTabs} active={sub} onChange={setSub} variant="sub" />
      {sub === 'internos' && (
        <>
          <div className="grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-4">
            <Ro label="Base ICMS" value={w('totalbaseicm')} />
            <Ro label="Valor ICMS" value={w('totalicm')} />
            <Ro label="ICMS Substituição" value={w('totalicm_st')} />
            <Ro label="Total dos produtos" value={w('totalprod')} />
            <Ro label="Descontos" value={w('totaldesc')} />
            <Ro label="Frete" value={w('totalfrete')} />
            <Ro label="Seguro" value={w('totalseguro')} />
            <Ro label="Acessórias" value={w('totalacessorias')} />
            <Ro label="IPI" value={w('totalipi')} />
            <Ro label="Isento" value={w('totalisento')} />
            <Ro label="Total da nota" value={w('totalnf')} />
          </div>
          <small className="text-fg-muted">
            Valores calculados a partir dos itens (aba «Itens da nota» → «Recalcular impostos»). Somente leitura.
          </small>
        </>
      )}
      {sub === 'ret' && (
        <>
          <div className="grid grid-cols-2 gap-form-gap sm:grid-cols-3 lg:grid-cols-4">
            <Ro label="Total PIS" value={w('total_ret_pis' as any)} />
            <Ro label="Total COFINS" value={w('total_ret_cofins' as any)} />
            <Ro label="Total CSLL" value={w('total_ret_csll' as any)} />
            <Ro label="Total IR" value={w('total_ret_ir' as any)} />
            <Ro label="Total INSS" value={w('total_ret_inss' as any)} />
            <Ro label="Total ISSQN" value={w('total_ret_issqn' as any)} />
            <Ro label="Total FUNRURAL" value={w('total_ret_funrural' as any)} />
          </div>
          <small className="text-fg-muted">
            Retenções (PIS/COFINS/CSLL/IR/INSS/ISSQN/FUNRURAL) calculadas no servidor conforme a situação da NF
            e as flags do parceiro. {!liberado && 'Nota travada — somente leitura.'}
          </small>
        </>
      )}
      {(sub === 'stext' || sub === 'inter' || sub === 'tribdev') && (
        <PlaceholderTab nome={subTabs.find((t) => t.id === sub)?.label ?? ''} />
      )}
    </div>
  );
}

// ───────────────────────────── Aba: Financeiro (sub-abas do legado) ─────────────────────────────

function FinTab({ form, liberado, tipo }: { form: UseFormReturn<CriarNfDto>; liberado: boolean; tipo: NfTipo }) {
  const [sub, setSub] = useState('cobranca');
  const subTabs: TabDef[] = [
    { id: 'cobranca', label: 'Dados da cobrança' },
    { id: 'docs', label: 'Documentos financeiros' },
    { id: 'formas', label: 'Formas de pagamento', disabled: true },
  ];
  return (
    <div className="flex flex-col gap-form-gap">
      <Tabs tabs={subTabs} active={sub} onChange={setSub} variant="sub" />
      {sub === 'cobranca' && (
        <>
          <ParcelasSection form={form} liberado={liberado} processada={form.watch('proc') === 'S' && form.watch('cancelada') !== 'S'} />
          <FaturamentoSection form={form} tipo={tipo} />
        </>
      )}
      {sub === 'docs' && (
        <small className="text-fg-muted">
          Os documentos financeiros (títulos em {tipo === 'E' ? 'A Pagar' : 'A Receber'}) nascem das parcelas no
          «Faturamento» (aba «Dados da cobrança»). {!liberado && ''}
        </small>
      )}
      {sub === 'formas' && <PlaceholderTab nome="Formas de pagamento" />}
    </div>
  );
}

// ───────────────────────────── Barra de ações NF-e (rodapé do legado) ─────────────────────────────

const NFE_INERTES = ['Inutilizar', 'Imprimir', 'Importar', 'Salvar XML', 'Recuperar XML', 'Enviar Email'];

function AcoesNfeBar({ form }: { form: UseFormReturn<CriarNfDto> }) {
  const codnf = (form.getValues() as { codnf?: number }).codnf;
  if (codnf == null) return null; // ações só em nota gravada (como o legado habilita o rodapé)
  return (
    <fieldset className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">NF-e / Ações</legend>
      <div className="flex flex-col gap-form-gap">
        <div className="flex flex-wrap items-start gap-form-gap">
          <ProcessamentoSection form={form} />
          <NfeSefazSection form={form} />
        </div>
        {/* strip inerte fiel ao rodapé "NF-e" do legado (fase futura / infra externa) */}
        <div className="flex flex-wrap items-center gap-gp-xs border-t border-border pt-pad-sm">
          <span className="text-body-sm text-fg-muted">NF-e:</span>
          {NFE_INERTES.map((l) => (
            <button
              key={l}
              type="button"
              disabled
              title="Disponível em fase futura (impressão/XML/e-mail/inutilização — infra externa)"
              className="cursor-not-allowed rounded-radius-base border border-border bg-bg-subtle px-pad-sm py-pad-xs text-body-sm text-fg-muted opacity-60"
            >
              {l}
            </button>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

// ───────────────────────────── Processamento (F3) ─────────────────────────────

/** o login de liberação do PRÓPRIO usuário para liberar a nota do indexador (o `ChamaLiberacaoLogin` com a lista só dele) */
function LiberarIndexadorModal({ liberada, onFechar, onConfirmar }: { liberada: boolean; onFechar: () => void; onConfirmar: (c: { login: string; senha: string }) => void }) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  return (
    <Modal
      open
      onClose={onFechar}
      size="sm"
      title={liberada ? 'Utilizar indexador tributário na nota fiscal' : 'Liberar nota fiscal para não usar indexador'}
      primaryAction={{ label: 'Confirmar', onClick: () => onConfirmar({ login, senha }) }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-form-gap">
        <small className="text-fg-muted">Confirme com o seu login e a sua senha.</small>
        <Field label="&Login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
        <Field label="&Senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" />
      </div>
    </Modal>
  );
}

/** os totais do cabeçalho que a análise automática refaz (somas dos itens) */
const TOTAIS_DA_ANALISE = ['totalicm', 'totalbaseicm', 'totalicm_st', 'totalbaseicmt', 'totalnf', 'total_icmst_externo', 'totalbase_stexterno', 'total_streal',
  'icms_st_apagar', 'totalicm_stexterno_sepnf'] as const;

/**
 * Ações de PROCESSAMENTO (F3): movem o estoque (entrada soma / saída baixa) e travam a nota.
 * "Processar" quando proc='N'; "Reverter" quando proc='S' e a nota não foi enviada à SEFAZ.
 */
function ProcessamentoSection({ form }: { form: UseFormReturn<CriarNfDto> }) {
  const mensagem = useMensagem();
  const [executando, setExecutando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const proc = form.watch('proc');
  const statusnfe = form.watch('statusnfe');
  const tipoNota = form.watch('tipo');
  const liberada = String(form.watch('libera_nf_indexador' as never) ?? '') === 'S';
  const [podeLiberar, setPodeLiberar] = useState(false);
  const [liberando, setLiberando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [liberandoNegativo, setLiberandoNegativo] = useState<{ itens: Array<{ nroitem: number; codproduto: number; saldo: number }>; acao: (c: { login: string; senha: string }) => Promise<void> } | null>(null);
  useEffect(() => {
    let vivo = true;
    configuracaoItemNf().then((c) => { if (vivo) setPodeLiberar(Boolean(c.liberaNfIndexador)); }).catch(() => undefined);
    return () => { vivo = false; };
  }, []);
  const codnf = (form.getValues() as { codnf?: number }).codnf;
  // a ENTRADA DECOMPOSTA (VerificaProdutosComEntradaEmDescomposicao, uNF.pas:17435): a nota de entrada não processada com item de produto que
  // entra decomposto abre o diálogo de cada um — o legado faz no Editar; aqui, ao abrir a nota gravada (e depois de cada gravação).
  // Cancelar deixa o item (e o processar travado); o aviso fica com o botão para retomar
  const itensGravados = form.watch('itens');
  const chaveItens = (itensGravados ?? []).map((i) => `${i.codproduto}`).join(',');
  const [pendentes, setPendentes] = useState<PaiDecomposicao[]>([]);
  const [decompondo, setDecompondo] = useState(false);
  useEffect(() => {
    let vivo = true;
    if (codnf == null || tipoNota !== 'E' || proc === 'S' || form.formState.isDirty) { setPendentes([]); return; }
    pendentesDecomposicaoNf(codnf).then((p) => { if (vivo) { setPendentes(p); setDecompondo(p.length > 0); } }).catch(() => undefined);
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codnf, tipoNota, proc, chaveItens]);
  if (codnf == null) return null;

  const decompor = async (pai: PaiDecomposicao, e: { qtdTotal: number; valorTotal: number; cfop: number }) => {
    if (form.formState.isDirty) { mensagem.erro('Grave a nota fiscal antes de iniciar a decomposição.'); return; }
    try {
      await decomporItemNf(codnf, { codnfprod: pai.codnfprod, ...e });
      const nf = await lerNf(codnf);
      form.setValue('itens', (nf.itens ?? []) as never, { shouldDirty: false });
      for (const k of [...TOTAIS_DA_ANALISE, 'totalprod', 'qtde'] as const) if (nf[k] !== undefined) form.setValue(k as never, nf[k] as never, { shouldDirty: false });
      mensagem.sucesso(`${pai.descricao ?? 'Item'}: os produtos da decomposição foram lançados à nota.`);
    } catch (err) {
      mensagem.erro(err);
    }
  };

  const enviada = statusnfe === 'P' || statusnfe === 'D';

  const processar = async (cred?: { login: string; senha: string }) => {
    if (executando) return;
    setExecutando(true);
    try {
      await processarNf(codnf, cred ? { liberacaoEstoqueNegativo: cred } : undefined);
      form.setValue('proc', 'S');
      setLiberandoNegativo(null);
      mensagem.sucesso('Nota processada: estoque movimentado.');
    } catch (e) {
      const itens = pedeLiberacaoEstoqueNegativo(e);
      if (itens && !cred) setLiberandoNegativo({ itens, acao: (c) => processar(c) });
      else mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  // [F7] da análise de itens: o servidor refaz indexador, ST externo, base/ICMS e custo de cada item; a tela relê a nota
  const analisarItens = async () => {
    if (executando) return;
    setExecutando(true);
    try {
      const r = await repasseAutomaticoNf(codnf);
      const nf = await lerNf(codnf);
      form.setValue('itens', (nf.itens ?? []) as never, { shouldDirty: false });
      for (const k of TOTAIS_DA_ANALISE) if (nf[k] !== undefined) form.setValue(k as never, nf[k] as never, { shouldDirty: false });
      mensagem.sucesso(`Análise automática: ${r.itens} ${r.itens === 1 ? 'item' : 'itens'}, ${r.comIndexador} com indexador, ${r.repassados} repassado(s).`);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const reverter = async (cred?: { login: string; senha: string }) => {
    if (executando) return;
    if (!cred && !window.confirm('Ao reverter o processamento, o estoque será revertido. Confirma a operação?')) return;
    setExecutando(true);
    try {
      await reverterNf(codnf, cred);
      form.setValue('proc', 'N');
      setLiberandoNegativo(null);
      mensagem.sucesso('Processamento revertido: estoque estornado.');
    } catch (e) {
      const itens = pedeLiberacaoEstoqueNegativo(e);
      if (itens && !cred) setLiberandoNegativo({ itens, acao: (c) => reverter(c) });
      else mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  return (
    <div className="flex min-w-56 flex-1 flex-col gap-gp-xs rounded-radius-base border border-border p-pad-sm">
      <span className="text-body-sm font-semibold text-fg-default">Processamento (estoque)</span>
      <div className="flex flex-wrap items-center gap-gp-sm">
        {proc !== 'S' && <Button label="&Processar nota" variant="soft" onClick={() => (tipoNota === 'E' ? setProcessando(true) : void processar())} />}
        {proc !== 'S' && <Button label="Sincronizar CFOP/alíq./CST" variant="soft" onClick={() => setSincronizando(true)} />}
        {proc !== 'S' && tipoNota === 'E' && <Button label="Análise automática dos itens [F7]" variant="soft" onClick={() => void analisarItens()} />}
        {proc !== 'S' && podeLiberar && (
          <Button label={liberada ? 'Utilizar indexador tributário na nota fiscal' : 'Liberar nota fiscal para não usar indexador'} variant="soft" onClick={() => setLiberando(true)} />
        )}
        {proc === 'S' && !enviada && (
          <Button label="&Reverter processamento" variant="soft" onClick={() => void reverter()} />
        )}
      </div>
      {sincronizando && (
        <NfSincronizarModal codnf={codnf} itens={form.getValues('itens') ?? []} onFechar={() => setSincronizando(false)}
          onSincronizado={(p) => {
            // o servidor já gravou: reflete nos itens da tela (cada item recebe o "novo" do seu valor original, uma vez)
            const troca = (lista: Array<{ de: string; para: string }>, v: string) => lista.find((x) => x.de === v)?.para;
            const itens = (form.getValues('itens') ?? []).map((it) => {
              const cfop = troca(p.mapa, String(it.cfop ?? ''));
              const aliq = troca(p.aliquotas, String(it.aliquota ?? '').trim().toUpperCase());
              const cst = troca(p.csts, String(Number((it as { cst?: unknown }).cst ?? 0)).padStart(3, '0'));
              return { ...it, ...(cfop ? { cfop } : {}), ...(aliq ? { aliquota: aliq } : {}), ...(cst ? { cst: Number(cst) } : {}) };
            });
            form.setValue('itens', itens as never, { shouldDirty: false });
            setSincronizando(false);
          }} />
      )}
      {liberandoNegativo && (
        <LiberacaoEstoqueNegativoModal itens={liberandoNegativo.itens} onFechar={() => setLiberandoNegativo(null)} onConfirmar={(c) => void liberandoNegativo.acao(c)} />
      )}
      {processando && (
        <NfProcessarModal codnf={codnf} onFechar={() => setProcessando(false)} onProcessado={() => { form.setValue('proc', 'S'); setProcessando(false); }} />
      )}
      {liberando && (
        <LiberarIndexadorModal liberada={liberada} onFechar={() => setLiberando(false)} onConfirmar={async (cred) => {
          try {
            const r = await liberarIndexadorNf(codnf, cred);
            form.setValue('libera_nf_indexador' as never, r.libera_nf_indexador as never, { shouldDirty: false });
            setLiberando(false);
            mensagem.sucesso(r.libera_nf_indexador === 'S'
              ? 'Nota liberada do uso do indexador. Repasse os itens (análise automática) para recalcular.'
              : 'A nota volta a usar o indexador tributário. Repasse os itens (análise automática) para recalcular.');
          } catch (e) {
            mensagem.erro(e);
          }
        }} />
      )}
      {decompondo && pendentes[0] && (
        <NfDecomposicaoModal key={pendentes[0].codnfprod} pai={pendentes[0]} restantes={pendentes.length - 1}
          onFechar={() => setDecompondo(false)} onConfirmar={(e) => void decompor(pendentes[0], e)} />
      )}
      {pendentes.length > 0 && proc !== 'S' && (
        <div className="flex flex-wrap items-center gap-gp-sm">
          <small className="text-warning">
            {pendentes.map((p) => p.descricao).join(', ')}: entrada em decomposição. Os produtos da decomposição deverão ser lançados à nota.
          </small>
          {!decompondo && <Button label="Decompor" variant="soft" onClick={() => setDecompondo(true)} />}
        </div>
      )}
      {liberada && <small className="text-warning">Nota fiscal liberada para não usar indexador.</small>}
      <small className="text-fg-muted">
        {proc === 'S' ? 'Nota processada (estoque movimentado).' : 'Nota não processada.'}
        {enviada ? ' Enviada à SEFAZ — reversão bloqueada.' : ''}
      </small>
    </div>
  );
}

// ───────────────────────────── Parcelas da nota (FATURAMENTO) ─────────────────────────────

type ParcelaForm = Omit<Partial<ParcelaGerada>, 'liberado'> & { codfaturamento?: number; codbarrasboleto?: string | null; liberado?: string | null };
const dataIso = (v: unknown) => (v == null || v === '' ? undefined : String(v).slice(0, 10));
const somaDias = (iso: string, dias: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
const diaNoMes = (iso: string, dia: number) => {
  const [a, m] = iso.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${a}-${String(m).padStart(2, '0')}-${String(Math.min(Math.max(dia, 1), ultimo)).padStart(2, '0')}`;
};

/**
 * As PARCELAS da nota (FATURAMENTO) — a aba "Dados da cobrança" do legado (uNF.pas:4389 e :16184): calcula as parcelas pela
 * base da nota e as põe na grade, que é gravada com a nota. O título nasce da parcela depois, no Faturamento.
 */
function ParcelasSection({ form, liberado, processada }: { form: UseFormReturn<CriarNfDto>; liberado: boolean; processada: boolean }) {
  const mensagem = useMensagem();
  const codnf = (form.getValues() as { codnf?: number }).codnf;
  const { fields, replace, update, remove } = useFieldArray<CriarNfDto, 'faturamento', 'fieldId'>({ control: form.control, name: 'faturamento', keyName: 'fieldId' });
  const { data: cfg, refetch } = useQuery({
    queryKey: ['fiscal/nf', codnf, 'parcelas/configuracao'],
    queryFn: () => configuracaoParcelas(Number(codnf)),
    enabled: codnf != null,
  });
  const [numParcelas, setNumParcelas] = useState<number | undefined>(1);
  const [vencimento, setVencimento] = useState<string | undefined>(hojeISO());
  const [diaVenc, setDiaVenc] = useState<number | undefined>(undefined);
  const [intervalo, setIntervalo] = useState<number | undefined>(undefined);
  const [tipoCalc, setTipoCalc] = useState<'D' | 'I'>('I');
  const [nroDup, setNroDup] = useState<number | undefined>(undefined);
  const [executando, setExecutando] = useState(false);
  useEffect(() => {
    if (!cfg) return;
    setNumParcelas(cfg.numParcelas);
    setVencimento(cfg.vencimento);
    setDiaVenc(cfg.diaVenc || undefined);
    setIntervalo(cfg.intervalo || undefined);
    setTipoCalc(cfg.tipoCalc);
  }, [cfg]);

  if (codnf == null) return <small className="text-fg-muted">Grave a nota para gerar o financeiro.</small>;
  const linhas = fields as Array<ParcelaForm & { fieldId: string }>;
  const soma = Math.round(linhas.reduce((s, p) => s + (Number(p.valor) || 0), 0) * 100) / 100;
  const base = cfg?.base ?? 0;
  const aFaturar = Math.round((base - soma) * 100) / 100;
  // nota PROCESSADA: o menu "Processar financeiro" do legado (uFinanceiroNotaFiscal) — só o CFOP decide, e as faturas gravam à parte
  const modoFin = processada && !liberado;
  const podeGerar = (modoFin ? !!cfg?.habilitadoFinanceiro : liberado && !!cfg?.habilitado) && !executando;
  const editavel = liberado || (modoFin && !!cfg?.habilitadoFinanceiro);

  const gerar = async (proximoMes?: boolean, senhaAdmin?: string): Promise<void> => {
    let senha = senhaAdmin;
    if (cfg?.exigeSenha && senha == null) {
      const s = window.prompt('Informe a senha administrativa para gerar o financeiro de bonificação:');
      if (s == null) return;
      senha = s;
    }
    setExecutando(true);
    try {
      const r = await gerarParcelas(codnf, {
        numParcelas: Number(numParcelas) || 1, vencimento, intervalo: Number(intervalo) || 0, diaVenc: Number(diaVenc) || 0, tipoCalc,
        nroDup: nroDup ?? null, proximoMes, senhaAdmin: senha, modo: modoFin ? 'financeiro' : 'nota',
      });
      if ('perguntarProximoMes' in r) {
        setExecutando(false);
        const sim = window.confirm('A data de vencimento anterior a data de hoje.\nDeseja calcular o vencimento da primeira parcela para o próximo mês?');
        return gerar(sim, senha);
      }
      // regerar apaga as parcelas atuais (uNF.pas:4429) — saem com Excluiu ao gravar a nota
      replace(r.parcelas as never);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const limpar = () => {
    if (!window.confirm('Deseja apagar todos dados financeiros cadastrados?')) return;
    replace([]);
  };

  const sequencia = async () => {
    if (!window.confirm('Deseja gerar sequencia de duplicatas?')) return;
    try {
      setNroDup((await sequenciaDuplicata()).nroDup);
    } catch (e) {
      mensagem.erro(e);
    }
  };

  const gravarFaturas = async () => {
    setExecutando(true);
    try {
      await processarFinanceiroNf(codnf, form.getValues('faturamento') ?? []);
      const rec = await createResourceApi<{ faturamento?: unknown[] }>('fiscal/nf').ler(codnf);
      replace((rec.faturamento ?? []) as never);
      mensagem.sucesso('Faturas geradas com sucesso!\nEfetue o processamento do financeiro na tela de faturamento.');
      void refetch();
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const editar = (i: number, campo: keyof ParcelaForm, v: unknown) => update(i, { ...(linhas[i] as object), [campo]: v } as never);
  const cel = 'w-full rounded-radius-sm border border-border bg-bg-surface px-1 py-0.5 text-body-sm disabled:opacity-60';

  return (
    <div className="flex flex-col gap-gp-sm">
      <span className="text-body-sm font-semibold text-fg-default">{modoFin ? 'Parcelas da nota — processar financeiro' : 'Parcelas da nota'}</span>
      <div className="flex flex-wrap items-end gap-gp-sm">
        <div className="w-28">
          <NumberField label="Nº &parcelas" value={numParcelas} onChange={setNumParcelas} decimais={0} min={1} disabled={!podeGerar} />
        </div>
        <div className="w-40">
          <DateField label="1º &vencimento" value={vencimento} onChange={setVencimento} disabled={!podeGerar} />
        </div>
        <div className="w-28">
          <NumberField label="&Dia venc." value={diaVenc} decimais={0} min={0} max={31} disabled={!podeGerar}
            onChange={(v) => { setDiaVenc(v); if ((v ?? 0) > 0) { setTipoCalc('D'); setVencimento((d) => diaNoMes(d ?? hojeISO(), Number(v))); } }} />
        </div>
        <div className="w-28">
          <NumberField label="&Intervalo" value={intervalo} decimais={0} min={0} disabled={!podeGerar}
            onChange={(v) => { setIntervalo(v); setTipoCalc('I'); setVencimento(somaDias(hojeISO(), Number(v) || 0)); }} />
        </div>
        {cfg?.nroDupHabilitado && (
          <>
            <div className="w-32">
              <NumberField label="Nº d&uplicata" value={nroDup} onChange={setNroDup} decimais={0} min={0} disabled={!podeGerar} />
            </div>
            <Button label="Se&quência" variant="soft" disabled={!podeGerar} onClick={() => void sequencia()} />
          </>
        )}
        <Button label={cfg?.legenda ?? 'Ge&rar financeiro'} variant="soft" disabled={!podeGerar} onClick={() => void gerar()} />
        <Button label="&Limpar" variant="soft" disabled={!podeGerar || !linhas.length} onClick={limpar} />
        {modoFin && <Button label="Gra&var faturas" variant="soft" disabled={!podeGerar || !linhas.length} onClick={() => void gravarFaturas()} />}
      </div>
      <small className="text-fg-muted">
        Cálculo por {tipoCalc === 'D' ? 'dia fixo' : 'intervalo de dias'} · base {base.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} ·
        a faturar <strong className={aFaturar !== 0 ? 'text-danger' : ''}>{aFaturar.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
        {cfg?.temFinanceiro ? ' · a nota tem documentos financeiros' : ''}
        {cfg && cfg.parcelasPendentes > 0 ? ` · ${cfg.parcelasPendentes} parcela(s) a faturar` : ''}
        {cfg && !cfg.habilitado && cfg.motivo && cfg.motivo !== 'NF_PARCELAS_TEM_FINANCEIRO' ? ` · ${cfg.motivo === 'NF_PARCELAS_CFOP_SEM_FINANCEIRO' ? 'o CFOP desta nota não gera financeiro' : cfg.motivo === 'NF_PARCELAS_TEM_FINANCEIRO' ? 'a nota já tem documentos financeiros' : cfg.motivo === 'NF_PARCELAS_NOTA_PROCESSADA' ? 'nota processada' : 'informe o CFOP e o parceiro'}` : ''}
      </small>
      {linhas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="py-1 pr-2">Nº</th>
                <th className="py-1 pr-2">Data</th>
                <th className="py-1 pr-2">Duplicata</th>
                <th className="py-1 pr-2">Modalidade</th>
                <th className="py-1 pr-2 text-right">Valor</th>
                <th className="py-1 pr-2">Código de barra boleto</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {linhas.map((p, i) => {
                const ed = editavel && p.liberado !== 'S';
                return (
                  <tr key={p.fieldId} className="border-b border-border/50">
                    <td className="py-1 pr-2 tabular-nums">{p.nrofatura}{p.totalparcelasfatura ? `/${p.totalparcelasfatura}` : ''}</td>
                    <td className="py-1 pr-2"><input type="date" className={cel} value={dataIso(p.data) ?? ''} disabled={!ed} onChange={(e) => editar(i, 'data', e.target.value || null)} /></td>
                    <td className="py-1 pr-2"><input className={cel} maxLength={65} value={p.duplicata ?? ''} disabled={!ed} onChange={(e) => editar(i, 'duplicata', e.target.value)} /></td>
                    <td className="py-1 pr-2"><input className={cel} maxLength={20} value={p.modalidade ?? ''} disabled={!ed} onChange={(e) => editar(i, 'modalidade', e.target.value)} /></td>
                    <td className="py-1 pr-2"><input className={`${cel} text-right tabular-nums`} inputMode="decimal" value={p.valor ?? ''} disabled={!ed}
                      onChange={(e) => editar(i, 'valor', e.target.value.replace(',', '.'))} /></td>
                    <td className="py-1 pr-2"><input className={cel} maxLength={48} value={p.codbarrasboleto ?? ''} disabled={!ed} onChange={(e) => editar(i, 'codbarrasboleto', e.target.value)} /></td>
                    <td className="py-1 text-fg-muted">
                      {p.liberado === 'S' ? 'faturada' : ed ? <button type="button" aria-label="Excluir parcela" onClick={() => remove(i)}><Trash2 size={14} /></button> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div><Button label="Atuali&zar" variant="soft" onClick={() => void refetch()} /></div>
    </div>
  );
}

// ───────────────────────────── Faturamento ─────────────────────────────

/**
 * O botão "Faturamento" da nota (`btnFaturamentoClick`, uNF.pas:4332): a nota própria só depois de enviada, e só com parcela pendente;
 * abre a tela do Faturamento com o filtro da nota (emissão, número, A Pagar / A Receber), onde a parcela vira título. "Excluir
 * documentos financeiros" apaga títulos, rateio, CAIXA e parcelas (ExcluiFaturamento).
 */
function FaturamentoSection({ form, tipo }: { form: UseFormReturn<CriarNfDto>; tipo: NfTipo }) {
  const mensagem = useMensagem();
  const navigate = useNavigate();
  const [executando, setExecutando] = useState(false);
  const codnf = (form.getValues() as { codnf?: number }).codnf;
  if (codnf == null) return null;
  const modalidade = tipo === 'E' ? 'A Pagar' : 'A Receber';

  const abrirFaturamento = async () => {
    try {
      const r = await faturamentoDaNota(codnf);
      sessionStorage.setItem('apollo.faturamento.nota', JSON.stringify(r));
      navigate('/compras/faturamento');
    } catch (e) {
      mensagem.erro(e);
    }
  };

  // "Excluir documentos financeiros" (uNF.pas:17710): a confirmação do legado; o servidor confere a permissão e as baixas
  const excluirFinanceiro = async () => {
    if (executando) return;
    if (!window.confirm('Deseja remover o faturamento e o financeiro desta nota?\nEsta ação é IRREVERSÍVEL, pois as contas A PAGAR ou A RECEBER serão excluídas!')) return;
    setExecutando(true);
    try {
      await excluirFinanceiroNf(codnf);
      form.setValue('faturamento' as never, [] as never);
      mensagem.sucesso('Financeiro excluído com sucesso!');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-gp-sm">
      <Button label="&Faturamento" variant="soft" onClick={() => void abrirFaturamento()} />
      <Button label="E&xcluir documentos financeiros" variant="soft" onClick={() => void excluirFinanceiro()} />
      <small className="text-fg-muted">As parcelas viram títulos em {modalidade} na tela do Faturamento.</small>
    </div>
  );
}

// ───────────────────────────── NFe / SEFAZ (F6) ─────────────────────────────

function NfeSefazSection({ form }: { form: UseFormReturn<CriarNfDto> }) {
  const mensagem = useMensagem();
  const [executando, setExecutando] = useState(false);
  const [modo, setModo] = useState<'cancelar' | 'cce' | null>(null);
  const [texto, setTexto] = useState('');
  const statusnfe = form.watch('statusnfe');
  const modelo = Number(form.watch('modelo'));
  const chavenfe = form.watch('chavenfe') as string | undefined;
  const codnf = (form.getValues() as { codnf?: number }).codnf;
  if (codnf == null || modelo !== 55) return null;

  const naoEnviada = !statusnfe;
  const autorizada = statusnfe === 'P';
  const denegada = statusnfe === 'D';
  const cancelada = statusnfe === 'C';

  const transmitir = async () => {
    if (executando) return;
    setExecutando(true);
    try {
      const r = await transmitirNf(codnf);
      form.setValue('chavenfe', r.chave);
      form.setValue('statusnfe', r.statusnfe);
      form.setValue('confirmada', r.statusnfe === 'P' ? 'S' : 'N');
      mensagem.sucesso(
        `NFe ${r.statusnfe === 'P' ? 'autorizada' : 'denegada'}: ${r.chave}${r.simulado ? ' (SIMULADO — homologação)' : ''}.`,
      );
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const confirmarEvento = async () => {
    if (executando || modo == null) return;
    if (texto.trim().length < 15) return;
    setExecutando(true);
    try {
      if (modo === 'cancelar') {
        await cancelarNf(codnf, { xjust: texto });
        form.setValue('statusnfe', 'C');
        form.setValue('cancelada', 'S');
        form.setValue('xjust', texto);
        mensagem.sucesso('NFe cancelada.');
      } else {
        const r = await cceNf(codnf, { correcao: texto });
        mensagem.sucesso(`Carta de correção registrada (sequência ${r.seq}).`);
      }
      setModo(null);
      setTexto('');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const badge =
    naoEnviada ? 'Não enviada'
    : autorizada ? 'Autorizada'
    : cancelada ? 'Cancelada'
    : denegada ? 'Denegada'
    : statusnfe;

  return (
    <div className="flex min-w-64 flex-[2] flex-col gap-gp-sm rounded-radius-base border border-border p-pad-sm">
      <div className="flex flex-wrap items-center gap-gp-sm">
        <span className="text-body-sm font-semibold text-fg-default">NFe / SEFAZ</span>
        <span className="rounded-radius-base bg-bg-subtle px-pad-sm py-pad-xs text-body-sm text-fg-muted">{badge}</span>
        {chavenfe && (
          <button
            type="button"
            className="text-sm text-fg-link"
            onClick={() => void navigator.clipboard?.writeText(chavenfe)}
          >
            Copiar chave
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-gp-sm">
        {naoEnviada && <Button label="&Transmitir NFe" variant="soft" onClick={() => void transmitir()} />}
        {autorizada && (
          <>
            <Button label="&Cancelar NFe" variant="soft" onClick={() => { setModo('cancelar'); setTexto(''); }} />
            <Button label="Carta de &correção" variant="soft" onClick={() => { setModo('cce'); setTexto(''); }} />
          </>
        )}
        {denegada && <small className="text-fg-danger">NFe denegada pela SEFAZ — emita uma nova nota.</small>}
        {cancelada && <small className="text-fg-muted">NFe cancelada.</small>}
      </div>

      {modo != null && (
        <div className="flex flex-col gap-gp-xs rounded-radius-base border border-border p-pad-sm">
          <TextArea
            label={modo === 'cancelar' ? 'Justificativa do cancelamento (mín. 15)' : 'Texto da correção (mín. 15)'}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
          />
          <div className="flex items-center gap-gp-sm">
            <Button
              label={modo === 'cancelar' ? '&Confirmar cancelamento' : '&Enviar correção'}
              variant="soft"
              onClick={() => void confirmarEvento()}
            />
            <Button label="Cancelar" variant="ghost" onClick={() => { setModo(null); setTexto(''); }} />
            <small className="text-fg-muted">{texto.trim().length}/15+ caracteres</small>
          </div>
        </div>
      )}

      <small className="text-fg-muted">
        Transmissão via simulador de homologação (nenhuma NFe autorizada na Receita). Cancelamento não reverte
        estoque nem financeiro.
      </small>
    </div>
  );
}

// ───────────────────────────── Itens ─────────────────────────────

/** a linha da grade dos itens: o item, ou o pai virtual de um grupo de decomposição (`_pai`), e o filho (`_filho`, com a chave do `_grupo`) */
type LinhaItemNf = NfItemDto & {
  fieldId: string;
  codnfprod?: number;
  _pai?: { codprodutopai: number; nroitemDecomp: number | null; total: number; chave: string };
  _filho?: boolean;
  _grupo?: string;
};
function linhasComDecomposicao(itens: Array<NfItemDto & { fieldId: string }>): LinhaItemNf[] {
  const deco = (it: NfItemDto) => {
    const x = it as unknown as { codprodutopai_decomposicao?: unknown; nroitem_decomp?: unknown; descricao_prodpai_decomp?: unknown };
    const pai = Number(x.codprodutopai_decomposicao) || 0;
    const nroi = x.nroitem_decomp != null && x.nroitem_decomp !== '' ? Number(x.nroitem_decomp) : null;
    return { pai, nroi, desc: x.descricao_prodpai_decomp != null ? String(x.descricao_prodpai_decomp) : undefined, chave: `${pai}|${nroi ?? ''}` };
  };
  const out: LinhaItemNf[] = [];
  const emitidos = new Set<string>();
  for (const it of itens) {
    const d = deco(it);
    if (!d.pai) { out.push(it); continue; }
    if (emitidos.has(d.chave)) continue;
    emitidos.add(d.chave);
    const grupo = itens.filter((x) => deco(x).chave === d.chave).sort((a, b) => (Number(a.nroitem) || 0) - (Number(b.nroitem) || 0));
    const qtd = Math.round(grupo.reduce((s, g) => s + (Number(g.quantidade) || 0), 0) * 1000) / 1000;
    const total = Math.round(grupo.reduce((s, g) => s + totalProdutoItem(g), 0) * 100) / 100;
    const soma = (k: 'vricm' | 'vricmst') => Math.round(grupo.reduce((s, g) => s + (Number(g[k]) || 0), 0) * 100) / 100;
    out.push({
      fieldId: `deco:${d.chave}`, nroitem: d.nroi ?? undefined, codproduto: d.pai, descricao: d.desc, quantidade: qtd, unidade: grupo[0].unidade,
      vrcusto: qtd > 0 ? total / qtd : 0, cfop: grupo[0].cfop, cst: grupo[0].cst, vricm: soma('vricm'), vricmst: soma('vricmst'),
      _pai: { codprodutopai: d.pai, nroitemDecomp: d.nroi, total, chave: d.chave },
    } as LinhaItemNf);
    for (const g of grupo) out.push({ ...g, _filho: true, _grupo: d.chave });
  }
  return out;
}

function ItensSection({
  form,
  editavel,
  opts,
}: {
  form: UseFormReturn<CriarNfDto>;
  editavel: boolean;
  opts: LookupOptions;
}) {
  const { fields, append, update, remove, replace } = useFieldArray<CriarNfDto, 'itens', 'fieldId'>({
    control: form.control,
    name: 'itens',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const mensagem = useMensagem();
  const [recalculando, setRecalculando] = useState(false);

  // IMPORTAR INVENTÁRIO ROTATIVO (corte-3 das pontes): os itens entram na nota em edição e os lotes ficam
  // PENDENTES até a nota ser gravada — como no legado, que guarda `fListaImportacaoInventario*` em memória e só
  // carimba no `btnGravar` (uNF.pas:5261-5285). O `codnf` aparecer no form é o nosso "gravou".
  const [rotativoAberto, setRotativoAberto] = useState(false);
  // LOTES/VALIDADE do item (uNFLoteValidade): só em item já gravado — precisa do codnfprod, como o legado abre sobre o item corrente
  const [lotesDe, setLotesDe] = useState<{ codnfprod: number; titulo: string } | null>(null);
  const [ufDestino, setUfDestino] = useState<string | undefined>();
  const pendenteRotativo = useRef<{ lotes: number[]; lado: LadoRotativoNf } | null>(null);
  // IMPORTAR SCRAP (uNF.pas:1880): os scraps ficam pendentes até a nota ser gravada — o legado guarda
  // `fListaImportacaoScrap` e marca IMPORTADO no `btnGravar` (uNF.pas:5251); a liberação da reimportação vai junto
  const [scrapAberto, setScrapAberto] = useState(false);
  const pendenteScrap = useRef<{ codscraps: number[]; credenciais: CredenciaisLiberacao } | null>(null);
  // IMPORTAR VENDAS — a NF de cupom (uNF.pas:13201): os cupons ficam pendentes até a nota ser gravada (uNF.pas:5236)
  const [vendasAberto, setVendasAberto] = useState(false);
  const pendenteVendas = useRef<{ codvendas: number[]; senhaAdm?: string } | null>(null);
  // IMPORTAR DEVOLUÇÃO DE VENDAS — a NF de entrada da situação 2 (uNF.pas:5900): os itens ficam pendentes até gravar
  const [devolucaoAberto, setDevolucaoAberto] = useState(false);
  const pendenteDevolucao = useRef<{ itens: ItemDevolucao[]; credenciais: CredenciaisDevolucao } | null>(null);
  // IMPORTAÇÃO AUTOMÁTICA da situação (IMPORTACAO_AUTO_NF, uNF.pas:14396; UCadSituacaoNF.md C6): escolher na nota de
  // saída uma situação com 'SC' abre a importação do SCRAP (a 90 da produção), 'VE' a de VENDAS (a 9); na entrada, 'DE' a
  // da DEVOLUÇÃO DE VENDAS (a 2)
  const sitWatch = form.watch('idsituacao_nf');
  const sitAnterior = useRef(sitWatch);
  useEffect(() => {
    const antes = sitAnterior.current;
    sitAnterior.current = sitWatch;
    if (!editavel || sitWatch == null || Number(sitWatch) === Number(antes ?? 0)) return;
    const o = opts.situacaoOptions.find((x) => Number(x.value) === Number(sitWatch));
    if (form.getValues('tipo') === 'E') {
      // na entrada, 'DE' abre a importação da devolução de vendas (IniciarImportacaoEntrada(1), uNF.pas:14416)
      if (o?.importacaoAuto === 'DE') {
        mensagem.sucesso('A importação de DEVOLUÇÃO DE VENDAS será iniciada, conforme configuração na situação de documento.');
        setDevolucaoAberto(true);
      }
      return;
    }
    if (form.getValues('tipo') !== 'S') return;
    if (o?.importacaoAuto === 'SC') {
      mensagem.sucesso('A importação de SCRAP será iniciada, conforme configuração na situação de documento.');
      setScrapAberto(true);
    } else if (o?.importacaoAuto === 'VE') {
      mensagem.sucesso('A importação de VENDAS será iniciada, conforme configuração na situação de documento.');
      setVendasAberto(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitWatch]);
  const codnfAtual = form.watch('codnf' as any) as number | undefined;
  const codparceiroAtual = form.watch('codparceiro');
  useEffect(() => {
    const p = pendenteRotativo.current;
    if (codnfAtual == null || !p) return;
    pendenteRotativo.current = null;
    vincularNfRotativo({ codnf: Number(codnfAtual), lotes: p.lotes, tipo: p.lado })
      .then((r) => {
        if (r.recusados.length) mensagem.erro(`Lote(s) ${r.recusados.map((x) => x.lote).join(', ')} não vinculado(s): já importado(s) em outra nota.`);
        else mensagem.sucesso(`Inventário rotativo vinculado à nota ${codnfAtual} (lotes ${r.carimbados.join(', ')}).`);
      })
      .catch((e) => mensagem.erro(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codnfAtual]);
  useEffect(() => {
    const p = pendenteVendas.current;
    if (codnfAtual == null || !p) return;
    pendenteVendas.current = null;
    vincularVendasNf(Number(codnfAtual), { codvendas: p.codvendas, ...(p.senhaAdm ? { senhaAdm: p.senhaAdm } : {}) })
      .then((r) => mensagem.sucesso(`${r.vinculados.length} cupom(ns) vinculado(s) à nota ${codnfAtual}.`))
      .catch((e) => mensagem.erro(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codnfAtual]);
  useEffect(() => {
    const p = pendenteDevolucao.current;
    if (codnfAtual == null || !p) return;
    pendenteDevolucao.current = null;
    vincularDevolucaoVendasNf(Number(codnfAtual), { itens: p.itens, ...p.credenciais })
      .then((r) => mensagem.sucesso(`Devolução do(s) cupom(ns) ${[...new Set(r.cupons)].join(', ')} vinculada à nota ${codnfAtual}.`))
      .catch((e) => mensagem.erro(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codnfAtual]);
  useEffect(() => {
    const p = pendenteScrap.current;
    if (codnfAtual == null || !p) return;
    pendenteScrap.current = null;
    vincularScrapNf(Number(codnfAtual), { codscraps: p.codscraps, ...p.credenciais })
      .then((r) => mensagem.sucesso(`SCRAP ${r.vinculados.join(', ')} vinculado(s) à nota ${codnfAtual}.`))
      .catch((e) => mensagem.erro(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codnfAtual]);
  const abrirRotativo = async () => {
    // a UF do titular decide o CFOP interno × interestadual (uNF.pas:12804): vem do endereço padrão do parceiro
    let uf: string | undefined;
    if (codparceiroAtual != null) {
      try {
        const pz = (await createResourceApi('cadastro/parceiros').ler(Number(codparceiroAtual))) as { enderecos?: Array<{ uf?: string; endereco_padrao?: string }> } | undefined;
        const ends = pz?.enderecos ?? [];
        uf = (ends.find((e) => e.endereco_padrao === 'S') ?? ends[0])?.uf ?? undefined;
      } catch { /* sem UF assume-se a própria (o servidor faz o mesmo) */ }
    } else {
      mensagem.erro('É necessário informar o cliente primeiramente!'); // literal do legado (uNF.pas:12800)
      return;
    }
    setUfDestino(uf);
    setRotativoAberto(true);
  };

  const proximoNroItem = () =>
    (fields as NfItemDto[]).reduce((m, it) => Math.max(m, Number(it.nroitem) || 0), 0) + 1;

  const recalcular = async () => {
    if (recalculando) return;
    if (!fields.length) {
      mensagem.erro('Adicione itens à nota antes de recalcular os impostos.');
      return;
    }
    setRecalculando(true);
    try {
      const dto = form.getValues();
      const r = await recalcularNf(dto as CriarNfDto);
      replace((r.itens ?? []) as NfItemDto[]);
      mensagem.sucesso('Impostos recalculados. Confira os valores e grave a nota.');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setRecalculando(false);
    }
  };

  const onConfirmar = (item: NfItemDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append({ ...item, nroitem: item.nroitem ?? proximoNroItem() });
    else {
      // o que o diálogo não edita (a decomposição do filho, p.ex.) segue com o item na tela
      const { fieldId: _f, ...antes } = fields[editIdx] as NfItemDto & { fieldId: string };
      update(editIdx, { ...antes, ...item });
    }
    setEditIdx(null);
  };

  const rotuloProduto = (codproduto?: number) => {
    if (codproduto == null) return '';
    const o = opts.produtoOptions.find((op) => op.value === String(codproduto));
    return o ? o.label : String(codproduto);
  };

  const itensDaNota = fields as Array<NfItemDto & { fieldId: string }>;
  // o total da linha é quantidade × VRCUSTO (arredondado/truncado pelo item); o desconto é o VRDESCPROD (nf-valor.ts)
  const totalProd = itensDaNota.reduce((s, it) => s + totalProdutoItem(it) - (Number(it.vrdescprod) || 0), 0);
  // a GRADE com a entrada decomposta (`ConstruirGridDosItensDaNota.InserirPai`, udmNF.pas:5729-5820): cada grupo de filhos (pai + NROITEM_DECOMP)
  // ganha uma linha virtual do pai — Σ quantidade, VRCUSTO = Σ totais / Σ qtd, Σ total, Σ ICMS/ST, CFOP/CST/UN do 1º filho, NROITEM = NROITEM_DECOMP
  // e a descrição do pai —, com os filhos logo abaixo
  const itens = useMemo(() => linhasComDecomposicao(itensDaNota), [itensDaNota]);
  const [regerando, setRegerando] = useState<PaiDecomposicao & { grupo: { codprodutopai: number; nroitemDecomp: number | null } } | null>(null);
  const regerar = async (e: { qtdTotal: number; valorTotal: number; cfop: number }) => {
    const codnf = (form.getValues() as { codnf?: number }).codnf;
    if (!regerando || codnf == null) return;
    if (form.formState.isDirty) { mensagem.erro('Grave a nota fiscal antes de recalcular a decomposição.'); return; }
    try {
      await decomporItemNf(codnf, { codnfprod: 0, grupo: regerando.grupo, ...e });
      const nf = await lerNf(codnf);
      form.setValue('itens', (nf.itens ?? []) as never, { shouldDirty: false });
      for (const k of [...TOTAIS_DA_ANALISE, 'totalprod', 'qtde'] as const) if (nf[k] !== undefined) form.setValue(k as never, nf[k] as never, { shouldDirty: false });
      setRegerando(null);
      mensagem.sucesso(`${regerando.descricao ?? 'Decomposição'}: recalculada com o cadastro e os preços atuais.`);
    } catch (err) {
      mensagem.erro(err);
    }
  };

  const columns = useMemo<DataTableColumnDef<LinhaItemNf>[]>(
    () => [
      { field: 'nroitem', headerName: 'Item', type: 'number', width: 80 },
      {
        field: 'codproduto',
        headerName: 'Produto',
        type: 'text',
        isPrimary: true,
        // a descrição do ITEM quando ele tem (NF_PROD.DESCRICAO), senão a do produto
        valueGetter: (row) => {
          const r = rotuloProduto(row.codproduto);
          const filho = (row as LinhaItemNf)._filho ? '↳ ' : '';
          if (!row.descricao) return `${filho}${r}`;
          return `${filho}${r.includes(' - ') ? r.slice(0, r.indexOf(' - ')) : String(row.codproduto)} - ${row.descricao}`;
        },
      },
      { field: 'quantidade', headerName: 'Qtde', type: 'number', width: 110 },
      { field: 'unidade', headerName: 'UN', type: 'text', width: 80 },
      {
        field: 'vrcusto',
        headerName: 'Vlr unit.',
        type: 'text',
        width: 130,
        valueGetter: (row) => fmtBRL(Number(row.vrcusto) || 0),
      },
      {
        field: 'total',
        headerName: 'Total',
        type: 'text',
        width: 130,
        valueGetter: (row) => fmtBRL((row as LinhaItemNf)._pai ? (row as LinhaItemNf)._pai!.total : totalProdutoItem(row)),
      },
      { field: 'cfop', headerName: 'CFOP', type: 'text', width: 90 },
      { field: 'cst', headerName: 'CST', type: 'text', width: 70 },
      {
        field: 'vricm',
        headerName: 'ICMS',
        type: 'text',
        width: 110,
        valueGetter: (row) => fmtBRL(Number(row.vricm) || 0),
      },
      {
        field: 'vricmst',
        headerName: 'ICMS-ST',
        type: 'text',
        width: 110,
        valueGetter: (row) => fmtBRL(Number(row.vricmst) || 0),
      },
      {
        field: 'acoes',
        headerName: '',
        type: 'actions',
        width: 110,
        getActions: () => [
          {
            // o Ctrl+D da grade (RecalcularProdutoEmDecomposicao, uNF.pas:8804): o diálogo com Σ quantidade, Σ total e o CFOP do 1º filho;
            // o OK apaga os filhos do grupo e regera com o cadastro e os preços atuais
            id: 'regerar',
            label: 'Recalcular a decomposição',
            icon: <RefreshCw className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            hidden: (r: LinhaItemNf) => !r._pai,
            onClick: (r: LinhaItemNf) => {
              const codnf = (form.getValues() as { codnf?: number }).codnf;
              if (codnf == null || form.formState.isDirty) { mensagem.erro('Grave a nota fiscal antes de recalcular a decomposição.'); return; }
              setRegerando({ codnfprod: 0, nroitem: r.nroitem ?? null, codproduto: r.codproduto, descricao: r.descricao ?? null, codbarra: null,
                unidade: r.unidade ?? null, fatorembal: 1, qtdetotal: Number(r.quantidade) || 0, totalprods: r._pai!.total,
                cfop: r.cfop != null && r.cfop !== '' ? Number(r.cfop) : null, grupo: { codprodutopai: r._pai!.codprodutopai, nroitemDecomp: r._pai!.nroitemDecomp } });
            },
          },
          {
            id: 'editar',
            label: 'Editar',
            hidden: (r: LinhaItemNf) => !!r._pai,
            icon: <Pencil className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            onClick: (r: NfItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) setEditIdx(idx);
            },
          },
          {
            id: 'lotes',
            label: 'Lotes/validade',
            hidden: (r: LinhaItemNf) => !!r._pai,
            icon: <Layers className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            onClick: (r: NfItemDto & { fieldId: string; codnfprod?: number }) => {
              if (r.codnfprod == null) { mensagem.erro('Grave a nota antes de informar os lotes do item.'); return; }
              setLotesDe({ codnfprod: Number(r.codnfprod), titulo: `Produto - ${r.codprodnota ?? r.codproduto}: ${rotuloProduto(r.codproduto)}` });
            },
          },
          {
            id: 'remover',
            label: 'Remover',
            icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            destructive: true,
            // o filho da decomposição fica na grade de detalhe do legado: o Excluir age na principal (o item comum e o pai virtual, que leva o grupo)
            hidden: (r: LinhaItemNf) => !!r._filho,
            onClick: (r: LinhaItemNf) => {
              // o pai virtual leva o grupo inteiro (btnDelItemClick, uNF.pas:3804-3860); as travas (devolvido, lote, produção) são do gravar
              if (r._pai) {
                if (!window.confirm('O item selecionado faz parte de uma decomposição. Todos os itens da decomposição serão excluídos\nDeseja realmente excluí-lo?')) return;
                const ids = new Set(itens.filter((x) => x._filho && x._grupo === r._pai!.chave).map((x) => x.fieldId));
                const idxs = fields.map((f, i) => (ids.has(f.fieldId) ? i : -1)).filter((i) => i >= 0);
                remove(idxs);
                return;
              }
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) remove(idx);
            },
          },
        ],
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, itens, remove, opts.produtoOptions],
  );

  return (
    <fieldset disabled={!editavel} className="border-0 p-0">
      <div className="flex flex-col gap-gp-sm">
        <div className="flex flex-wrap gap-gp-sm">
          <Button label="Adicionar &item" variant="soft" onClick={() => setEditIdx(-1)} />
          <Button label="Recalcular &impostos" variant="soft" onClick={() => void recalcular()} />
          <Button label="Importar inventário &rotativo" variant="soft" onClick={() => void abrirRotativo()} />
          {form.getValues('tipo') === 'S' && (
            <Button label="Importar &SCRAP" variant="soft" onClick={() => setScrapAberto(true)} />
          )}
          {form.getValues('tipo') === 'S' && (
            <Button label="Importar &vendas" variant="soft" onClick={() => setVendasAberto(true)} />
          )}
          {form.getValues('tipo') === 'E' && (
            <Button label="Importar &devolução de vendas" variant="soft" onClick={() => setDevolucaoAberto(true)} />
          )}
        </div>
        {devolucaoAberto && (
          <NfDevolucaoVendasModal
            onFechar={() => setDevolucaoAberto(false)}
            onConfirmar={({ previa, credenciais }) => {
              let n = proximoNroItem();
              for (const it of previa.itens) append({ ...it, importado_de: 'DEVOLUCAO_VENDAS', nroitem: n++ });
              // o cliente do cupom (ou o parceiro da empresa), o CFOP 1202/2202, as NFC-e referenciadas e os cupons na OBS
              if (previa.codparceiro != null) form.setValue('codparceiro' as any, previa.codparceiro);
              if (previa.codparceiro_end != null) form.setValue('codparceiro_end' as any, previa.codparceiro_end);
              form.setValue('cfop' as any, String(previa.cfop));
              const refs = (form.getValues('referencias' as any) ?? []) as Array<Record<string, unknown>>;
              form.setValue('referencias' as any, [...refs, ...previa.referencias.filter((r) => !refs.some((x) => x.chavenfe === r.chavenfe))]);
              const obsAtual = String(form.getValues('obs' as any) ?? '').trim();
              form.setValue('obs' as any, obsAtual ? `${obsAtual}\n${previa.obs}` : previa.obs);
              const p = pendenteDevolucao.current;
              const itens = [...(p?.itens ?? []), ...previa.itensSelecionados.map((x) => ({ codvendas: x.codvendas, codproduto: x.codproduto }))];
              pendenteDevolucao.current = { itens, credenciais: previa.reimportados.length ? credenciais : p?.credenciais ?? {} };
              setDevolucaoAberto(false);
              mensagem.sucesso(`${previa.itens.length} item(ns) devolvido(s) incluído(s). A devolução será vinculada quando a nota for gravada.`);
            }}
          />
        )}
        {vendasAberto && (
          <NfVendasModal
            onFechar={() => setVendasAberto(false)}
            onConfirmar={({ previa, senhaAdm }) => {
              let n = proximoNroItem();
              for (const it of previa.itens) append({ ...it, importado_de: 'VENDAS', nroitem: n++ });
              // o cliente do cupom, o CFOP 5929/6929, as NFC-e referenciadas e os cupons ECF na OBS (ImportaVenda)
              if (previa.codparceiro != null) form.setValue('codparceiro' as any, previa.codparceiro);
              if (previa.codparceiro_end != null) form.setValue('codparceiro_end' as any, previa.codparceiro_end);
              form.setValue('cfop' as any, String(previa.cfop));
              const refs = (form.getValues('referencias' as any) ?? []) as Array<Record<string, unknown>>;
              form.setValue('referencias' as any, [...refs, ...previa.referencias.filter((r) => !refs.some((x) => x.chavenfe === r.chavenfe))]);
              if (previa.obs) {
                const obsAtual = String(form.getValues('obs' as any) ?? '').trim();
                form.setValue('obs' as any, obsAtual ? `${obsAtual}\n${previa.obs}` : previa.obs);
              }
              const p = pendenteVendas.current;
              pendenteVendas.current = { codvendas: Array.from(new Set([...(p?.codvendas ?? []), ...previa.cupons])), senhaAdm: senhaAdm ?? p?.senhaAdm };
              setVendasAberto(false);
              mensagem.sucesso(`${previa.itens.length} item(ns) de ${previa.cupons.length} cupom(ns) incluído(s). Os cupons serão vinculados quando a nota for gravada.`);
            }}
          />
        )}
        {scrapAberto && (
          <NfScrapModal
            onFechar={() => setScrapAberto(false)}
            onConfirmar={({ previa, credenciais }) => {
              let n = proximoNroItem();
              for (const it of previa.itens) append({ ...it, importado_de: 'SCRAP', nroitem: n++ });
              // o destinatário é a própria empresa e o CFOP é o de perda (uNF.pas:1966-1971)
              form.setValue('codparceiro' as any, previa.codparceiro);
              form.setValue('codparceiro_end' as any, previa.codparceiro_end);
              form.setValue('cfop' as any, String(previa.cfop));
              const p = pendenteScrap.current;
              pendenteScrap.current = {
                codscraps: Array.from(new Set([...(p?.codscraps ?? []), ...previa.scraps])),
                credenciais: previa.reimportados.length ? credenciais : (p?.credenciais ?? {}),
              };
              setScrapAberto(false);
              mensagem.sucesso(`${previa.itens.length} item(ns) incluído(s). Os scraps ${previa.scraps.join(', ')} serão vinculados quando a nota for gravada.`);
            }}
          />
        )}
        {lotesDe && codnfAtual != null && (
          <NfLoteModal codnf={Number(codnfAtual)} codnfprod={lotesDe.codnfprod} titulo={lotesDe.titulo} onFechar={() => setLotesDe(null)} />
        )}
        {rotativoAberto && (
          <NfRotativoModal
            tipoNota={form.getValues('tipo') as 'E' | 'S' | undefined}
            ufDestino={ufDestino}
            onFechar={() => setRotativoAberto(false)}
            onConfirmar={({ itens: novos, cfopNota, observacao, lotes, lado }) => {
              let n = proximoNroItem();
              for (const it of novos) append({ ...it, nroitem: n++ });
              // o legado troca o CFOP da nota e escreve a observação (uNF.pas:12805-12807, :12886)
              form.setValue('cfop' as any, String(cfopNota));
              const obsAtual = String(form.getValues('obs' as any) ?? '').trim();
              form.setValue('obs' as any, obsAtual ? `${obsAtual}\n${observacao}` : observacao);
              const p = pendenteRotativo.current;
              pendenteRotativo.current = p && p.lado === lado ? { lado, lotes: Array.from(new Set([...p.lotes, ...lotes])) } : { lado, lotes };
              setRotativoAberto(false);
              mensagem.sucesso(`${novos.length} item(ns) incluído(s). Os lotes ${lotes.join(', ')} serão vinculados quando a nota for gravada.`);
            }}
          />
        )}

        {fields.length === 0 ? (
          <small className="text-fg-muted">Sem itens na nota.</small>
        ) : (
          <>
            <DataTable
              rows={itens}
              columns={columns}
              getRowId={(r) => r.fieldId}
              getRowClassName={({ row }) => (row._pai ? 'font-semibold' : '')}
              toolbar={{ enableSearch: false, enableFilters: false }}
              paginationConfig={{ enabled: true, initialPageSize: 10 }}
              cardBreakpoint={false}
            />
            <small className="text-fg-muted">
              Total dos produtos: R$ {fmtBRL(totalProd)} — o total da nota é calculado ao gravar.
            </small>
            {regerando && (
              <NfDecomposicaoModal key={`${regerando.grupo.codprodutopai}-${regerando.grupo.nroitemDecomp}`} pai={regerando} restantes={0}
                onFechar={() => setRegerando(null)} onConfirmar={(e) => void regerar(e)} />
            )}
          </>
        )}
      </div>

      {editIdx != null && (
        <NfItemModal
          inicial={editIdx >= 0 ? (fields[editIdx] as NfItemDto) : undefined}
          tipo={form.getValues('tipo') as 'E' | 'S' | undefined}
          produtoOptions={opts.produtoOptions}
          cfopOptions={opts.cfopOptions}
          aliquotaOptions={opts.aliquotaOptions}
          unidadeOptions={opts.unidadeOptions}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </fieldset>
  );
}

// ───────────────────────────── Transporte / Volumes ─────────────────────────────

function TransporteSection({
  form,
  editavel,
  transpOptions,
}: {
  form: UseFormReturn<CriarNfDto>;
  editavel: boolean;
  transpOptions: Opcao[];
}) {
  const err = form.formState.errors;
  return (
    <fieldset disabled={!editavel} className="border-0 p-0">
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2">
          <Controller
            control={form.control}
            name="codtransp"
            render={({ field }) => (
              <SelectField
                label="&Transportadora"
                options={transpOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder="Selecione a transportadora…"
                error={err.codtransp?.message as string | undefined}
              />
            )}
          />
        </div>
        <Field label="&Placa" maxLength={10} {...form.register('placatransp')} />
        <Field label="&Espécie" maxLength={30} {...form.register('especie')} />
        <Field label="&Marca (volume)" maxLength={30} {...form.register('marca')} />
        <Controller
          control={form.control}
          name="qtdetransp"
          render={({ field }) => (
            <NumberField
              label="&Qtde de volumes"
              value={field.value as number | undefined}
              onChange={field.onChange}
              decimais={3}
              min={0}
            />
          )}
        />
        <Controller
          control={form.control}
          name="pesobruto"
          render={({ field }) => (
            <NumberField
              label="Peso &bruto"
              value={field.value as number | undefined}
              onChange={field.onChange}
              decimais={3}
              min={0}
            />
          )}
        />
        <Controller
          control={form.control}
          name="pesoliquido"
          render={({ field }) => (
            <NumberField
              label="Peso &líquido"
              value={field.value as number | undefined}
              onChange={field.onChange}
              decimais={3}
              min={0}
            />
          )}
        />
      </div>
    </fieldset>
  );
}

// ───────────────────────────── Contábil (F5) ─────────────────────────────

function ContabilSection({
  form,
  editavel,
  situacaoOptions,
  plcOptions,
}: {
  form: UseFormReturn<CriarNfDto>;
  editavel: boolean;
  situacaoOptions: Opcao[];
  plcOptions: Opcao[];
}) {
  const { fields, append, update, remove } = useFieldArray<CriarNfDto, 'contabil', 'fieldId'>({
    control: form.control,
    name: 'contabil',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);

  // as situações da NOTA e dos ITENS — as únicas que a linha do rateio aceita (`GetCodigosSituacaoNFPermitidos`,
  // uLancamentoContabilNF.pas:168) — e, de cada uma, os centros de custo e se é de bonificação (UCadSituacaoNF.md C3)
  const sitNota = Number(form.watch('idsituacao_nf') ?? 0);
  const itensNota = (form.watch('itens') ?? []) as Array<{ idsituacao_nf?: number | null }>;
  const sitsPermitidas = useMemo(
    () => Array.from(new Set([sitNota, ...itensNota.map((i) => Number(i.idsituacao_nf ?? 0))].filter((x) => x > 0))).sort((a, b) => a - b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sitNota, JSON.stringify(itensNota.map((i) => i.idsituacao_nf))],
  );
  const { data: detalhesSit = {} } = useQuery({
    queryKey: ['cadastro/situacoes-nf', 'rateio', sitsPermitidas],
    enabled: sitsPermitidas.length > 0,
    queryFn: async () => {
      const api = createResourceApi<{ centros_custo?: Array<{ codplc: unknown }>; cfops?: Array<{ codcfop: unknown }> }>('cadastro/situacoes-nf');
      const out: Record<number, { ccs: number[]; bonificacao: boolean }> = {};
      for (const id of sitsPermitidas) {
        const d = await api.ler(id).catch(() => undefined);
        out[id] = {
          ccs: (d?.centros_custo ?? []).map((c) => Number(c.codplc)),
          bonificacao: (d?.cfops ?? []).some((c) => [1910, 2910].includes(Number(c.codcfop))),
        };
      }
      return out;
    },
  });
  // ao abrir (nota de ENTRADA já gravada), os centros de custo definidos nas situações entram com valor 0
  // (`InserirCentroDeCustosDefinidos`, uLancamentoContabilNF.pas:697)
  const codnf = form.watch('codnf' as any) as number | undefined;
  const inseridos = useRef(false);
  useEffect(() => {
    if (inseridos.current || !editavel || codnf == null || form.getValues('tipo') !== 'E' || !Object.keys(detalhesSit).length) return;
    inseridos.current = true;
    const atuais = (form.getValues('contabil') ?? []) as NfContabilItemDto[];
    for (const [sit, d] of Object.entries(detalhesSit)) {
      for (const cc of d.ccs) {
        if (!atuais.some((l) => Number(l.idsituacao_nf) === Number(sit) && Number(l.codcc) === cc)) {
          append({ idsituacao_nf: Number(sit), codcc: cc, valor: 0, adicional: d.bonificacao ? 'S' : 'N' });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detalhesSit, codnf, editavel]);

  const onConfirmar = (item: NfContabilItemDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append(item);
    else update(editIdx, item);
    setEditIdx(null);
  };

  const rotulo = (opcoes: Opcao[], v?: number) => {
    if (v == null) return '';
    const o = opcoes.find((op) => op.value === String(v));
    return o ? o.label : String(v);
  };

  const linhas = fields as Array<NfContabilItemDto & { fieldId: string }>;
  const soma = linhas.reduce((s, it) => s + (Number(it.valor) || 0), 0);
  const total = Number(form.watch('totalnf')) || 0;
  const diff = Math.round((total - soma) * 100) / 100;

  const columns = useMemo<DataTableColumnDef<NfContabilItemDto & { fieldId: string }>[]>(
    () => [
      {
        field: 'idsituacao_nf',
        headerName: 'Situação',
        type: 'text',
        isPrimary: true,
        valueGetter: (row) => rotulo(situacaoOptions, row.idsituacao_nf),
      },
      {
        field: 'codcc',
        headerName: 'Centro de custo',
        type: 'text',
        valueGetter: (row) => rotulo(plcOptions, row.codcc),
      },
      {
        field: 'valor',
        headerName: 'Valor',
        type: 'text',
        width: 130,
        valueGetter: (row) => fmtBRL(Number(row.valor) || 0),
      },
      {
        field: 'acoes',
        headerName: '',
        type: 'actions',
        width: 110,
        getActions: () => [
          {
            id: 'editar',
            label: 'Editar',
            icon: <Pencil className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            onClick: (r: NfContabilItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) setEditIdx(idx);
            },
          },
          {
            id: 'remover',
            label: 'Remover',
            icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            destructive: true,
            onClick: (r: NfContabilItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) remove(idx);
            },
          },
        ],
      },
    ],
    [fields, remove, situacaoOptions, plcOptions],
  );

  return (
    <fieldset disabled={!editavel} className="border-0 p-0">
      <div className="flex flex-col gap-gp-sm">
        <div>
          <Button label="Adicionar &centro de custo" variant="soft" onClick={() => setEditIdx(-1)} />
        </div>
        {fields.length === 0 ? (
          <small className="text-fg-muted">Sem rateio contábil.</small>
        ) : (
          <>
            <DataTable
              rows={linhas}
              columns={columns}
              getRowId={(r) => r.fieldId}
              toolbar={{ enableSearch: false, enableFilters: false }}
              paginationConfig={{ enabled: true, initialPageSize: 10 }}
              cardBreakpoint={false}
            />
            <small className={Math.abs(diff) < 0.005 ? 'text-fg-muted' : 'text-fg-danger'}>
              {Math.abs(diff) < 0.005
                ? 'Lançamentos efetuados corretamente.'
                : diff > 0
                  ? `Valor restante: R$ ${fmtBRL(diff)}`
                  : `Valor excedido: R$ ${fmtBRL(-diff)}`}
            </small>
          </>
        )}
      </div>

      {editIdx != null && (
        <ContabilModal
          inicial={editIdx >= 0 ? (fields[editIdx] as NfContabilItemDto) : undefined}
          situacaoOptions={situacaoOptions.filter((o) => sitsPermitidas.includes(Number(o.value))
            || (editIdx >= 0 && Number(o.value) === Number((fields[editIdx] as NfContabilItemDto).idsituacao_nf)))}
          detalhesSit={detalhesSit}
          plcOptions={plcOptions}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </fieldset>
  );
}

function ContabilModal({
  inicial,
  situacaoOptions,
  detalhesSit,
  plcOptions,
  onFechar,
  onConfirmar,
}: {
  inicial?: NfContabilItemDto;
  situacaoOptions: Opcao[];
  /** por situação: os centros de custo dela (SITUACAO_NF_PLC) e se é de bonificação (CFOP 1910/2910) */
  detalhesSit: Record<number, { ccs: number[]; bonificacao: boolean }>;
  plcOptions: Opcao[];
  onFechar: () => void;
  onConfirmar: (item: NfContabilItemDto) => void;
}) {
  const [item, setItem] = useState<NfContabilItemDto>(inicial ?? {});
  const [erro, setErro] = useState<string | undefined>();
  const set = <K extends keyof NfContabilItemDto>(k: K, v: NfContabilItemDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));

  const salvar = () => {
    if (item.idsituacao_nf == null) return setErro('A situação de NF. é obrigatória.');
    if (item.codcc == null) return setErro('O centro de custo é obrigatório.');
    onConfirmar(item);
  };

  return (
    <Modal
      open
      onClose={onFechar}
      size="md"
      title={inicial ? 'Editar rateio contábil' : 'Adicionar rateio contábil'}
      primaryAction={{ label: 'Salvar', onClick: salvar }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-form-gap">
        {erro && <small className="text-fg-danger">{erro}</small>}
        <SelectField
          label="&Situação (natureza)"
          options={situacaoOptions}
          value={item.idsituacao_nf != null ? String(item.idsituacao_nf) : undefined}
          onChange={(v) => {
            const sit = v ? Number(v) : undefined;
            // situação de bonificação marca a linha como ADICIONAL (edtCodSituacaoNFExit, uLancamentoContabilNF.pas:534)
            setItem((i) => ({ ...i, idsituacao_nf: sit, adicional: sit != null && detalhesSit[sit]?.bonificacao ? 'S' : 'N' }));
          }}
          placeholder="Selecione a situação…"
        />
        <SelectField
          label="&Centro de custo"
          options={(() => {
            // a pesquisa de centro de custo mostra só os da situação, quando ela tem (btnAddPLCClick, :216)
            const ccs = item.idsituacao_nf != null ? detalhesSit[item.idsituacao_nf]?.ccs ?? [] : [];
            return ccs.length ? plcOptions.filter((o) => ccs.includes(Number(o.value)) || Number(o.value) === Number(item.codcc)) : plcOptions;
          })()}
          value={item.codcc != null ? String(item.codcc) : undefined}
          onChange={(v) => set('codcc', v ? Number(v) : undefined)}
          placeholder="Selecione o centro de custo…"
        />
        <CurrencyField label="&Valor" value={item.valor} onChange={(v) => set('valor', v)} />
      </div>
    </Modal>
  );
}

// ───────────────────────────── Referências ─────────────────────────────

function ReferenciasSection({
  form,
  editavel,
}: {
  form: UseFormReturn<CriarNfDto>;
  editavel: boolean;
}) {
  const { fields, append, update, remove } = useFieldArray<CriarNfDto, 'referencias', 'fieldId'>({
    control: form.control,
    name: 'referencias',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const onConfirmar = (item: NfReferenciaDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append(item);
    else update(editIdx, item);
    setEditIdx(null);
  };

  const columns = useMemo<DataTableColumnDef<NfReferenciaDto & { fieldId: string }>[]>(
    () => [
      { field: 'codnf_ref', headerName: 'NF ref.', type: 'number', width: 110 },
      { field: 'chave_ref', headerName: 'Chave (44)', type: 'text', isPrimary: true },
      {
        field: 'valor_ref',
        headerName: 'Valor',
        type: 'text',
        width: 130,
        valueGetter: (row) => fmtBRL(Number(row.valor_ref) || 0),
      },
      {
        field: 'acoes',
        headerName: '',
        type: 'actions',
        width: 110,
        getActions: () => [
          {
            id: 'editar',
            label: 'Editar',
            icon: <Pencil className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            onClick: (r: NfReferenciaDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) setEditIdx(idx);
            },
          },
          {
            id: 'remover',
            label: 'Remover',
            icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            destructive: true,
            onClick: (r: NfReferenciaDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) remove(idx);
            },
          },
        ],
      },
    ],
    [fields, remove],
  );

  return (
    <fieldset disabled={!editavel} className="border-0 p-0">
      <div className="flex flex-col gap-gp-sm">
        <div>
          <Button label="Adicionar &referência" variant="soft" onClick={() => setEditIdx(-1)} />
        </div>
        {fields.length === 0 ? (
          <small className="text-fg-muted">Sem NFs referenciadas.</small>
        ) : (
          <DataTable
            rows={fields as Array<NfReferenciaDto & { fieldId: string }>}
            columns={columns}
            getRowId={(r) => r.fieldId}
            toolbar={{ enableSearch: false, enableFilters: false }}
            paginationConfig={{ enabled: true, initialPageSize: 10 }}
            cardBreakpoint={false}
          />
        )}
      </div>

      {editIdx != null && (
        <ReferenciaModal
          inicial={editIdx >= 0 ? (fields[editIdx] as NfReferenciaDto) : undefined}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </fieldset>
  );
}

function ReferenciaModal({
  inicial,
  onFechar,
  onConfirmar,
}: {
  inicial?: NfReferenciaDto;
  onFechar: () => void;
  onConfirmar: (item: NfReferenciaDto) => void;
}) {
  const [item, setItem] = useState<NfReferenciaDto>(inicial ?? {});
  const set = <K extends keyof NfReferenciaDto>(k: K, v: NfReferenciaDto[K]) =>
    setItem((i) => ({ ...i, [k]: v }));
  return (
    <Modal
      open
      onClose={onFechar}
      size="md"
      title={inicial ? 'Editar referência' : 'Adicionar referência'}
      primaryAction={{ label: 'Salvar', onClick: () => onConfirmar(item) }}
      secondaryAction={{ label: 'Cancelar', onClick: onFechar }}
    >
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
        <NumberField
          label="&NF referenciada (código)"
          value={item.codnf_ref}
          onChange={(v) => set('codnf_ref', v)}
          decimais={0}
          min={0}
        />
        <CurrencyField label="&Valor" value={item.valor_ref} onChange={(v) => set('valor_ref', v)} />
        <div className="sm:col-span-2">
          <Field
            label="&Chave de acesso (44)"
            maxLength={44}
            inputMode="numeric"
            value={item.chave_ref ?? ''}
            onChange={(e) => set('chave_ref', e.target.value || undefined)}
          />
        </div>
      </div>
    </Modal>
  );
}

// ───────────────────────────── Dados Gerais / Observações ─────────────────────────────

function DadosGeraisTab({ form, editavel }: { form: UseFormReturn<CriarNfDto>; editavel: boolean }) {
  return (
    <fieldset disabled={!editavel} className="border-0 p-0">
      <div className="flex flex-col gap-form-gap">
        <TextArea label="&Observações" rows={3} {...form.register('obs')} />
        <TextArea label="Observações &fiscais" rows={2} {...form.register('obsnf')} />
      </div>
    </fieldset>
  );
}
