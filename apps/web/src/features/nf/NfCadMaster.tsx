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
} from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { NumberField } from '../../shared/ui/NumberField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { DateField } from '../../shared/ui/DateField';
import { TextArea } from '../../shared/ui/TextArea';
import { Button } from '../../shared/ui/Button';
import { useResourceOptions, type Opcao } from '../../shared/cadmaster/useResourceOptions';
import { useMensagem } from '../../shared/mensagem';
import { NfItemModal } from './NfItemModal';
import { recalcularNf } from './nfFiscalApi';
import { processarNf, reverterNf } from './nfProcessamentoApi';
import { faturarNf, estornarFaturamentoNf } from './nfFaturamentoApi';

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

/**
 * NOTA FISCAL (tela-coroa) — Fase 1: NÚCLEO CADASTRO, SEM EFEITOS. Construída sobre o pilar
 * <CadMaster> + o engine agregado (master NF + detalhes NF_PROD/itens e NF_REFERENCIA numa só
 * gravação). A tela ARMAZENA o documento (cabeçalho + itens + config fiscal + status inicial).
 *
 * **NÃO dispara efeito** (estoque/financeiro/contábil/SEFAZ) — isso é F3..F6. A NF nasce com
 * PROC='N' e STATUSNFE vazio; as TRAVAS de edição (PROC='S'/CONTABILIZADO='S'/STATUSNFE
 * enviado) são reforçadas no servidor (422 PT) e refletidas aqui (campos desabilitados).
 *
 * Parametrizada por `tipo` ('E'/'S'): /fiscal/notas/entrada e /saida são ESTE componente com
 * props diferentes — muda o título, o papel do parceiro (FRN/CLI), os modelos e o filtro da
 * Pesquisa (campo=tipo&igual&valor=E|S). Erros de negócio sobem como envelope PT (useMensagem).
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
      campos={({ form, editavel }) => {
        // TRAVA de estado (espelha dsNFStateChange + bloqueios do btnEditar do legado):
        // NF processada / contabilizada / enviada à SEFAZ não é editável (servidor reforça 422).
        const proc = form.watch('proc');
        const statusnfe = form.watch('statusnfe');
        const contabilizado = form.watch('contabilizado');
        const cancelada = form.watch('cancelada');
        const faturada = form.watch('faturada');
        const travado =
          proc === 'S' || contabilizado === 'S' || faturada === 'S' ||
          cancelada === 'S' || statusnfe === 'P' || statusnfe === 'D' || statusnfe === 'C';
        const liberado = editavel && !travado;
        return (
          <div className="flex flex-col gap-form-gap">
            {/* F3 — processar/reverter (move estoque). Fora do gate `liberado` (age na nota travada). */}
            <ProcessamentoSection form={form} />
            {/* F4 — faturar/estornar (gera títulos ARECEBER/APAGAR). Também fora do gate `liberado`. */}
            <FaturamentoSection form={form} tipo={tipo} />
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
            <CabecalhoSection
              form={form}
              editavel={liberado}
              tipo={tipo}
              modeloOptions={modeloOptions}
              parceiroOptions={parceiroOptions}
              cfopOptions={cfopOptions}
              situacaoOptions={situacaoOptions}
            />
            <ItensSection
              form={form}
              editavel={liberado}
              produtoOptions={produtoOptions}
              cfopOptions={cfopOptions}
              aliquotaOptions={aliquotaOptions}
              unidadeOptions={unidadeOptions}
            />
            <TransporteSection form={form} editavel={liberado} transpOptions={transpOptions} />
            <ReferenciasSection form={form} editavel={liberado} />
            <ObsSection form={form} editavel={liberado} />
          </div>
        );
      }}
    />
  );
}

// ───────────────────────────── Processamento (F3) ─────────────────────────────

/**
 * Ações de PROCESSAMENTO (F3): movem o estoque (entrada soma / saída baixa) e travam a nota.
 * Só aparece em nota SALVA (codnf). "Processar" quando proc='N'; "Reverter" quando proc='S' e
 * a nota não foi enviada à SEFAZ (statusnfe P/D bloqueia — o back também rejeita). PURO na UI:
 * o efeito é server-side/atômico; aqui só refletimos o novo estado (proc) p/ a tela travar.
 */
function ProcessamentoSection({ form }: { form: UseFormReturn<CriarNfDto> }) {
  const mensagem = useMensagem();
  const [executando, setExecutando] = useState(false);
  const proc = form.watch('proc');
  const statusnfe = form.watch('statusnfe');
  const codnf = (form.getValues() as { codnf?: number }).codnf;
  if (codnf == null) return null; // só em nota já gravada

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
    <fieldset className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Processamento</legend>
      <div className="flex flex-wrap items-center gap-gp-sm">
        {proc !== 'S' && (
          <Button label="&Processar nota" variant="soft" onClick={() => void processar()} />
        )}
        {proc === 'S' && !enviada && (
          <Button label="&Reverter processamento" variant="soft" onClick={() => void reverter()} />
        )}
        <small className="text-fg-muted">
          {proc === 'S' ? 'Nota processada (estoque movimentado).' : 'Nota não processada.'}
          {enviada ? ' Enviada à SEFAZ — reversão bloqueada.' : ''}
        </small>
      </div>
    </fieldset>
  );
}

// ───────────────────────────── Faturamento (F4) ─────────────────────────────

/**
 * Ações de FATURAMENTO (F4): geram títulos financeiros (ARECEBER saída / APAGAR entrada) por
 * IDNF. Só em nota SALVA (codnf). "Faturar" quando faturada!='S' (com nº parcelas / 1º
 * vencimento / intervalo); "Estornar faturamento" quando faturada='S' (bloqueado no back se
 * houver título quitado). Os títulos aparecem no picker do Lote de Cobrança.
 */
function FaturamentoSection({ form, tipo }: { form: UseFormReturn<CriarNfDto>; tipo: NfTipo }) {
  const mensagem = useMensagem();
  const [executando, setExecutando] = useState(false);
  const [numParcelas, setNumParcelas] = useState<number | undefined>(1);
  const [primeiroVencimento, setPrimeiroVencimento] = useState<string | undefined>(hojeISO());
  const [intervaloDias, setIntervaloDias] = useState<number | undefined>(30);
  const faturada = form.watch('faturada');
  const codnf = (form.getValues() as { codnf?: number }).codnf;
  if (codnf == null) return null;

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
    <fieldset className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Faturamento ({modalidade})</legend>
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
          <Button label="&Faturar" variant="soft" onClick={() => void faturar()} />
        </div>
      )}
    </fieldset>
  );
}

// ───────────────────────────── Cabeçalho ─────────────────────────────

function CabecalhoSection({
  form,
  editavel,
  tipo,
  modeloOptions,
  parceiroOptions,
  cfopOptions,
  situacaoOptions,
}: {
  form: UseFormReturn<CriarNfDto>;
  editavel: boolean;
  tipo: NfTipo;
  modeloOptions: Opcao[];
  parceiroOptions: Opcao[];
  cfopOptions: Opcao[];
  situacaoOptions: Opcao[];
}) {
  const err = form.formState.errors;
  return (
    <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Cabeçalho</legend>
      <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2 lg:grid-cols-3">
        <Controller
          control={form.control}
          name="modelo"
          render={({ field }) => (
            <SelectField
              label="&Modelo"
              options={modeloOptions}
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
        <Controller
          control={form.control}
          name="finalidade"
          render={({ field }) => (
            <SelectField
              label="&Finalidade"
              options={NF_FINALIDADE_OPCOES as unknown as Opcao[]}
              value={field.value ?? undefined}
              onChange={(v) => field.onChange(v || undefined)}
              placeholder="Selecione…"
              error={err.finalidade?.message as string | undefined}
            />
          )}
        />
        <div className="sm:col-span-2">
          <Controller
            control={form.control}
            name="codparceiro"
            render={({ field }) => (
              <SelectField
                label={`&${PARCEIRO_LABEL[tipo]}`}
                options={parceiroOptions}
                value={field.value != null ? String(field.value) : undefined}
                onChange={(v) => field.onChange(v ? Number(v) : undefined)}
                placeholder={`Selecione o ${PARCEIRO_LABEL[tipo].toLowerCase()}…`}
                error={err.codparceiro?.message as string | undefined}
              />
            )}
          />
        </div>
        <Controller
          control={form.control}
          name="cfop"
          render={({ field }) => (
            <SelectField
              label="C&FOP"
              options={cfopOptions}
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
              options={situacaoOptions}
              value={field.value != null ? String(field.value) : undefined}
              onChange={(v) => field.onChange(v ? Number(v) : undefined)}
              placeholder="Selecione a situação…"
              error={err.idsituacao_nf?.message as string | undefined}
            />
          )}
        />
      </div>
    </fieldset>
  );
}

// ───────────────────────────── Itens ─────────────────────────────

function ItensSection({
  form,
  editavel,
  produtoOptions,
  cfopOptions,
  aliquotaOptions,
  unidadeOptions,
}: {
  form: UseFormReturn<CriarNfDto>;
  editavel: boolean;
  produtoOptions: Opcao[];
  cfopOptions: Opcao[];
  aliquotaOptions: Opcao[];
  unidadeOptions: Opcao[];
}) {
  const { fields, append, update, remove, replace } = useFieldArray<CriarNfDto, 'itens', 'fieldId'>({
    control: form.control,
    name: 'itens',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const mensagem = useMensagem();
  const [recalculando, setRecalculando] = useState(false);

  // próximo NROITEM (máx+1) — espelha o cálculo do btnAddItem do legado.
  const proximoNroItem = () =>
    (fields as NfItemDto[]).reduce((m, it) => Math.max(m, Number(it.nroitem) || 0), 0) + 1;

  /**
   * "Recalcular impostos" (F2) — REUSO do motor: POST /fiscal/nf/recalcular com o dto atual
   * (header + itens) → devolve os itens com ICMS próprio + ICMS-ST + IPI calculados; aplica de
   * volta no field-array (os totais do header são re-somados server-side ao gravar). PURO: não grava.
   */
  const recalcular = async () => {
    if (recalculando) return; // guarda de reentrância
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
    const o = produtoOptions.find((op) => op.value === String(codproduto));
    return o ? o.label : String(codproduto);
  };

  // Totais (PREVIEW client-side; o servidor é a autoridade via derivar — F1 btnCalcular).
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
    [fields, remove, produtoOptions],
  );

  return (
    <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Itens da nota</legend>
      <div className="flex flex-col gap-gp-sm">
        <div className="flex flex-wrap gap-gp-sm">
          <Button label="Adicionar &item" variant="soft" onClick={() => setEditIdx(-1)} />
          {/* F2 — recálculo fiscal por item (reusa o motor precificacao); puro, não grava. */}
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
          produtoOptions={produtoOptions}
          cfopOptions={cfopOptions}
          aliquotaOptions={aliquotaOptions}
          unidadeOptions={unidadeOptions}
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
    <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Transportadora e volumes</legend>
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
    <fieldset disabled={!editavel} className="rounded-radius-base border border-border p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">NF's Referência</legend>
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

// ───────────────────────────── Observações ─────────────────────────────

function ObsSection({ form, editavel }: { form: UseFormReturn<CriarNfDto>; editavel: boolean }) {
  return (
    <fieldset disabled={!editavel} className="rounded-radius-md border border-border p-pad-md">
      <legend className="px-pad-xs text-fg-muted">Dados gerais / Observações</legend>
      <div className="flex flex-col gap-form-gap">
        <TextArea label="&Observações" rows={3} {...form.register('obs')} />
        <TextArea label="Observações &fiscais" rows={2} {...form.register('obsnf')} />
      </div>
    </fieldset>
  );
}
