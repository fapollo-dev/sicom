import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Controller, useFieldArray, type UseFormReturn } from 'react-hook-form';
import { Pencil, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumnDef } from '@apollosg/design-system';
import {
  pedidoCompraSchema,
  PC_TIPO_FRETE_OPCOES,
  type CriarPedidoCompraDto,
  type PedidoCompraItemDto,
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
import { PedidoCompraItemModal } from './PedidoCompraItemModal';
import { ImportarXmlModal } from './ImportarXmlModal';
import { fecharPedido, reabrirPedido, gerarNfDoPedido } from './pedidoCompraApi';

/** hoje em ISO 'YYYY-MM-DD' (DATA default hoje, como no OnNewRecord do legado). */
const hojeISO = () => new Date().toISOString().slice(0, 10);
const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** combos {value:string} do schema → {value:string} p/ o SelectField. */
const freteOptions: Opcao[] = PC_TIPO_FRETE_OPCOES.map((o) => ({ value: o.value, label: o.label }));

/**
 * PEDIDO DE COMPRA (FRMPEDIDOCOMPRA) — a MAIOR tela do legado. Corte-1: documento de INTENÇÃO de
 * compra (cabeçalho PEDIDOCOMPRA + itens PEDIDOCOMPRA_I). Master-detalhe construído sobre o
 * `<CadMaster>` (largo) + o engine agregado (`compras/pedidos`), espelhando o NfCadMaster porém MUITO
 * mais simples (o pedido não dispara efeito algum — o FATO nasce na NF de entrada).
 *
 * Estado do documento: RASCUNHO (`fechado` !== 'S') ou FECHADO (`fechado` === 'S'). Fechado ⇒ form
 * READ-ONLY (o servidor reforça 422 na edição/exclusão) + ação "Reabrir"; rascunho ⇒ edição liberada +
 * ação "Fechar" (exige ≥1 item, reforçado no servidor). Usa `gerenciaEdicaoInterna` (como a NF) p/ que
 * a barra de ações Fechar/Reabrir continue acionável na navegação (browse).
 */
export function PedidoCompraCadMaster() {
  // ── LOOKUPs ──
  // Fornecedor: só parceiros FRN='S' (SegFornecedor do legado; o servidor reforça no `validar`).
  const { data: fornecedorOptions = [] } = useResourceOptions(
    'cadastro/parceiros',
    (p: any) => ({ value: String(p.codparceiro), label: `${p.codparceiro} - ${p.razao}` }),
    { campo: 'frn', operador: 'igual', valor: 'S' },
  );
  const { data: produtoOptions = [] } = useResourceOptions('cadastro/produtos', (r: any) => ({
    value: String(r.idproduto ?? r.codigo),
    label: `${r.codbarra} - ${r.descricao}`,
  }));

  const defaultValues = useMemo<Partial<CriarPedidoCompraDto>>(
    () => ({
      data: hojeISO(),
      codparceiro: undefined,
      itens: [],
    }),
    [],
  );

  return (
    <CadMaster<CriarPedidoCompraDto>
      titulo="Pedido de Compra"
      resourcePath="compras/pedidos"
      pk="codpedcomp"
      schema={pedidoCompraSchema}
      defaultValues={defaultValues}
      largura="6xl"
      gerenciaEdicaoInterna
      colunasPesquisa={[
        { campo: 'codpedcomp', label: 'Código', tipo: 'text', largura: 110 },
        { campo: 'fornecedor', label: 'Fornecedor', tipo: 'text' },
        { campo: 'data', label: 'Data', tipo: 'date', largura: 130 },
        { campo: 'total', label: 'Total', tipo: 'currency', largura: 140 },
        { campo: 'fechado', label: 'Fechado', tipo: 'text', largura: 100 },
      ]}
      campos={({ form, editavel }) => (
        <PedidoForm form={form} editavel={editavel} fornecedorOptions={fornecedorOptions} produtoOptions={produtoOptions} />
      )}
    />
  );
}

// ═══════════════════════════════ Formulário (cabeçalho + itens + ações) ═══════════════════════════════

function PedidoForm({
  form,
  editavel,
  fornecedorOptions,
  produtoOptions,
}: {
  form: UseFormReturn<CriarPedidoCompraDto>;
  editavel: boolean;
  fornecedorOptions: Opcao[];
  produtoOptions: Opcao[];
}) {
  // TRAVA de estado (espelha o `travado` da NF via watch): pedido FECHADO é read-only. `fechado` não
  // está no schema de escrita (é state-controlled), mas o read do agregado o traz e o reset o mantém.
  const fechado = (form.watch('fechado' as any) as string | undefined) === 'S';
  const liberado = editavel && !fechado;

  return (
    <div className="flex flex-col gap-form-gap">
      {fechado && (
        <div className="rounded-radius-base border border-border bg-bg-subtle p-pad-sm text-fg-muted">
          Pedido fechado — edição bloqueada. Use «Reabrir» para voltar a rascunho.
        </div>
      )}

      <CabecalhoBand form={form} editavel={liberado} fornecedorOptions={fornecedorOptions} />
      <ItensSection form={form} editavel={liberado} produtoOptions={produtoOptions} />
      <AcoesEstadoBar form={form} />
    </div>
  );
}

// ───────────────────────────── Banda de cabeçalho ─────────────────────────────

function CabecalhoBand({
  form,
  editavel,
  fornecedorOptions,
}: {
  form: UseFormReturn<CriarPedidoCompraDto>;
  editavel: boolean;
  fornecedorOptions: Opcao[];
}) {
  const err = form.formState.errors;
  const fechado = (form.watch('fechado' as any) as string | undefined) === 'S';
  const itens = (form.watch('itens') ?? []) as PedidoCompraItemDto[];
  const total = itens.reduce((s, it) => s + (Number(it.fatorembalagem) || 0) * (Number(it.vrcusto) || 0), 0);

  return (
    <fieldset disabled={!editavel} className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
      <div className="mb-form-gap flex items-center gap-gp-sm">
        <span className="rounded-radius-base bg-bg-subtle px-pad-sm py-pad-xs text-body-sm font-semibold text-fg-default">
          {fechado ? 'Fechado' : 'Rascunho'}
        </span>
        <span className="text-fg-muted">·</span>
        <span className="text-body-sm text-fg-muted">Cabeçalho do pedido</span>
        <span className="ml-auto text-body-sm text-fg-muted">Total do pedido</span>
        <span className="rounded-radius-base bg-bg-subtle px-pad-sm py-pad-xs text-body-sm font-semibold text-fg-default tabular-nums">
          R$ {fmtBRL(total)}
        </span>
      </div>

      {/* linha 1: Fornecedor (largo) */}
      <div>
        <Controller
          control={form.control}
          name="codparceiro"
          render={({ field }) => (
            <SelectField
              label="&Fornecedor"
              options={fornecedorOptions}
              value={field.value != null ? String(field.value) : undefined}
              onChange={(v) => field.onChange(v ? Number(v) : undefined)}
              placeholder="Selecione o fornecedor…"
              error={err.codparceiro?.message as string | undefined}
            />
          )}
        />
      </div>

      {/* linha 2: Data / Vencimento / Condição de pgto / Cruzamento NF */}
      <div className="mt-form-gap grid grid-cols-1 gap-form-gap sm:grid-cols-2 lg:grid-cols-4">
        <Controller
          control={form.control}
          name="data"
          render={({ field }) => (
            <DateField
              label="&Data"
              value={(field.value as string) || undefined}
              onChange={(v) => field.onChange(v ?? '')}
              error={err.data?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="dt_vencimento"
          render={({ field }) => (
            <DateField
              label="&Vencimento"
              value={(field.value as string) || undefined}
              onChange={(v) => field.onChange(v ?? undefined)}
              error={err.dt_vencimento?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="codconpagto"
          render={({ field }) => (
            <NumberField
              label="&Condição de pgto (cód.)"
              value={field.value as number | undefined}
              onChange={(v) => field.onChange(v)}
              decimais={0}
              min={0}
              error={err.codconpagto?.message as string | undefined}
            />
          )}
        />
        <Field
          label="&Nº NF (cruzamento)"
          error={err.pc_nronf_cruzamento?.message as string | undefined}
          {...form.register('pc_nronf_cruzamento')}
        />
      </div>

      {/* linha 3: Tipo de frete / Valor do frete */}
      <div className="mt-form-gap grid grid-cols-1 gap-form-gap sm:grid-cols-2 lg:grid-cols-4">
        <Controller
          control={form.control}
          name="pc_tipo_frete"
          render={({ field }) => (
            <SelectField
              label="Tipo de &frete"
              options={freteOptions}
              value={field.value ?? undefined}
              onChange={(v) => field.onChange(v || undefined)}
              placeholder="Selecione…"
              error={err.pc_tipo_frete?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="pc_valor_frete"
          render={({ field }) => (
            <CurrencyField
              label="&Valor do frete"
              value={field.value as number | undefined}
              onChange={(v) => field.onChange(v)}
              error={err.pc_valor_frete?.message as string | undefined}
            />
          )}
        />
      </div>

      {/* linha 4: Observações */}
      <div className="mt-form-gap">
        <TextArea label="&Observações" rows={2} {...form.register('obs')} />
      </div>
    </fieldset>
  );
}

// ───────────────────────────── Itens ─────────────────────────────

function ItensSection({
  form,
  editavel,
  produtoOptions,
}: {
  form: UseFormReturn<CriarPedidoCompraDto>;
  editavel: boolean;
  produtoOptions: Opcao[];
}) {
  const { fields, append, update, remove } = useFieldArray<CriarPedidoCompraDto, 'itens', 'fieldId'>({
    control: form.control,
    name: 'itens',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const onConfirmar = (item: PedidoCompraItemDto) => {
    if (editIdx == null) return;
    if (editIdx < 0) append(item);
    else update(editIdx, item);
    setEditIdx(null);
  };

  const rotuloProduto = (idproduto?: number) => {
    if (idproduto == null) return '';
    const o = produtoOptions.find((op) => op.value === String(idproduto));
    return o ? o.label : String(idproduto);
  };

  const itens = fields as Array<PedidoCompraItemDto & { fieldId: string }>;
  const total = itens.reduce((s, it) => s + (Number(it.fatorembalagem) || 0) * (Number(it.vrcusto) || 0), 0);

  const columns = useMemo<DataTableColumnDef<PedidoCompraItemDto & { fieldId: string }>[]>(
    () => [
      {
        field: 'idproduto',
        headerName: 'Produto',
        type: 'text',
        isPrimary: true,
        valueGetter: (row) => rotuloProduto(row.idproduto),
      },
      { field: 'fatorembalagem', headerName: 'Quantidade', type: 'number', width: 120 },
      {
        field: 'vrcusto',
        headerName: 'Custo unit.',
        type: 'text',
        width: 130,
        valueGetter: (row) => fmtBRL(Number(row.vrcusto) || 0),
      },
      {
        field: 'vlrembalagem',
        headerName: 'Total',
        type: 'text',
        width: 130,
        valueGetter: (row) => fmtBRL((Number(row.fatorembalagem) || 0) * (Number(row.vrcusto) || 0)),
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
            onClick: (r: PedidoCompraItemDto & { fieldId: string }) => {
              const idx = fields.findIndex((f) => f.fieldId === r.fieldId);
              if (idx >= 0) setEditIdx(idx);
            },
          },
          {
            id: 'remover',
            label: 'Remover',
            icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            destructive: true,
            onClick: (r: PedidoCompraItemDto & { fieldId: string }) => {
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
    <fieldset disabled={!editavel} className="border-0 p-0">
      <div className="flex flex-col gap-gp-sm">
        <div className="flex flex-wrap gap-gp-sm">
          <Button label="Adicionar &item" variant="soft" onClick={() => setEditIdx(-1)} />
        </div>

        {fields.length === 0 ? (
          <small className="text-fg-muted">Sem itens no pedido.</small>
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
              Total do pedido: R$ {fmtBRL(total)} — Σ (quantidade × custo). O servidor recalcula ao gravar.
            </small>
          </>
        )}
      </div>

      {editIdx != null && (
        <PedidoCompraItemModal
          inicial={editIdx >= 0 ? (fields[editIdx] as PedidoCompraItemDto) : undefined}
          produtoOptions={produtoOptions}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </fieldset>
  );
}

// ───────────────────────────── Ações de estado (Fechar / Reabrir) ─────────────────────────────

/**
 * Barra de transições de ESTADO + RECEBIMENTO. Fluxo: rascunho → «Fechar» → fechado → «Gerar NF de
 * entrada» → recebido. Rascunho: só «Fechar» (exige ≥1 item, reforçado no servidor). Fechado (não
 * recebido): «Reabrir» + «Gerar NF de entrada». Recebido (dtfaturamento): read-only, só aviso. Só
 * aparece em pedido GRAVADO (com codpedcomp).
 */
function AcoesEstadoBar({ form }: { form: UseFormReturn<CriarPedidoCompraDto> }) {
  const mensagem = useMensagem();
  const navigate = useNavigate();
  const [executando, setExecutando] = useState(false);
  const [mostrarImport, setMostrarImport] = useState(false);
  const codpedcomp = (form.getValues() as { codpedcomp?: number }).codpedcomp;
  const fechado = (form.watch('fechado' as any) as string | undefined) === 'S';
  const recebido = (form.watch('dtfaturamento' as any) as string | null | undefined) != null;
  if (codpedcomp == null) return null; // ações só em pedido gravado

  const fechar = async () => {
    if (executando) return;
    setExecutando(true);
    try {
      await fecharPedido(codpedcomp);
      form.setValue('fechado' as any, 'S');
      mensagem.sucesso('Pedido fechado. Gere a NF de entrada para receber, ou reabra para editar.');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const reabrir = async () => {
    if (executando) return;
    if (!window.confirm('Reabrir o pedido? Ele volta a rascunho e a edição é liberada.')) return;
    setExecutando(true);
    try {
      await reabrirPedido(codpedcomp);
      form.setValue('fechado' as any, 'N');
      mensagem.sucesso('Pedido reaberto: voltou a rascunho.');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const gerarNf = async () => {
    if (executando) return;
    if (!window.confirm('Gerar a NF de entrada a partir deste pedido? Os itens vêm do pedido como rascunho editável (ajuste ao documento do fornecedor na tela da NF).')) return;
    setExecutando(true);
    try {
      const { codnf } = await gerarNfDoPedido(codpedcomp);
      form.setValue('dtfaturamento' as any, new Date().toISOString());
      mensagem.sucesso(`NF de entrada ${codnf} gerada (rascunho). Confira e processe a NF (estoque/A Pagar) na tela de Notas de Entrada.`);
      navigate('/fiscal/notas/entrada');
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  // RECEBIMENTO corte-2/3: sucesso do import de XML (o modal cuida do parse/import/resolução de pendências).
  const onImportSucesso = (r: { codnf: number; divergencia: boolean }) => {
    form.setValue('dtfaturamento' as any, new Date().toISOString());
    setMostrarImport(false);
    mensagem.sucesso(
      `NF de entrada ${r.codnf} importada do XML${r.divergencia ? ' (atenção: total da NF diverge do vNF do XML — confira)' : ''}. Processe a NF (estoque/A Pagar) na tela de Notas de Entrada.`,
    );
    navigate('/fiscal/notas/entrada');
  };

  return (
    <fieldset className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Estado do pedido</legend>
      <div className="flex flex-wrap items-center gap-gp-sm">
        {!fechado && !recebido && <Button label="&Fechar pedido" variant="soft" onClick={() => void fechar()} />}
        {fechado && !recebido && <Button label="&Gerar NF de entrada" variant="soft" onClick={() => void gerarNf()} />}
        {fechado && !recebido && <Button label="&Importar XML da NFe" variant="soft" onClick={() => setMostrarImport(true)} />}
        {fechado && !recebido && <Button label="&Reabrir pedido" variant="ghost" onClick={() => void reabrir()} />}
        <small className="text-fg-muted">
          {recebido
            ? 'Pedido recebido (NF de entrada gerada). Confira/processe a NF na tela de Notas de Entrada.'
            : fechado
              ? 'Pedido fechado. Gere a NF de entrada (rascunho) ou importe o XML da NFe do fornecedor; ou reabra para editar.'
              : 'Pedido em rascunho. Fechar confirma o pedido (exige ao menos um item).'}
        </small>
      </div>
      {mostrarImport && (
        <ImportarXmlModal codpedcomp={codpedcomp} onFechar={() => setMostrarImport(false)} onSucesso={onImportSucesso} />
      )}
    </fieldset>
  );
}
