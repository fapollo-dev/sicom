import { sql } from 'kysely';
import { devolucaoCompraSchema, atualizarDevolucaoCompraSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

/**
 * DEVOLUÇÃO DE COMPRA (FRMDEVOLUCAOCOMPRA) — corte-1: NÚCLEO do documento (agregado mestre-detalhe:
 * PEDIDO_DEVOLUCAO_COMPRA + itens). Documento de devolução ao FORNECEDOR que PARTE da NF de ENTRADA
 * original — cada item referencia (codnf, codnfprod) da entrada. TRANSACIONAL PURO: 0 efeitos (o FATO
 * nasce na NF de saída finalidade=4 que o "Gerar NF de Devolução" emite — cortes 2/3).
 *
 * - `empresaScoped` (IDEMPRESA carimbado/filtrado pelo engine); soft-delete INDR.
 * - `derivarItensTrx`: TOTAL_PRODUTO_DEVOLVIDO = VALOR_CUSTO × QTD_DEVOLVIDA (server-authoritative).
 * - `derivarTrx` (create): CODOPERADOR = operador do contexto.
 * - `validar`: fornecedor FRN='S'; edição só em EM_DIGITACAO; SALDO por item (qtd_devolvida ≤ qtd da entrada
 *   − Σ já devolvido em outros pedidos não-cancelados) — parcial é a norma; a NF de origem tem de ser
 *   ENTRADA do próprio fornecedor; o CFOP de origem tem de ter CFOP_DEVOLUCAO configurado.
 * - `validarRemocao`: só exclui em EM_DIGITACAO (documento com NF emitida/finalizado é read-only).
 */

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000; // fold B2: qtd é numeric(13,3)

export const devolucaoCompraAggregateConfig: AggregateConfig = {
  tabela: 'pedido_devolucao_compra',
  pk: 'codpeddevcompra',
  view: 'get_pedido_devolucao_compra',
  rbacForm: 'FRMDEVOLUCAOCOMPRA',
  empresaScoped: true,
  softDelete: true,
  // STATUS (state-controlled: finalizar/reabrir/cancelar), CODNF_EMITIDA (gerar-NF) e CODOPERADOR (derivarTrx)
  // NÃO entram nas colunas editáveis.
  colunas: ['codparceiro', 'data', 'produto_troca', 'obs'],
  colunasPesquisa: ['codpeddevcompra', 'codparceiro', 'fornecedor', 'data', 'status', 'total'],
  detalhes: [
    {
      tabela: 'pedido_devolucao_compra_i',
      pk: 'codpeddevcomprai',
      fk: 'codpeddevcompra',
      chave: 'itens',
      colunas: [
        'codnf', 'codnfprod', 'idproduto', 'nroitem', 'unidade', 'fatorembalagem', 'cfop',
        'qtd_nota_fiscal', 'qtd_devolvida', 'valor_custo', 'total_produto_nota', 'total_produto_devolvido', 'obs',
      ],
      // fold M1: SNAPSHOT AUTORITATIVO do servidor — idproduto/valor_custo/qtd_nota_fiscal/cfop vêm da NF de
      // ENTRADA (nf_prod + de-para CFOP), NÃO do cliente (que só escolhe qtd_devolvida). Custo = vrcusto da
      // entrada (premissa fatorembal=1 do recebimento novo → vrcusto já é por unidade efetiva; ver dossiê).
      // Roda DENTRO da transação (a trx é passada ao derivarItensTrx). O `validar` já garantiu que a origem
      // existe/é do fornecedor/tem CFOP_DEVOLUCAO; aqui só materializamos os valores.
      derivarItensTrx: async (itens, trx, emp) => {
        const out: Record<string, unknown>[] = [];
        for (const it of itens) {
          const orig = (await trx
            .selectFrom('nf_prod as p')
            .innerJoin('nf as n', 'n.codnf', 'p.codnf')
            .leftJoin('cfop as c', 'c.codcfop', 'p.cfop')
            .select([
              'p.codproduto as idproduto',
              'p.vrcusto as vrcusto',
              'p.unidade as unidade',
              sql<number>`coalesce(p.quantidade,0) * coalesce(p.fatorembal,1)`.as('qtd'),
              'c.cfop_devolucao as cfop_dev',
            ])
            .where('p.codnfprod', '=', Number(it.codnfprod))
            .where('p.codnf', '=', Number(it.codnf))
            .where('n.idempresa', '=', emp)
            .executeTakeFirst()) as { idproduto?: number; vrcusto?: unknown; unidade?: string; qtd?: unknown; cfop_dev?: string | null } | undefined;
          const custo = num(orig?.vrcusto);
          const qtdEnt = num(orig?.qtd);
          const qtdDev = num(it.qtd_devolvida);
          out.push({
            ...it,
            idproduto: orig?.idproduto ?? it.idproduto,
            unidade: orig?.unidade ?? it.unidade,
            fatorembalagem: 1, // recebimento novo grava fatorembal=1; a qtd efetiva já está em qtd_nota_fiscal
            cfop: orig?.cfop_dev ?? it.cfop,
            valor_custo: custo,
            qtd_nota_fiscal: qtdEnt,
            total_produto_nota: r2(custo * qtdEnt),
            total_produto_devolvido: r2(custo * qtdDev),
          });
        }
        return out;
      },
    },
  ],
  // CODOPERADOR = operador do contexto (só no create — derivarTrx não roda no update).
  derivarTrx: async () => ({ codoperador: currentTenant().operadorId ?? null }),
  validar: async ({ dto, id, db }) => {
    const emp = currentTenant().empresaId ?? null;

    // trava de edição por estado: documento só é editável em EM_DIGITACAO (com NF emitida/finalizado/cancelado
    // é read-only). Soft-delete (INDR='E') é inexistente.
    if (id != null) {
      const atual = (await db
        .selectFrom('pedido_devolucao_compra')
        .select(['status'])
        .where('codpeddevcompra', '=', id)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .executeTakeFirst()) as { status?: string } | undefined;
      if (!atual) throw new BusinessRuleError('DEVOLUCAO_NAO_ENCONTRADA', { codpeddevcompra: id });
      if (atual.status !== 'EM_DIGITACAO') throw new BusinessRuleError('DEVOLUCAO_NAO_EDITAVEL', { status: atual.status });
    }

    // fornecedor tem de existir e ser fornecedor (FRN='S') — mesmo padrão do pedido de compra.
    const cod = dto.codparceiro != null ? Number(dto.codparceiro) : null;
    if (cod != null) {
      const forn = (await db
        .selectFrom('parceiros')
        .select(['frn'])
        .where('codparceiro', '=', cod)
        .where('idempresa', '=', emp)
        .executeTakeFirst()) as { frn?: string } | undefined;
      if (!forn || forn.frn !== 'S') throw new BusinessRuleError('DEVOLUCAO_FORNECEDOR_INVALIDO', { codparceiro: cod });
    }

    // ── SALDO por item de ORIGEM (só valida se os itens vierem no dto) ──
    const itens = Array.isArray(dto.itens) ? (dto.itens as Array<Record<string, unknown>>) : null;
    if (itens && itens.length) {
      // agrega o que ESTE dto quer devolver por (codnf, codnfprod).
      const porOrigem = new Map<string, { codnf: number; codnfprod: number; soma: number }>();
      for (const it of itens) {
        const codnf = Number(it.codnf);
        const codnfprod = Number(it.codnfprod);
        const q = num(it.qtd_devolvida);
        const k = `${codnf}:${codnfprod}`;
        const cur = porOrigem.get(k) ?? { codnf, codnfprod, soma: 0 };
        cur.soma += q;
        porOrigem.set(k, cur);
      }

      for (const { codnf, codnfprod, soma } of porOrigem.values()) {
        // item da NF de ENTRADA: qtd efetiva (quantidade × fatorembal) + CFOP de origem, exigindo tipo='E' e
        // que a NF seja do MESMO fornecedor e empresa (não devolver item de outro fornecedor).
        const orig = (await db
          .selectFrom('nf_prod as p')
          .innerJoin('nf as n', 'n.codnf', 'p.codnf')
          .select([
            sql<number>`coalesce(p.quantidade,0) * coalesce(p.fatorembal,1)`.as('qtd'),
            'p.cfop as cfop',
            'n.tipo as tipo',
            'n.codparceiro as codparceiro',
          ])
          .where('p.codnfprod', '=', codnfprod)
          .where('p.codnf', '=', codnf)
          .where('n.idempresa', '=', emp)
          .executeTakeFirst()) as { qtd?: unknown; cfop?: string; tipo?: string; codparceiro?: number } | undefined;
        if (!orig || orig.tipo !== 'E') throw new BusinessRuleError('DEVOLUCAO_ITEM_INVALIDO', { codnf, codnfprod });
        if (cod != null && Number(orig.codparceiro) !== cod) {
          throw new BusinessRuleError('DEVOLUCAO_ITEM_OUTRO_FORNECEDOR', { codnf, codnfprod });
        }

        // fold M4: CFOP de origem VAZIO → aborta (o legado exige "reimporte a nota"; :1006). Senão, tem de ter
        // CFOP_DEVOLUCAO configurado (o legado aborta a geração da NF sem o de-para).
        if (!orig.cfop) throw new BusinessRuleError('DEVOLUCAO_CFOP_ORIGEM_AUSENTE', { codnf, codnfprod });
        const c = (await db
          .selectFrom('cfop')
          .select(['cfop_devolucao'])
          .where('codcfop', '=', orig.cfop)
          .executeTakeFirst()) as { cfop_devolucao?: string | null } | undefined;
        if (!c?.cfop_devolucao) throw new BusinessRuleError('DEVOLUCAO_CFOP_NAO_CONFIGURADO', { cfop: orig.cfop });

        // Σ já devolvido em OUTROS pedidos não-cancelados (exclui este pedido no update).
        let q = db
          .selectFrom('pedido_devolucao_compra_i as i')
          .innerJoin('pedido_devolucao_compra as d', 'd.codpeddevcompra', 'i.codpeddevcompra')
          .select(({ fn }: any) => [fn.sum('i.qtd_devolvida').as('s')])
          .where('i.codnf', '=', codnf)
          .where('i.codnfprod', '=', codnfprod)
          .where('d.idempresa', '=', emp)
          .where('d.status', '<>', 'CANCELADO')
          .where(sql`coalesce(d.indr,'I')`, '<>', 'E');
        if (id != null) q = q.where('d.codpeddevcompra', '<>', id);
        const ja = num(((await q.executeTakeFirst()) as { s?: unknown } | undefined)?.s);

        const saldo = r3(num(orig.qtd) - ja); // fold B2: 3 casas (escala da coluna) — sem folga de arredondamento
        if (r3(soma) > saldo) {
          throw new BusinessRuleError('DEVOLUCAO_QTDE_EXCEDE', { codnf, codnfprod, saldo, solicitado: r3(soma) });
        }
      }
    }
  },
  validarRemocao: async ({ id, db }) => {
    const emp = currentTenant().empresaId ?? null;
    const d = (await db
      .selectFrom('pedido_devolucao_compra')
      .select(['status'])
      .where('codpeddevcompra', '=', id)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { status?: string } | undefined;
    if (!d) return; // já excluído / not-found → soft-delete idempotente
    if (d.status !== 'EM_DIGITACAO') throw new BusinessRuleError('DEVOLUCAO_NAO_EDITAVEL', { status: d.status });
  },
};

export const DevolucaoCompraAggregateController = createAggregateController({
  path: 'compras/devolucao-compra',
  config: devolucaoCompraAggregateConfig,
  schema: devolucaoCompraSchema,
  updateSchema: atualizarDevolucaoCompraSchema,
});
