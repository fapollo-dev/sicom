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

/** resolve uma config (base + override por Empresa) com o handle de db do validar — espelha ConfigService.
 *  (o validar do agregado é um objeto declarativo, sem injeção — helper local documentado.) */
async function cfgValor(db: any, codigo: string, emp: number | null): Promise<string | null> {
  const c = await db
    .selectFrom('configuracoes')
    .select(['id', 'valor', 'config_especificas_permitidas'])
    .where('codigo', '=', codigo)
    .executeTakeFirst();
  if (!c) return null;
  const permitidos = String(c.config_especificas_permitidas ?? '').split(';').map((s: string) => s.trim());
  if (emp != null && permitidos.includes('Empresa')) {
    const ov = await db
      .selectFrom('configuracoes_especificas')
      .select('valor')
      .where('id', '=', c.id)
      .where('tipo', '=', 'Empresa')
      .where('chave', '=', String(emp))
      .executeTakeFirst();
    if (ov?.valor != null) return String(ov.valor);
  }
  return c.valor != null ? String(c.valor) : null;
}

const CD_COLS = ['cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'] as const;

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
    // corte-final: situação-NF (classificação; gerar-NF a carrega à NF de entrada). BONIFICACAO (header) e
    // OPERADOR_ULT_LIB_VALOR_MAX são server-controlled (gerar-bonificado / liberar-limite) — fora do allowlist.
    'idsituacao_nf',
    'pc_tipo_frete', 'pc_valor_frete', 'pc_nronf_cruzamento', 'obs',
  ],
  colunasPesquisa: ['codpedcomp', 'codparceiro', 'fornecedor', 'data', 'fechado', 'total'],
  detalhes: [
    {
      tabela: 'pedidocompra_i',
      pk: 'codpedcompi',
      fk: 'codpedcomp',
      chave: 'itens',
      colunas: [
        // FLIP do modelo (078): QTDE = nº de embalagens (comprador digita CAIXAS); FATOREMBALAGEM = fator (FATORCX).
        'idproduto', 'qtde', 'fatorembalagem', 'vrcusto', 'vlrembalagem', 'qtdtotal', 'totalcusto', 'desconto', 'descontop', 'obs',
        // corte precificação do item: markup→venda + margem líquida (L2) + custo líquido + PMZ (reuso do motor
        // /precificacao/produto; o comprador forma o preço). vrvenda (praticado) ≠ vrvendasug (sugerido pelo
        // motor). Nomes fiéis ao legado (MARGEML2/MARGEML2V). Analítica armazenada; sem propagação ao MULTI_PRECO.
        'vrcustoliquido', 'markup', 'vrvenda', 'vrvendasug', 'margeml2', 'margeml2v', 'pmz',
        // corte-final: % bonificado do item (100 no pedido-espelho gerado por gerar-bonificado).
        'bonificacao',
      ],
      // Derivação server-authoritative (078, uPedidoCompra.pas:1971-1972): VLREMBALAGEM = FATOREMBALAGEM×VRCUSTO
      // (custo por caixa); QTDTOTAL = QTDE×FATOREMBALAGEM (unidades); TOTALCUSTO = QTDE×VLREMBALAGEM (total da linha).
      // QTDE default 1 (behavior-preserving: TOTALCUSTO≡VLREMBALAGEM). O cliente não é fonte da verdade dos derivados.
      derivarItensTrx: async (itens) =>
        itens.map((it) => {
          const qtde = num(it.qtde) > 0 ? num(it.qtde) : 1;
          const vlrembalagem = r4(num(it.fatorembalagem) * num(it.vrcusto));
          return {
            ...it,
            qtde,
            vlrembalagem,
            qtdtotal: r4(qtde * num(it.fatorembalagem)),
            totalcusto: Math.round((qtde * vlrembalagem + Number.EPSILON) * 100) / 100,
          };
        }),
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
    // `_sistema`: geração PROGRAMÁTICA (ex.: GerarPedido da COTAÇÃO) insere o pedido DIRETO, sem os gates
    // INTERATIVOS do btnGravar (condição-obrigatória / prazo-máximo / pendências-fornecedor) — fiel ao legado,
    // que grava o pedido em lote fora do formulário. As travas de integridade (FRN, estado FECHADO/FATURADO) FICAM.
    const interativo = (dto as Record<string, unknown>)._sistema !== true;

    // travas de edição por estado (update). Pedido excluído (soft-delete INDR='E') é INEXISTENTE — não
    // se edita um documento morto. FATURADO (dtfaturamento, via NF de entrada = corte futuro) é read-only
    // — no golden 1.804 pedidos já foram faturados com FECHADO='N', então a trava é por dtfaturamento,
    // não só por FECHADO. FECHADO='S' é read-only (o fechar/reabrir é o vertical).
    let atual:
      | ({ fechado?: string; dtfaturamento?: unknown; codparceiro?: number; codconpagto?: number } & Record<string, unknown>)
      | undefined;
    if (id != null) {
      atual = (await db
        .selectFrom('pedidocompra')
        .select(['fechado', 'dtfaturamento', 'codparceiro', 'codconpagto', ...CD_COLS])
        .where('codpedcomp', '=', id)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .executeTakeFirst()) as typeof atual;
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

    // ── gates do btnGravar (corte-final; valores EFETIVOS = dto ?? linha atual) ──
    const efetivo = (campo: string): unknown => (dto[campo] !== undefined ? dto[campo] : atual?.[campo]);
    const cdsEfetivos = CD_COLS.map((c) => efetivo(c)).filter((v) => v != null && v !== '').map((v) => Number(v));
    const conpagtoEf = efetivo('codconpagto') != null ? Number(efetivo('codconpagto')) : null;
    const fornEf = cod ?? (atual?.codparceiro != null ? Number(atual.codparceiro) : null);

    // (1) OBRIGA_INFORMAR_CONDICOES_PAGAMENTO='S' (uPedidoCompra.pas:6831): exige condição (CD ou lookup).
    if (interativo && cdsEfetivos.length === 0 && conpagtoEf == null) {
      if ((await cfgValor(db, 'OBRIGA_INFORMAR_CONDICOES_PAGAMENTO', emp)) === 'S') {
        throw new BusinessRuleError('PEDIDO_SEM_CONDICAO_OBRIGATORIA');
      }
    }

    // (2) prazo máximo por fornecedor (PARCEIROS.QTDE_DIAS_MAXIMO_FP_PC; VerificaFP, uPedidoCompra.pas:6792):
    // nenhum CD do pedido (ou da condição, quando o pedido não sobrepõe) pode exceder o máximo do fornecedor.
    if (interativo && fornEf != null) {
      const fp = (await db
        .selectFrom('parceiros')
        .select('qtde_dias_maximo_fp_pc')
        .where('codparceiro', '=', fornEf)
        .where('idempresa', '=', emp)
        .executeTakeFirst()) as { qtde_dias_maximo_fp_pc?: number } | undefined;
      const max = fp?.qtde_dias_maximo_fp_pc != null ? Number(fp.qtde_dias_maximo_fp_pc) : 0;
      if (max > 0) {
        let cds = cdsEfetivos;
        if (cds.length === 0 && conpagtoEf != null) {
          const cond = (await db
            .selectFrom('condicoes_pagto')
            .select([...CD_COLS])
            .where('codconpagto', '=', conpagtoEf)
            .executeTakeFirst()) as Record<string, unknown> | undefined;
          if (cond) cds = CD_COLS.map((c) => cond[c]).filter((v) => v != null).map((v) => Number(v));
        }
        const estourado = cds.find((d) => d > max);
        if (estourado != null) throw new BusinessRuleError('PEDIDO_PRAZO_EXCEDE_FORNECEDOR', { prazo: estourado, maximo: max });
      }
    }

    // (3) pendências financeiras do fornecedor (AVISA_PENDENCIAS_FORNECEDOR='B' bloqueia; 'S' é aviso de UI):
    // A Receber NÃO QUITADO do fornecedor (VerificaPendencias, uPedidoCompra.pas:4255). Só ao DEFINIR (create)
    // ou TROCAR o fornecedor — M3: o legado só chama VerificaPendencias na seleção do fornecedor (:6516/6614),
    // não a cada gravar; um PUT de formulário completo reenvia o mesmo codparceiro e não deve re-travar.
    const trocouFornecedor = cod != null && (atual == null || cod !== Number(atual.codparceiro));
    if (interativo && trocouFornecedor && (await cfgValor(db, 'AVISA_PENDENCIAS_FORNECEDOR', emp)) === 'B') {
      const pend = await db
        .selectFrom('areceber')
        .select('codrcb')
        .where('codparceiro', '=', cod)
        .where('codempresa', '=', emp)
        .where('quitada', '=', 'N')
        .executeTakeFirst();
      if (pend) throw new BusinessRuleError('PEDIDO_FORNECEDOR_PENDENCIAS', { codparceiro: cod });
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
