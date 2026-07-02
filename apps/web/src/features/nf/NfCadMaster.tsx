import { useMemo, useState } from 'react';
import { Controller, useFieldArray, type UseFormReturn } from 'react-hook-form';
import { Pencil, Trash2 } from 'lucide-react';
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
import { recalcularNf } from './nfFiscalApi';
import { processarNf, reverterNf } from './nfProcessamentoApi';
import { faturarNf, estornarFaturamentoNf } from './nfFaturamentoApi';
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

type LookupOptions = {
  parceiroOptions: Opcao[];
  transpOptions: Opcao[];
  cfopOptions: Opcao[];
  situacaoOptions: Opcao[];
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
 * As TRAVAS de estado (proc/faturada/contabilizado/enviada) desabilitam os campos (o servidor reforça 422).
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
  const { data: cfopOptions = [] } = useResourceOptions('cadastro/cfops', (c: any) => ({
    value: String(c.codcfop),
    label: `${c.codcfop} - ${c.descricao}`,
  }));
  const { data: situacaoOptions = [] } = useResourceOptions('cadastro/situacoes-nf', (s: any) => ({
    value: String(s.idsituacao_nf),
    label: `${s.idsituacao_nf} - ${s.descricao}`,
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

  // TRAVA de estado (espelha dsNFStateChange + bloqueios do btnEditar do legado):
  const proc = form.watch('proc');
  const statusnfe = form.watch('statusnfe');
  const contabilizado = form.watch('contabilizado');
  const cancelada = form.watch('cancelada');
  const faturada = form.watch('faturada');
  const travado =
    proc === 'S' || contabilizado === 'S' || faturada === 'S' ||
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
            : faturada === 'S'
              ? 'faturada'
              : cancelada === 'S' || statusnfe === 'C'
                ? 'cancelada'
                : contabilizado === 'S'
                  ? 'contabilizada'
                  : 'enviada à Receita'}{' '}
          — edição bloqueada.
        </div>
      )}

      {/* BANDA DE CABEÇALHO (posições do legado: Tipo/Modelo/Nº/Série/Emissão/… + Destinatário + Total NF) */}
      <CabecalhoBand form={form} editavel={liberado} tipo={tipo} opts={opts} />

      {/* BARRA DE ABAS + CONTEÚDO (folder tabs do legado) */}
      <div>
        <Tabs tabs={mainTabs} active={aba} onChange={setAba} />
        <TabPanel>
          {aba === 'calc' && <CalcTab form={form} liberado={liberado} />}
          {aba === 'itens' && <ItensSection form={form} editavel={liberado} opts={opts} />}
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
              options={opts.situacaoOptions}
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
      {sub === 'cobranca' && <FaturamentoSection form={form} tipo={tipo} />}
      {sub === 'docs' && (
        <small className="text-fg-muted">
          Os documentos financeiros (títulos em {tipo === 'E' ? 'A Pagar' : 'A Receber'}) são gerados ao
          «Faturar» (aba «Dados da cobrança») e aparecem no Lote de Cobrança. {!liberado && ''}
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

/**
 * Ações de PROCESSAMENTO (F3): movem o estoque (entrada soma / saída baixa) e travam a nota.
 * "Processar" quando proc='N'; "Reverter" quando proc='S' e a nota não foi enviada à SEFAZ.
 */
function ProcessamentoSection({ form }: { form: UseFormReturn<CriarNfDto> }) {
  const mensagem = useMensagem();
  const [executando, setExecutando] = useState(false);
  const proc = form.watch('proc');
  const statusnfe = form.watch('statusnfe');
  const codnf = (form.getValues() as { codnf?: number }).codnf;
  if (codnf == null) return null;

  const enviada = statusnfe === 'P' || statusnfe === 'D';

  const processar = async () => {
    if (executando) return;
    setExecutando(true);
    try {
      await processarNf(codnf);
      form.setValue('proc', 'S');
      mensagem.sucesso('Nota processada: estoque movimentado.');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const reverter = async () => {
    if (executando) return;
    if (!window.confirm('Ao reverter o processamento, o estoque será revertido. Confirma a operação?')) return;
    setExecutando(true);
    try {
      await reverterNf(codnf);
      form.setValue('proc', 'N');
      mensagem.sucesso('Processamento revertido: estoque estornado.');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  return (
    <div className="flex min-w-56 flex-1 flex-col gap-gp-xs rounded-radius-base border border-border p-pad-sm">
      <span className="text-body-sm font-semibold text-fg-default">Processamento (estoque)</span>
      <div className="flex flex-wrap items-center gap-gp-sm">
        {proc !== 'S' && <Button label="&Processar nota" variant="soft" onClick={() => void processar()} />}
        {proc === 'S' && !enviada && (
          <Button label="&Reverter processamento" variant="soft" onClick={() => void reverter()} />
        )}
      </div>
      <small className="text-fg-muted">
        {proc === 'S' ? 'Nota processada (estoque movimentado).' : 'Nota não processada.'}
        {enviada ? ' Enviada à SEFAZ — reversão bloqueada.' : ''}
      </small>
    </div>
  );
}

// ───────────────────────────── Faturamento (F4) ─────────────────────────────

/**
 * Ações de FATURAMENTO (F4): geram títulos (ARECEBER saída / APAGAR entrada) por IDNF. Vive na aba
 * Financeiro › Dados da cobrança (fiel ao legado). "Faturar" com nº parcelas / 1º venc / intervalo.
 */
function FaturamentoSection({ form, tipo }: { form: UseFormReturn<CriarNfDto>; tipo: NfTipo }) {
  const mensagem = useMensagem();
  const [executando, setExecutando] = useState(false);
  const [numParcelas, setNumParcelas] = useState<number | undefined>(1);
  const [primeiroVencimento, setPrimeiroVencimento] = useState<string | undefined>(hojeISO());
  const [intervaloDias, setIntervaloDias] = useState<number | undefined>(30);
  const faturada = form.watch('faturada');
  const codnf = (form.getValues() as { codnf?: number }).codnf;
  if (codnf == null) return <small className="text-fg-muted">Grave a nota para faturar.</small>;

  const modalidade = tipo === 'E' ? 'A Pagar' : 'A Receber';

  const faturar = async () => {
    if (executando) return;
    setExecutando(true);
    try {
      const r = await faturarNf(codnf, {
        numParcelas: Number(numParcelas) || 1,
        primeiroVencimento: primeiroVencimento ?? hojeISO(),
        intervaloDias: Number(intervaloDias) || 0,
      });
      form.setValue('faturada', 'S');
      mensagem.sucesso(`Faturamento gerado: ${r.parcelas} parcela(s) em ${modalidade}.`);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const estornar = async () => {
    if (executando) return;
    if (!window.confirm('Remover o faturamento desta nota? Os títulos financeiros serão excluídos.')) return;
    setExecutando(true);
    try {
      await estornarFaturamentoNf(codnf);
      form.setValue('faturada', 'N');
      mensagem.sucesso('Faturamento estornado: títulos removidos.');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  return (
    <div className="flex flex-col gap-gp-sm">
      <span className="text-body-sm font-semibold text-fg-default">Faturas ({modalidade})</span>
      {faturada === 'S' ? (
        <div className="flex flex-wrap items-center gap-gp-sm">
          <Button label="&Estornar faturamento" variant="soft" onClick={() => void estornar()} />
          <small className="text-fg-muted">Financeiro gerado (títulos em {modalidade}).</small>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-gp-sm">
          <div className="w-32">
            <NumberField label="Nº &parcelas" value={numParcelas} onChange={setNumParcelas} decimais={0} min={1} />
          </div>
          <div className="w-44">
            <DateField label="1º &vencimento" value={primeiroVencimento} onChange={setPrimeiroVencimento} />
          </div>
          <div className="w-36">
            <NumberField label="&Intervalo (dias)" value={intervaloDias} onChange={setIntervaloDias} decimais={0} min={0} />
          </div>
          <Button label="&Gerar financeiro" variant="soft" onClick={() => void faturar()} />
        </div>
      )}
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
    else update(editIdx, item);
    setEditIdx(null);
  };

  const rotuloProduto = (codproduto?: number) => {
    if (codproduto == null) return '';
    const o = opts.produtoOptions.find((op) => op.value === String(codproduto));
    return o ? o.label : String(codproduto);
  };

  const itens = fields as Array<NfItemDto & { fieldId: string }>;
  const totalProd = itens.reduce(
    (s, it) => s + (Number(it.quantidade) || 0) * (Number(it.vrvenda) || 0) - (Number(it.desconto) || 0),
    0,
  );

  const columns = useMemo<DataTableColumnDef<NfItemDto & { fieldId: string }>[]>(
    () => [
      { field: 'nroitem', headerName: 'Item', type: 'number', width: 80 },
      {
        field: 'codproduto',
        headerName: 'Produto',
        type: 'text',
        isPrimary: true,
        valueGetter: (row) => rotuloProduto(row.codproduto),
      },
      { field: 'quantidade', headerName: 'Qtde', type: 'number', width: 110 },
      { field: 'unidade', headerName: 'UN', type: 'text', width: 80 },
      {
        field: 'vrvenda',
        headerName: 'Vlr unit.',
        type: 'text',
        width: 130,
        valueGetter: (row) => fmtBRL(Number(row.vrvenda) || 0),
      },
      {
        field: 'total',
        headerName: 'Total',
        type: 'text',
        width: 130,
        valueGetter: (row) => fmtBRL((Number(row.quantidade) || 0) * (Number(row.vrvenda) || 0)),
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
            id: 'editar',
            label: 'Editar',
            icon: <Pencil className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            onClick: (r: NfItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) setEditIdx(idx);
            },
          },
          {
            id: 'remover',
            label: 'Remover',
            icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            destructive: true,
            onClick: (r: NfItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) remove(idx);
            },
          },
        ],
      },
    ],
    [fields, remove, opts.produtoOptions],
  );

  return (
    <fieldset disabled={!editavel} className="border-0 p-0">
      <div className="flex flex-col gap-gp-sm">
        <div className="flex flex-wrap gap-gp-sm">
          <Button label="Adicionar &item" variant="soft" onClick={() => setEditIdx(-1)} />
          <Button label="Recalcular &impostos" variant="soft" onClick={() => void recalcular()} />
        </div>

        {fields.length === 0 ? (
          <small className="text-fg-muted">Sem itens na nota.</small>
        ) : (
          <>
            <DataTable
              rows={itens}
              columns={columns}
              getRowId={(r) => r.fieldId}
              toolbar={{ enableSearch: false, enableFilters: false }}
              paginationConfig={{ enabled: true, initialPageSize: 10 }}
              cardBreakpoint={false}
            />
            <small className="text-fg-muted">
              Total dos produtos: R$ {fmtBRL(totalProd)} — o total da nota é calculado ao gravar.
            </small>
          </>
        )}
      </div>

      {editIdx != null && (
        <NfItemModal
          inicial={editIdx >= 0 ? (fields[editIdx] as NfItemDto) : undefined}
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
          situacaoOptions={situacaoOptions}
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
  plcOptions,
  onFechar,
  onConfirmar,
}: {
  inicial?: NfContabilItemDto;
  situacaoOptions: Opcao[];
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
          onChange={(v) => set('idsituacao_nf', v ? Number(v) : undefined)}
          placeholder="Selecione a situação…"
        />
        <SelectField
          label="&Centro de custo"
          options={plcOptions}
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
