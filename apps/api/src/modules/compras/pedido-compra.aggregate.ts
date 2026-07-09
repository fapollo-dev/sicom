import { sql } from 'kysely';
import { pedidoCompraSchema, atualizarPedidoCompraSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

/**
 * PEDIDO DE COMPRA (FRMPEDIDOCOMPRA) — a MAIOR tela do legado. Corte-1: NÚCLEO cadastro, agregado
 * mestre-detalhe via AggregateEngineService: master `pedidocompra` (empresaScoped) + detalhe
 * `pedidocompra_i` (itens). Documento de INTENÇÃO de compra (previsão). ARMAZENA cabeçalho + itens.
 *
 * **NÃO dispara efeito algum** (estoque/financeiro/fiscal): no legado o pedido é TRANSACIONAL PURO
 * (nenhum trigger no cabeçalho; o único trigger é auditoria no item). O FATO (fiscal definitivo,
 * movimento de estoque, títulos A Pagar) nasce na NF de ENTRADA que referencia o pedido — corte futuro.
 *
 * - `empresaScoped`: pedido por empresa (IDEMPRESA carimbado/filtrado pelo engine). O 1-para-N-lojas
 *   do legado (EMPRESAS CSV, COMPRA_1_PARA_N_LOJAS) é feature ADIADA.
 * - `derivarItensTrx` (por item): VLREMBALAGEM = FATOREMBALAGEM × VRCUSTO (custo estendido) — server-
 *   authoritative (não confia no cliente). Total do pedido = Σ VLREMBALAGEM (calculado na view; o
 *   cabeçalho NÃO persiste total — fiel ao legado).
 * - `derivarTrx` (master, só no create): CODOPERADOR = operador do contexto (o comprador que criou).
 * - `validar`: fornecedor tem de ser FRN='S'; pedido FECHADO não pode ser alterado (o fechar/reabrir
 *   é o vertical `PedidoCompraController`).
 * - `validarRemocao`: pedido FECHADO não pode ser excluído (reabra antes). Vínculo com NF de entrada
 *   ainda não existe no schema (NF.CODPEDCOMP não migrado) → guarda adiada.
 */

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000; // numeric(14,4)

export const pedidoCompraAggregateConfig: AggregateConfig = {
  tabela: 'pedidocompra',
  pk: 'codpedcomp',
  view: 'get_pedidocompra',
  rbacForm: 'FRMPEDIDOCOMPRA',
  empresaScoped: true,
  softDelete: true,
  // CODOPERADOR (server-set via derivarTrx) e FECHADO (state-controlled) NÃO entram nas colunas editáveis.
  colunas: [
    'codparceiro', 'data', 'dt_vencimento', 'codconpagto',
    // corte-2: DATA_FATURAMENTO = data-base do vencimento das parcelas (legado DTFATURAMENTO input, separado
    // do marcador "recebido" do recebimento). CD1..CD8 = override local dos prazos (dias) da condição.
    'data_faturamento', 'cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8',
    'pc_tipo_frete', 'pc_valor_frete', 'pc_nronf_cruzamento', 'obs',
  ],
  colunasPesquisa: ['codpedcomp', 'codparceiro', 'fornecedor', 'data', 'fechado', 'total'],
  detalhes: [
    {
      tabela: 'pedidocompra_i',
      pk: 'codpedcompi',
      fk: 'codpedcomp',
      chave: 'itens',
      colunas: ['idproduto', 'fatorembalagem', 'vrcusto', 'vlrembalagem', 'desconto', 'descontop', 'obs'],
      // VLREMBALAGEM = FATOREMBALAGEM × VRCUSTO — congelado server-side (o cliente não é fonte da verdade).
      derivarItensTrx: async (itens) =>
        itens.map((it) => ({ ...it, vlrembalagem: r4(num(it.fatorembalagem) * num(it.vrcusto)) })),
    },
    {
      // corte-2: PARCELAS (2º detalhe). Editáveis (o legado permite ajustar); geradas pelo `gerar-parcelas`
      // (RatearTotalNasParcelas). Substituídas no PUT só quando a chave `parcelas` vier no dto. idempresa
      // carimbada server-side (single-empresa = a do pedido; split multi-loja adiado).
      tabela: 'pedidocompra_parcelas',
      pk: 'codpedcompparcelas',
      fk: 'codpedcomp',
      chave: 'parcelas',
      colunas: ['idempresa', 'parcela', 'data', 'valor', 'qtdediasaposfaturamento'],
      derivarItensTrx: async (parcelas) =>
        parcelas.map((p) => ({ ...p, idempresa: currentTenant().empresaId ?? null })),
    },
  ],
  // CODOPERADOR = comprador (operador do contexto). Só no create (derivarTrx não roda no update) → imutável.
  derivarTrx: async () => ({ codoperador: currentTenant().operadorId ?? null }),
  // Regras cross-row do btnGravar (consultam o banco antes de gravar).
  validar: async ({ dto, id, db }) => {
    const emp = currentTenant().empresaId ?? null;

    // travas de edição por estado (update). Pedido excluído (soft-delete INDR='E') é INEXISTENTE — não
    // se edita um documento morto. FATURADO (dtfaturamento, via NF de entrada = corte futuro) é read-only
    // — no golden 1.804 pedidos já foram faturados com FECHADO='N', então a trava é por dtfaturamento,
    // não só por FECHADO. FECHADO='S' é read-only (o fechar/reabrir é o vertical).
    if (id != null) {
      const atual = (await db
        .selectFrom('pedidocompra')
        .select(['fechado', 'dtfaturamento'])
        .where('codpedcomp', '=', id)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .executeTakeFirst()) as { fechado?: string; dtfaturamento?: unknown } | undefined;
      if (!atual) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp: id });
      if (atual.dtfaturamento != null) throw new BusinessRuleError('PEDIDO_FATURADO');
      if (atual.fechado === 'S') throw new BusinessRuleError('PEDIDO_FECHADO');
    }

    // fornecedor tem de existir e ser fornecedor (FRN='S') — SegFornecedor do legado. O filtro por
    // idempresa segue o padrão do monorepo: PARCEIROS é empresaScoped aqui (parceiro.aggregate.ts) e o
    // Lote de Cobrança já valida o cobrador assim (lote-cobranca.repository.assertCobradorValido) —
    // divergência CONSCIENTE do legado (lá PARCEIROS é global), mas UNIFORME em todas as telas migradas.
    const cod = dto.codparceiro != null ? Number(dto.codparceiro) : null;
    if (cod != null) {
      const forn = (await db
        .selectFrom('parceiros')
        .select(['codparceiro', 'frn'])
        .where('codparceiro', '=', cod)
        .where('idempresa', '=', emp)
        .executeTakeFirst()) as { frn?: string } | undefined;
      if (!forn || forn.frn !== 'S') throw new BusinessRuleError('PEDIDO_FORNECEDOR_INVALIDO', { codparceiro: cod });
    }
  },
  // Guarda de EXCLUSÃO (btnExcluir): não apagar pedido com efeitos. FATURADO (dtfaturamento) e FECHADO='S'
  // são bloqueados (reabra/estorne antes). O vínculo com a NF de entrada (NF.CODPEDCOMP) ainda não existe
  // no schema migrado → a guarda de "pedido com NF" entra junto com o recebimento (corte futuro).
  validarRemocao: async ({ id, db }) => {
    const emp = currentTenant().empresaId ?? null;
    const pc = (await db
      .selectFrom('pedidocompra')
      .select(['fechado', 'dtfaturamento'])
      .where('codpedcomp', '=', id)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { fechado?: string; dtfaturamento?: unknown } | undefined;
    if (!pc) return; // já excluído / not-found → fluxo normal (soft-delete idempotente)
    if (pc.dtfaturamento != null) throw new BusinessRuleError('PEDIDO_FATURADO');
    if (pc.fechado === 'S') throw new BusinessRuleError('PEDIDO_FECHADO');
  },
};

export const PedidoCompraAggregateController = createAggregateController({
  path: 'compras/pedidos',
  config: pedidoCompraAggregateConfig,
  schema: pedidoCompraSchema,
  updateSchema: atualizarPedidoCompraSchema,
});
