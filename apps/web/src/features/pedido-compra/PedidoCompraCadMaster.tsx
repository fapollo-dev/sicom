import { useMemo, useState } from 'react';
import { gradeLayoutService } from '../../shared/grade/savedViewsService';
import { Controller, useFieldArray, type UseFormReturn } from 'react-hook-form';
import { Pencil, Trash2 } from 'lucide-react';
import { DataTable, Modal, type DataTableColumnDef } from '@apollosg/design-system';
import {
  pedidoCompraSchema,
  PC_TIPO_FRETE_OPCOES,
  type CriarPedidoCompraDto,
  type PedidoCompraItemDto,
} from '@apollo/shared';
import { CadMaster } from '../../shared/cadmaster/CadMaster';
import { Field } from '../../shared/ui/Field';
import { SelectField } from '../../shared/ui/SelectField';
import { CurrencyField } from '../../shared/ui/CurrencyField';
import { DateField } from '../../shared/ui/DateField';
import { TextArea } from '../../shared/ui/TextArea';
import { Button } from '../../shared/ui/Button';
import { useResourceOptions, type Opcao } from '../../shared/cadmaster/useResourceOptions';
import { useMensagem } from '../../shared/mensagem';
import { PedidoCompraItemModal } from './PedidoCompraItemModal';
import { ImportarXmlModal } from './ImportarXmlModal';
import { AnalisePedidoNfPanel } from './AnalisePedidoNfPanel';
import {
  fecharPedido, reabrirPedido, gerarNfDoPedido, gerarParcelasPedido, obterPedido,
  atualizarPrecosPedido, duplicarPedido, gerarBonificadoPedido, liberarLimitePedido, importarItensPedido,
} from './pedidoCompraApi';
import type { PedidoCompraParcelaDto } from '@apollo/shared';
import { NumberField } from '../../shared/ui/NumberField';

/** hoje em ISO 'YYYY-MM-DD' (DATA default hoje, como no OnNewRecord do legado). */
const hojeISO = () => new Date().toISOString().slice(0, 10);

/**
 * mig 303 — o ESTADO POR LOJA do pedido, como a leitura do agregado o devolve (`lojas`, `fechamento`,
 * `loja_logada_fechada`). As lojas saem do campo «Lojas do pedido» (o CSV que o comprador edita) com o estado lido;
 * loja recém-incluída ainda não tem estado — está aberta.
 */
function estadoLojas(form: UseFormReturn<CriarPedidoCompraDto>) {
  const csv = String((form.watch('empresas' as any) as string | undefined) ?? '');
  const lidas = ((form.watch('lojas' as any) as Array<{ idempresa: number; fechado: boolean }> | undefined) ?? []);
  const doCsv = [...new Set(csv.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0))];
  const ids = doCsv.length ? doCsv : lidas.map((l) => l.idempresa);
  const lojas = ids.sort((a, b) => a - b).map((id) => ({ idempresa: id, fechado: !!lidas.find((l) => l.idempresa === id)?.fechado }));
  const fechamento = (form.watch('fechamento' as any) as string | undefined)
    ?? ((form.watch('fechado' as any) as string | undefined) === 'S' ? 'total' : 'nenhum');
  const lojaLogadaFechada = (form.watch('loja_logada_fechada' as any) as boolean | undefined) ?? false;
  const participa = (form.watch('loja_logada_participa' as any) as boolean | undefined) ?? true;
  return { lojas, fechamento, lojaLogadaFechada, participa, travado: fechamento === 'total' || lojaLogadaFechada };
}

/** a quantidade (caixas) do item: a soma das lojas quando elas vêm, senão a do item (default 1, a linha de antes). */
function qtdeDoItem(it: Partial<PedidoCompraItemDto>): number {
  if (Array.isArray(it.lojas) && it.lojas.length) return it.lojas.reduce((a, l) => a + (Number(l.qtde) || 0), 0);
  return Number(it.qtde ?? 1) || 1;
}

/** recarrega o estado por loja depois de fechar/reabrir (quem fechou, o que ficou parcial). */
async function recarregarEstado(form: UseFormReturn<CriarPedidoCompraDto>, codpedcomp: number) {
  const fresh = (await obterPedido(codpedcomp)) as unknown as Record<string, unknown>;
  for (const k of ['fechado', 'lojas', 'fechamento', 'loja_logada_fechada', 'loja_logada_participa', 'empresas']) {
    form.setValue(k as any, fresh[k] as any);
  }
}
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
  // mapa idproduto → alíquota-código (para o motor precificar o item). Reusa o MESMO fetch de produtos
  // (react-query dedupe por queryKey) — só um `select` diferente.
  const { data: produtoAliqPares = [] } = useResourceOptions('cadastro/produtos', (r: any) => ({
    value: String(r.idproduto ?? r.codigo),
    label: String(r.aliquota ?? ''),
  }));
  const produtoAliquotas = useMemo(
    () => Object.fromEntries(produtoAliqPares.map((o) => [o.value, o.label])) as Record<string, string>,
    [produtoAliqPares],
  );
  // corte-2: condição de pagamento (lookup GLOBAL). Rótulo mostra os prazos (CD1..CD8) em dias.
  const { data: condicaoOptions = [] } = useResourceOptions('compras/condicoes-pagto', (c: any) => {
    const dias = ['cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8']
      .map((k) => c[k]).filter((d: unknown) => d != null).join('/');
    return { value: String(c.codconpagto), label: `${c.codconpagto} - ${c.descricao ?? ''}${dias ? ` (${dias} dias)` : ''}` };
  });
  // corte-final: situação-NF (classificação do pedido; o gerar-NF a carrega à NF de entrada).
  const { data: situacaoOptions = [] } = useResourceOptions('cadastro/situacoes-nf', (s: any) => ({
    value: String(s.idsituacao_nf ?? s.codigo),
    label: `${s.idsituacao_nf ?? s.codigo} - ${s.descricao ?? ''}`,
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
        <PedidoForm form={form} editavel={editavel} fornecedorOptions={fornecedorOptions} produtoOptions={produtoOptions} condicaoOptions={condicaoOptions} situacaoOptions={situacaoOptions} produtoAliquotas={produtoAliquotas} />
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
  condicaoOptions,
  situacaoOptions,
  produtoAliquotas,
}: {
  form: UseFormReturn<CriarPedidoCompraDto>;
  editavel: boolean;
  fornecedorOptions: Opcao[];
  produtoOptions: Opcao[];
  condicaoOptions: Opcao[];
  situacaoOptions: Opcao[];
  produtoAliquotas: Record<string, string>;
}) {
  // TRAVA de estado (espelha o `travado` da NF via watch): pedido FECHADO é read-only. `fechado` não
  // está no schema de escrita (é state-controlled), mas o read do agregado o traz e o reset o mantém.
  // mig 303: o fechamento é POR LOJA — a edição trava com TODAS as lojas fechadas ou com a loja logada fechada
  // (btnEditarClick do legado). O cabeçalho `fechado` só vale para o pedido ainda sem estado por loja (novo).
  const est = estadoLojas(form);
  const bonificado = (form.watch('bonificacao' as any) as string | undefined) === 'S';
  const liberado = editavel && !est.travado;

  return (
    <div className="flex flex-col gap-form-gap">
      {est.travado && (
        <div className="rounded-radius-base border border-border bg-bg-subtle p-pad-sm text-fg-muted">
          {est.fechamento === 'total'
            ? 'Pedido fechado em todas as lojas — edição bloqueada. Use «Reabrir» para voltar a rascunho.'
            : 'Pedido fechado nesta loja — edição bloqueada aqui. Use «Reabrir» para alterar a quantidade desta loja.'}
        </div>
      )}
      {!est.travado && est.fechamento === 'parcial' && (
        <div className="rounded-radius-base border border-border bg-bg-subtle p-pad-sm text-fg-muted">
          Fechado em parte das lojas ({est.lojas.filter((l) => l.fechado).map((l) => `loja ${l.idempresa}`).join(', ')}): a
          quantidade delas não muda, e não se tiram itens.
        </div>
      )}
      {bonificado && (
        <div className="rounded-radius-base border border-border bg-bg-subtle p-pad-sm font-semibold text-fg-default">
          Pedido de BONIFICAÇÃO (espelho) — itens 100% bonificados.
        </div>
      )}

      <CabecalhoBand form={form} editavel={liberado} fornecedorOptions={fornecedorOptions} condicaoOptions={condicaoOptions} situacaoOptions={situacaoOptions} />
      <ItensSection form={form} editavel={liberado} produtoOptions={produtoOptions} produtoAliquotas={produtoAliquotas} />
      <ParcelasSection form={form} editavel={liberado} />
      <RecebimentoSection form={form} />
    </div>
  );
}

/**
 * Wave 4 corte-3: agrupa a barra de estado (fechar/gerar-nf/importar/reabrir) com o painel de saldo & conferência
 * (Pedido×NF). Ao gerar/importar uma NF, a barra chama `onRecebeu(codnf)` → re-busca o saldo (refreshKey) e
 * pré-preenche a conferência da NF recém-recebida. O painel só aparece em pedido FECHADO (recebimento iniciado).
 */
function RecebimentoSection({ form }: { form: UseFormReturn<CriarPedidoCompraDto> }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [ultimoCodnf, setUltimoCodnf] = useState<number | undefined>(undefined);
  const codpedcomp = (form.getValues() as { codpedcomp?: number }).codpedcomp;
  const fechado = (form.watch('fechado' as any) as string | undefined) === 'S';
  return (
    <>
      <AcoesEstadoBar
        form={form}
        onRecebeu={(codnf) => {
          setUltimoCodnf(codnf);
          setRefreshKey((k) => k + 1);
        }}
      />
      {codpedcomp != null && fechado && (
        <AnalisePedidoNfPanel codpedcomp={codpedcomp} refreshKey={refreshKey} ultimoCodnf={ultimoCodnf} />
      )}
    </>
  );
}

// ───────────────────────────── Banda de cabeçalho ─────────────────────────────

const CD_KEYS = ['cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'] as const;

function CabecalhoBand({
  form,
  editavel,
  fornecedorOptions,
  condicaoOptions,
  situacaoOptions,
}: {
  form: UseFormReturn<CriarPedidoCompraDto>;
  editavel: boolean;
  fornecedorOptions: Opcao[];
  condicaoOptions: Opcao[];
  situacaoOptions: Opcao[];
}) {
  const err = form.formState.errors;
  const est = estadoLojas(form);
  const itens = (form.watch('itens') ?? []) as PedidoCompraItemDto[];
  // 078 FLIP: total = Σ TOTALCUSTO = Σ (qtde × fator × custo); a qtde do item é a soma das lojas (mig 303).
  const total = itens.reduce((s, it) => s + qtdeDoItem(it) * (Number(it.fatorembalagem) || 0) * (Number(it.vrcusto) || 0), 0);
  const rotuloEstado = est.fechamento === 'total' ? 'Fechado' : est.fechamento === 'parcial' ? 'Fechado em parte' : 'Rascunho';

  return (
    <fieldset disabled={!editavel} className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
      <div className="mb-form-gap flex items-center gap-gp-sm">
        <span className="rounded-radius-base bg-bg-subtle px-pad-sm py-pad-xs text-body-sm font-semibold text-fg-default">
          {rotuloEstado}
        </span>
        <span className="text-fg-muted">·</span>
        <span className="text-body-sm text-fg-muted">Cabeçalho do pedido</span>
        <span className="ml-auto text-body-sm text-fg-muted">Total do pedido</span>
        <span className="rounded-radius-base bg-bg-subtle px-pad-sm py-pad-xs text-body-sm font-semibold text-fg-default tabular-nums">
          R$ {fmtBRL(total)}
        </span>
      </div>

      {/* mig 303: as LOJAS PARTICIPANTES (o CSV do legado, '1, 2') e o fechamento de cada uma */}
      <div className="mb-form-gap flex flex-wrap items-end gap-gp-sm">
        <div className="w-48">
          <Field label="&Lojas do pedido" placeholder="ex.: 1, 2" {...form.register('empresas' as any)}
            error={(err as any).empresas?.message as string | undefined} />
        </div>
        {est.lojas.map((l) => (
          <span key={l.idempresa} className={`rounded-radius-base px-pad-sm py-pad-xs text-body-sm ${l.fechado ? 'bg-bg-subtle font-semibold text-fg-default' : 'border border-border text-fg-muted'}`}>
            Loja {l.idempresa}: {l.fechado ? 'fechada' : 'aberta'}
          </span>
        ))}
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
          name="data_faturamento"
          render={({ field }) => (
            <DateField
              label="Data de &faturamento"
              value={(field.value as string) || undefined}
              onChange={(v) => field.onChange(v ?? undefined)}
              error={err.data_faturamento?.message as string | undefined}
            />
          )}
        />
        <Controller
          control={form.control}
          name="codconpagto"
          render={({ field }) => (
            <SelectField
              label="&Condição de pgto"
              options={condicaoOptions}
              value={field.value != null ? String(field.value) : undefined}
              onChange={(v) => field.onChange(v ? Number(v) : undefined)}
              placeholder="Selecione a condição…"
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

      {/* linha 2b (corte-final): prazos CD1..CD8 — OVERRIDE local da condição (RatearTotalNasParcelas). */}
      <details className="mt-form-gap rounded-radius-base border border-border p-pad-sm">
        <summary className="cursor-pointer text-body-sm text-fg-muted">
          Prazos das parcelas em dias (CD1..CD8) — sobrepõem a condição de pagamento
        </summary>
        <div className="mt-form-gap grid grid-cols-4 gap-form-gap sm:grid-cols-8">
          {CD_KEYS.map((cd, i) => (
            <Controller
              key={cd}
              control={form.control}
              name={cd}
              render={({ field }) => (
                <NumberField
                  label={`CD${i + 1}`}
                  value={field.value as number | undefined}
                  onChange={(v) => field.onChange(v)}
                  decimais={0}
                  min={0}
                  error={form.formState.errors[cd]?.message as string | undefined}
                />
              )}
            />
          ))}
        </div>
      </details>

      {/* linha 3: Tipo de frete / Valor do frete / Situação-NF */}
      <div className="mt-form-gap grid grid-cols-1 gap-form-gap sm:grid-cols-2 lg:grid-cols-4">
        <Controller
          control={form.control}
          name="idsituacao_nf"
          render={({ field }) => (
            <SelectField
              label="&Situação (NF)"
              options={situacaoOptions}
              value={field.value != null ? String(field.value) : undefined}
              onChange={(v) => field.onChange(v ? Number(v) : undefined)}
              placeholder="Classificação p/ a NF de entrada…"
              error={form.formState.errors.idsituacao_nf?.message as string | undefined}
            />
          )}
        />
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
  produtoAliquotas,
}: {
  form: UseFormReturn<CriarPedidoCompraDto>;
  editavel: boolean;
  produtoOptions: Opcao[];
  produtoAliquotas: Record<string, string>;
}) {
  const { fields, append, update, remove } = useFieldArray<CriarPedidoCompraDto, 'itens', 'fieldId'>({
    control: form.control,
    name: 'itens',
    keyName: 'fieldId',
  });
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const mensagem = useMensagem();
  const [importando, setImportando] = useState(false);
  const codpedcomp = (form.getValues() as { codpedcomp?: number }).codpedcomp;

  /** corte-final: importa itens em massa do fornecedor (associados/comprados) e recarrega o pedido. */
  const importar = async (origem: 'associados' | 'comprados') => {
    if (importando || codpedcomp == null) return;
    setImportando(true);
    try {
      const r = await importarItensPedido(codpedcomp, origem);
      const fresh = await obterPedido(codpedcomp);
      form.setValue('itens' as any, (fresh.itens ?? []) as any);
      mensagem.sucesso(
        r.importados > 0
          ? `${r.importados} item(ns) importado(s) do fornecedor${r.inativos ? ` (${r.inativos} inativo(s) ignorado(s))` : ''}.`
          : 'Nenhum item novo a importar deste fornecedor.',
      );
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setImportando(false);
    }
  };

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
  // 078 FLIP: total = Σ TOTALCUSTO = Σ (qtde × fator × custo); a qtde do item é a soma das lojas (mig 303).
  const linhaTotal = (it: Partial<PedidoCompraItemDto>) =>
    qtdeDoItem(it) * (Number(it.fatorembalagem) || 0) * (Number(it.vrcusto) || 0);
  const lojasPedido = estadoLojas(form).lojas;
  const total = itens.reduce((s, it) => s + linhaTotal(it), 0);

  const columns = useMemo<DataTableColumnDef<PedidoCompraItemDto & { fieldId: string }>[]>(
    () => [
      {
        field: 'idproduto',
        headerName: 'Produto',
        type: 'text',
        isPrimary: true,
        valueGetter: (row) => rotuloProduto(row.idproduto),
      },
      { field: 'qtde', headerName: 'Qtde', type: 'number', width: 90, valueGetter: (row) => qtdeDoItem(row) },
      // mig 303: a distribuição entre as lojas, quando o pedido tem mais de uma
      ...(lojasPedido.length > 1
        ? [{
            field: 'lojas' as any, headerName: 'Por loja', type: 'text' as const, width: 150,
            valueGetter: (row: PedidoCompraItemDto) => (row.lojas ?? []).map((l) => `${l.idempresa}: ${Number(l.qtde) || 0}`).join(' · '),
          }]
        : []),
      { field: 'fatorembalagem', headerName: 'Fator/emb.', type: 'number', width: 100 },
      {
        field: 'vrcusto',
        headerName: 'Custo unit.',
        type: 'text',
        width: 120,
        valueGetter: (row) => fmtBRL(Number(row.vrcusto) || 0),
      },
      {
        field: 'totalcusto',
        headerName: 'Total',
        type: 'text',
        width: 120,
        valueGetter: (row) => fmtBRL(linhaTotal(row)),
      },
      // corte-final: analítica da precificação visível no grid (venda praticada + margem líquida L2).
      {
        field: 'vrvenda',
        headerName: 'Venda',
        type: 'text',
        width: 110,
        valueGetter: (row) => (row.vrvenda != null && Number(row.vrvenda) > 0 ? fmtBRL(Number(row.vrvenda)) : '—'),
      },
      {
        field: 'margeml2',
        headerName: 'Margem %',
        type: 'text',
        width: 100,
        valueGetter: (row) => (row.margeml2 != null ? `${Number(row.margeml2).toFixed(2)}%` : '—'),
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
    [fields, remove, produtoOptions, lojasPedido.length],
  );

  return (
    <fieldset disabled={!editavel} className="border-0 p-0">
      <div className="flex flex-col gap-gp-sm">
        <div className="flex flex-wrap items-center gap-gp-sm">
          <Button label="Adicionar &item" variant="soft" onClick={() => setEditIdx(-1)} />
          {codpedcomp != null && (
            <>
              <Button label="Importar do fornecedor (&associados)" variant="ghost" onClick={() => void importar('associados')} />
              <Button label="Importar já &comprados" variant="ghost" onClick={() => void importar('comprados')} />
            </>
          )}
        </div>

        {fields.length === 0 ? (
          <small className="text-fg-muted">Sem itens no pedido.</small>
        ) : (
          <>
            <DataTable
      persistId="pedido-compra"
      savedViewsService={gradeLayoutService}
              rows={itens}
              columns={columns}
              getRowId={(r) => r.fieldId}
              toolbar={{ enableSearch: false, enableFilters: false }}
              paginationConfig={{ enabled: true, initialPageSize: 10 }}
              cardBreakpoint={false}
            />
            <small className="text-fg-muted">
              Total do pedido: R$ {fmtBRL(total)} — Σ (qtde × fator × custo). O servidor recalcula ao gravar.
            </small>
          </>
        )}
      </div>

      {editIdx != null && (
        <PedidoCompraItemModal
          inicial={editIdx >= 0 ? (fields[editIdx] as PedidoCompraItemDto) : undefined}
          lojas={lojasPedido}
          produtoOptions={produtoOptions}
          produtoAliquotas={produtoAliquotas}
          onFechar={() => setEditIdx(null)}
          onConfirmar={onConfirmar}
        />
      )}
    </fieldset>
  );
}

// ───────────────────────────── Parcelas (condição de pagamento) ─────────────────────────────

/**
 * PARCELAS do pedido (corte-2). O botão «Gerar parcelas» chama o servidor (RatearTotalNasParcelas):
 * rateia o total pelos prazos CD1..CD8 (do pedido, senão da condição), venc = data + CDn, sobra na 1ª.
 * mig 303: o rateio é POR LOJA — cada loja do pedido parcela o próprio total (a coluna Loja, e o total de
 * cada uma no rodapé). Exige pedido GRAVADO. As parcelas são um 2º detalhe (persistem no agregado).
 */
const chaveParc = (p: PedidoCompraParcelaDto) => `${p.idempresa ?? ''}-${p.parcela}`;

function ParcelasSection({ form, editavel }: { form: UseFormReturn<CriarPedidoCompraDto>; editavel: boolean }) {
  const mensagem = useMensagem();
  const [gerando, setGerando] = useState(false);
  // corte-final: edição manual de valor/vencimento por parcela (CedValorCdnExit do legado). Persiste no PUT.
  const [editParc, setEditParc] = useState<{ idx: number; valor?: number; data?: string } | null>(null);
  const codpedcomp = (form.getValues() as { codpedcomp?: number }).codpedcomp;
  const parcelas = (form.watch('parcelas') ?? []) as PedidoCompraParcelaDto[];
  const total = parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const porLoja = [...parcelas.reduce((m, p) => {
    const l = Number(p.idempresa ?? 0);
    return m.set(l, (m.get(l) ?? 0) + (Number(p.valor) || 0));
  }, new Map<number, number>())].sort((a, b) => a[0] - b[0]);

  const salvarParcela = () => {
    if (editParc == null) return;
    const novas = parcelas.map((p, i) =>
      i === editParc.idx ? { ...p, valor: editParc.valor ?? p.valor, data: editParc.data ?? p.data } : p,
    );
    form.setValue('parcelas' as any, novas as any, { shouldDirty: true });
    setEditParc(null);
  };
  const removerParcela = (idx: number) => {
    // renumera após remover (PARCELA 1..n DENTRO DA LOJA — o legado deleta a parcela zerada e re-rateia; aqui
    // remoção explícita).
    const loja = parcelas[idx]?.idempresa ?? null;
    let n = 0;
    const novas = parcelas.filter((_, i) => i !== idx)
      .map((p) => ((p.idempresa ?? null) === loja ? { ...p, parcela: ++n } : p));
    form.setValue('parcelas' as any, novas as any, { shouldDirty: true });
  };

  const gerar = async () => {
    if (codpedcomp == null) {
      mensagem.erro('Grave o pedido antes de gerar as parcelas.');
      return;
    }
    if (gerando) return;
    setGerando(true);
    try {
      const r = await gerarParcelasPedido(codpedcomp);
      const fresh = await obterPedido(codpedcomp);
      form.setValue('parcelas' as any, (fresh.parcelas ?? []) as any);
      mensagem.sucesso(`${r.parcelas} parcela(s) gerada(s)${(r.lojas ?? 1) > 1 ? ` para ${r.lojas} lojas` : ''} (total R$ ${fmtBRL(r.total)}).`);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setGerando(false);
    }
  };

  const columns = useMemo<DataTableColumnDef<PedidoCompraParcelaDto>[]>(
    () => [
      { field: 'idempresa', headerName: 'Loja', type: 'number', width: 80 },
      { field: 'parcela', headerName: 'Parcela', type: 'number', width: 100, isPrimary: true },
      { field: 'data', headerName: 'Vencimento', type: 'text', width: 150, valueGetter: (r) => String(r.data ?? '').slice(0, 10) },
      { field: 'qtdediasaposfaturamento', headerName: 'Dias', type: 'number', width: 90 },
      { field: 'valor', headerName: 'Valor', type: 'text', width: 140, valueGetter: (r) => fmtBRL(Number(r.valor) || 0) },
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
            onClick: (r: PedidoCompraParcelaDto) => {
              const idx = parcelas.findIndex((p) => chaveParc(p) === chaveParc(r));
              if (idx >= 0) setEditParc({ idx, valor: Number(parcelas[idx].valor) || 0, data: String(parcelas[idx].data ?? '').slice(0, 10) });
            },
          },
          {
            id: 'remover',
            label: 'Remover',
            icon: <Trash2 className="size-icon-sm" strokeWidth={1.7} aria-hidden />,
            destructive: true,
            onClick: (r: PedidoCompraParcelaDto) => {
              const idx = parcelas.findIndex((p) => chaveParc(p) === chaveParc(r));
              if (idx >= 0) removerParcela(idx);
            },
          },
        ],
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parcelas],
  );

  return (
    <fieldset disabled={!editavel} className="border-0 p-0">
      <div className="flex flex-col gap-gp-sm">
        <div className="flex flex-wrap items-center gap-gp-sm">
          <span className="text-body-sm font-semibold text-fg-default">Parcelas</span>
          {codpedcomp != null && <Button label="&Gerar parcelas" variant="soft" onClick={() => void gerar()} />}
          <small className="text-fg-muted">Rateia o total pela condição de pagamento (prazos CD1..CD8). Grave o pedido antes.</small>
        </div>
        {parcelas.length === 0 ? (
          <small className="text-fg-muted">Sem parcelas. Selecione a condição de pagamento e clique «Gerar parcelas».</small>
        ) : (
          <>
            <DataTable
      persistId="pedido-compra-2"
      savedViewsService={gradeLayoutService}
              rows={parcelas}
              columns={columns}
              getRowId={chaveParc}
              toolbar={{ enableSearch: false, enableFilters: false }}
              cardBreakpoint={false}
            />
            <small className="text-fg-muted">
              {porLoja.length > 1 && <>{porLoja.map(([l, v]) => `Loja ${l}: R$ ${fmtBRL(v)}`).join(' · ')} · </>}
              Total das parcelas: R$ {fmtBRL(total)}. Ajustes manuais persistem ao gravar o pedido.
            </small>
          </>
        )}
      </div>

      {editParc != null && (
        <Modal
          open
          onClose={() => setEditParc(null)}
          size="sm"
          title={`Editar parcela ${parcelas[editParc.idx]?.parcela ?? ''}${porLoja.length > 1 ? ` da loja ${parcelas[editParc.idx]?.idempresa ?? ''}` : ''}`}
          primaryAction={{ label: 'Aplicar', onClick: salvarParcela }}
          secondaryAction={{ label: 'Cancelar', onClick: () => setEditParc(null) }}
        >
          <div className="grid grid-cols-1 gap-form-gap sm:grid-cols-2">
            <CurrencyField label="&Valor" value={editParc.valor} onChange={(v) => setEditParc((e) => (e ? { ...e, valor: v as number } : e))} />
            <DateField label="&Vencimento" value={editParc.data || undefined} onChange={(v) => setEditParc((e) => (e ? { ...e, data: v ?? e.data } : e))} />
          </div>
        </Modal>
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
function AcoesEstadoBar({ form, onRecebeu }: { form: UseFormReturn<CriarPedidoCompraDto>; onRecebeu?: (codnf: number) => void }) {
  const mensagem = useMensagem();
  const [executando, setExecutando] = useState(false);
  const [mostrarImport, setMostrarImport] = useState(false);
  const codpedcomp = (form.getValues() as { codpedcomp?: number }).codpedcomp;
  const fechado = (form.watch('fechado' as any) as string | undefined) === 'S';
  const recebido = (form.watch('dtfaturamento' as any) as string | null | undefined) != null;
  const est = estadoLojas(form);
  if (codpedcomp == null) return null; // ações só em pedido gravado

  const fechar = async () => {
    if (executando) return;
    setExecutando(true);
    // cada recusa do servidor que o legado resolvia com uma liberação vira uma pergunta e uma nova tentativa:
    // o LIMITE do período (liberar-limite, grant LIBERAVALORMAX) e a META DIÁRIA da loja (senha administrativa).
    let senhaAdm: string | undefined;
    let limiteLiberado = false;
    try {
      for (;;) {
        try {
          const r = (await fecharPedido(codpedcomp, senhaAdm)) as { fechamento?: string; idempresa?: number };
          await recarregarEstado(form, codpedcomp);
          mensagem.sucesso(r?.fechamento === 'parcial'
            ? `Pedido fechado para a loja ${r.idempresa ?? ''}. As outras lojas do pedido ainda estão abertas.`
            : 'Pedido fechado. Gere a NF de entrada para receber, ou reabra para editar.');
          return;
        } catch (e) {
          const env = (e as { envelope?: { code?: string; detalhe?: any } })?.envelope;
          if (env?.code === 'PEDIDO_LIMITE_EXCEDIDO' && !limiteLiberado) {
            if (!window.confirm('O pedido excede o limite de compra do período. Liberar o limite (requer permissão) e fechar?')) return;
            await liberarLimitePedido(codpedcomp);
            limiteLiberado = true;
            continue;
          }
          if (env?.code === 'PEDIDO_META_DIARIA_EXCEDIDA' && senhaAdm == null) {
            // a mensagem do legado (mniFecharPedidoClick): loja, valor permitido e total informado
            const linhas = ((env.detalhe?.excedidas ?? []) as Array<{ idempresa: number; meta: number; total: number }>)
              .map((x) => `Loja ${x.idempresa} — valor permitido: ${fmtBRL(x.meta)}, total informado: ${fmtBRL(x.total)}`);
            const s = window.prompt(`O pedido ultrapassa a meta diária de compra.\n${linhas.join('\n')}\nSerá preciso liberação. Senha administrativa:`);
            if (!s) return;
            senhaAdm = s;
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  // corte-final: PROPAGA o preço de venda dos itens ao catálogo (MULTI_PRECO) — "Atualizar preço → On-line".
  const atualizarPrecos = async () => {
    if (executando) return;
    if (!window.confirm('Atualizar o preço de venda do CATÁLOGO (multi-preço) com os preços dos itens deste pedido?')) return;
    setExecutando(true);
    try {
      const r = await atualizarPrecosPedido(codpedcomp);
      mensagem.sucesso(
        r.atualizados > 0
          ? `${r.atualizados} preço(s) atualizado(s) no catálogo${r.pulados_promocao ? ` (${r.pulados_promocao} em promoção, não alterado(s))` : ''}.`
          : 'Nenhum produto teve o valor de venda alterado.',
      );
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const duplicar = async (bonificar: boolean) => {
    if (executando) return;
    const msg = bonificar
      ? 'Gerar o pedido-ESPELHO de bonificação (itens 100% bonificados)?'
      : 'Duplicar este pedido (novo rascunho com os mesmos itens, datas de hoje)?';
    if (!window.confirm(msg)) return;
    setExecutando(true);
    try {
      const r = bonificar ? await gerarBonificadoPedido(codpedcomp) : await duplicarPedido(codpedcomp);
      mensagem.sucesso(`${bonificar ? 'Pedido bonificado' : 'Pedido duplicado'}: nº ${r.codpedcomp} (rascunho). Localize-o na Pesquisa.`);
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  const reabrir = async () => {
    if (executando) return;
    if (!window.confirm('Reabrir o pedido para esta loja? A quantidade dela volta a poder ser alterada.')) return;
    setExecutando(true);
    try {
      await reabrirPedido(codpedcomp);
      await recarregarEstado(form, codpedcomp);
      mensagem.sucesso('Pedido reaberto para esta loja.');
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
      const { codnf, statusQtd } = await gerarNfDoPedido(codpedcomp);
      form.setValue('dtfaturamento' as any, new Date().toISOString());
      mensagem.sucesso(`NF de entrada ${codnf} gerada (rascunho, ${statusQtd}). Confira o saldo/divergências abaixo e processe a NF (estoque/A Pagar) em Notas de Entrada.`);
      onRecebeu?.(codnf); // Wave 4 1:N: atualiza o painel de saldo + pré-preenche a conferência (fica no pedido)
    } catch (e) {
      mensagem.erro(e);
    } finally {
      setExecutando(false);
    }
  };

  // RECEBIMENTO corte-2/3: sucesso do import de XML (o modal cuida do parse/import/resolução de pendências).
  const onImportSucesso = (r: { codnf: number; divergencia: boolean; titulosApagar: number }) => {
    form.setValue('dtfaturamento' as any, new Date().toISOString());
    setMostrarImport(false);
    const tit = r.titulosApagar ? ` ${r.titulosApagar} título(s) A Pagar gerado(s) das duplicatas.` : '';
    mensagem.sucesso(
      `NF de entrada ${r.codnf} importada do XML${r.divergencia ? ' (atenção: total da NF diverge do vNF do XML — confira)' : ''}.${tit} Confira o saldo/divergências abaixo; processe o estoque (F3) em Notas de Entrada.`,
    );
    onRecebeu?.(r.codnf); // Wave 4 1:N: atualiza o painel + pré-preenche a conferência
  };

  return (
    <fieldset className="rounded-radius-md border border-border bg-bg-surface p-pad-md">
      <legend className="px-pad-xs text-body-sm font-semibold text-fg-default">Estado do pedido</legend>
      <div className="flex flex-wrap items-center gap-gp-sm">
        {est.participa && !est.lojaLogadaFechada && !recebido && <Button label="&Fechar pedido" variant="soft" onClick={() => void fechar()} />}
        {/* Wave 4 1:N: gerar/importar disponíveis enquanto FECHADO (o servidor barra quando o saldo zera —
            PEDIDO_TOTALMENTE_RECEBIDO); recebimento em VÁRIAS remessas. Reabrir só ANTES da 1ª remessa. */}
        {fechado && <Button label="&Gerar NF de entrada" variant="soft" onClick={() => void gerarNf()} />}
        {fechado && <Button label="&Importar XML da NFe" variant="soft" onClick={() => setMostrarImport(true)} />}
        {est.lojaLogadaFechada && !recebido && <Button label="&Reabrir pedido" variant="ghost" onClick={() => void reabrir()} />}
        <Button label="Atualizar &preços no catálogo" variant="ghost" onClick={() => void atualizarPrecos()} />
        <Button label="&Duplicar pedido" variant="ghost" onClick={() => void duplicar(false)} />
        <Button label="Gerar pedido &bonificado" variant="ghost" onClick={() => void duplicar(true)} />
        <small className="text-fg-muted">
          {recebido
            ? 'Recebimento em andamento (1:N): gere/importe mais NFs enquanto houver saldo; confira/libere no painel abaixo.'
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
