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
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const nul = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

/** mig 308 — os tributos do item da devolução: o destacado na nota do fornecedor (`*_nota`) e a parte devolvida. */
export const COLUNAS_FISCAIS_DEVOLUCAO = [
  'descricao_produto', 'cst', 'icms_aliquota', 'icms_bc', 'icms_bc_nota', 'icms_valor', 'icms_nota', 'icms_reducao_bc',
  'icms_st_aliquota', 'icms_st_bc', 'icms_st_bc_nota', 'icms_st_valor', 'icms_st_nota', 'icms_st_reducao_bc',
  'ipi', 'ipi_nota', 'frete', 'frete_nota', 'seguro', 'seguro_nota', 'desconto', 'desconto_nota',
  'outras_despesas', 'outras_despesas_nota', 'aliqpise', 'aliqcofinse', 'bcpiscofinse', 'bcpiscofinse_nota',
  'vrpise', 'vrpise_nota', 'vrcofinse', 'vrcofinse_nota', 'arredonda',
  'fcp_bc_st', 'fcp_bc_st_nota', 'fcp_aliquota_st', 'fcp_aliquota_st_nota', 'fcp_valor_st', 'fcp_valor_st_nota',
  'fcp_bc_st_ret', 'fcp_bc_st_ret_nota', 'fcp_aliquota_st_ret', 'fcp_aliquota_st_ret_nota', 'fcp_valor_st_ret', 'fcp_valor_st_ret_nota',
] as const;

export const devolucaoCompraAggregateConfig: AggregateConfig = {
  tabela: 'pedido_devolucao_compra',
  pk: 'codpeddevcompra',
  view: 'get_pedido_devolucao_compra',
  rbacForm: 'FRMCADPEDIDODEVOLUCAOCOMPRAS',
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
        // mig 308: os tributos DA NOTA (o que o fornecedor destacou) e a parte devolvida — calculados no servidor
        ...COLUNAS_FISCAIS_DEVOLUCAO,
      ],
      // o que a carga trouxe e o documento não recalcula (troca de origem…) sobrevive ao save (lição 124)
      chaveNatural: ['codnfprod'],
      preservarNaoGerenciadas: true,
      // SNAPSHOT AUTORITATIVO do servidor (fold M1): tudo vem do item da NF de ENTRADA; o cliente só escolhe a
      // quantidade. mig 308 — como o legado (uCadPedidoDevolucaoCompras.pas:1021-1120): os valores DESTACADOS na nota
      // do fornecedor (`*_NOTA`), a parte devolvida = valor da nota × (devolvido ÷ quantidade da nota), arredondada a 2
      // casas item a item; CST e alíquota da nota; o valor do produto pela nota (`TOTAL_PRODUTO_NOTA`); e a regra do
      // fornecedor que zera ICMS/ST (`ParceiroZeraImpostosDeICMSSt`) pelo CFOP ORIGINAL da nota.
      derivarItensTrx: async (itens, trx, emp) => {
        const out: Record<string, unknown>[] = [];
        let zera: boolean | null = null;
        for (const it of itens) {
          const orig = (await trx
            .selectFrom('nf_prod as p')
            .innerJoin('nf as n', 'n.codnf', 'p.codnf')
            .leftJoin('cfop as c', (j: any) => j.on(sql`c.codcfop = coalesce(p.cfop_original::text, p.cfop)`))
            .select([
              'p.codproduto as idproduto', 'p.vrcusto as vrcusto', 'p.unidade as unidade', 'p.descricao as descricao',
              sql<number>`coalesce(p.quantidade,0) * coalesce(p.fatorembal,1)`.as('qtd'),
              'c.cfop_devolucao as cfop_dev', sql<string>`coalesce(p.cfop_original::text, p.cfop)`.as('cfop_origem'),
              'p.cst_nota', 'p.cst', 'p.icms_aliq_nota', 'p.icms_nota_bc', 'p.icms_nota_valor', 'p.icms_red_bc_nota',
              'p.icms_st_aliq_nota', 'p.vrbasest', 'p.vricmst', 'p.icms_st_red_bc_nota',
              'p.ipi_nota', 'p.frete_nota', 'p.seguro_nota', 'p.desconto_nota', 'p.outras_despesas_nota', 'p.total_produto_nota',
              'p.bcpiscofinse', 'p.aliqpise', 'p.aliqcofinse', 'p.vrpise', 'p.vrcofinse', 'p.arredonda',
              'p.fcp_bc_st', 'p.fcp_aliquota_st', 'p.fcp_valor_st', 'p.fcp_bc_st_ret', 'p.fcp_aliquota_st_ret', 'p.fcp_valor_st_ret',
              'n.codparceiro as codparceiro',
            ])
            .where('p.codnfprod', '=', Number(it.codnfprod))
            .where('p.codnf', '=', Number(it.codnf))
            .where('n.idempresa', '=', emp)
            .executeTakeFirst()) as Record<string, unknown> | undefined;
          const o = orig ?? {};
          const qtdEnt = num(o.qtd);
          const qtdDev = num(it.qtd_devolvida);
          const f = qtdEnt > 0 ? qtdDev / qtdEnt : 0;
          const parte = (v: unknown) => r2(num(v) * f); // RoundTo((X_NOTA / QtdNota) * QtdADevolver, -2)
          // o valor do produto é o DA NOTA (`TOTAL_PRODUTO_NOTA`; zerado → quantidade × custo, como o legado)
          const totalNota = num(o.total_produto_nota) > 0 ? num(o.total_produto_nota) : r2(num(o.vrcusto) * qtdEnt);
          const custo = qtdEnt > 0 ? totalNota / qtdEnt : num(o.vrcusto);
          const item: Record<string, unknown> = {
            ...it,
            idproduto: o.idproduto ?? it.idproduto,
            unidade: (o.unidade as string) ?? it.unidade,
            descricao_produto: (o.descricao as string) ?? null,
            fatorembalagem: 1, // recebimento novo grava fatorembal=1; a qtd efetiva já está em qtd_nota_fiscal
            cfop: (o.cfop_dev as string) ?? it.cfop,
            valor_custo: r4(custo),
            qtd_nota_fiscal: qtdEnt,
            total_produto_nota: r2(totalNota),
            total_produto_devolvido: r2(custo * qtdDev),
            cst: o.cst_nota != null ? Number(o.cst_nota) : o.cst != null ? Number(o.cst) : null,
            icms_aliquota: nul(o.icms_aliq_nota),
            icms_bc_nota: nul(o.icms_nota_bc), icms_nota: nul(o.icms_nota_valor),
            icms_bc: parte(o.icms_nota_bc), icms_valor: parte(o.icms_nota_valor), icms_reducao_bc: nul(o.icms_red_bc_nota),
            icms_st_aliquota: nul(o.icms_st_aliq_nota),
            icms_st_bc_nota: nul(o.vrbasest), icms_st_nota: nul(o.vricmst),
            icms_st_bc: parte(o.vrbasest), icms_st_valor: parte(o.vricmst), icms_st_reducao_bc: nul(o.icms_st_red_bc_nota),
            ipi_nota: nul(o.ipi_nota), ipi: parte(o.ipi_nota),
            frete_nota: nul(o.frete_nota), frete: parte(o.frete_nota),
            seguro_nota: nul(o.seguro_nota), seguro: parte(o.seguro_nota),
            desconto_nota: nul(o.desconto_nota), desconto: parte(o.desconto_nota),
            outras_despesas_nota: nul(o.outras_despesas_nota), outras_despesas: parte(o.outras_despesas_nota),
            aliqpise: nul(o.aliqpise), aliqcofinse: nul(o.aliqcofinse),
            bcpiscofinse_nota: nul(o.bcpiscofinse), vrpise_nota: nul(o.vrpise), vrcofinse_nota: nul(o.vrcofinse),
            bcpiscofinse: parte(o.bcpiscofinse), vrpise: parte(o.vrpise), vrcofinse: parte(o.vrcofinse),
            arredonda: (o.arredonda as string) ?? null,
            // FCP-ST: valor e base proporcionais; a ALÍQUOTA fica inteira — o legado a rateia também
            // (`FCP_ALIQUOTA_ST := RoundTo((FCP_ALIQUOTA_ST/QtdNota)*QtdADevolver)`), defeito não copiado
            fcp_bc_st_nota: nul(o.fcp_bc_st), fcp_bc_st: parte(o.fcp_bc_st),
            fcp_aliquota_st_nota: nul(o.fcp_aliquota_st), fcp_aliquota_st: nul(o.fcp_aliquota_st),
            fcp_valor_st_nota: nul(o.fcp_valor_st), fcp_valor_st: parte(o.fcp_valor_st),
            fcp_bc_st_ret_nota: nul(o.fcp_bc_st_ret), fcp_bc_st_ret: parte(o.fcp_bc_st_ret),
            fcp_aliquota_st_ret_nota: nul(o.fcp_aliquota_st_ret), fcp_aliquota_st_ret: nul(o.fcp_aliquota_st_ret),
            fcp_valor_st_ret_nota: nul(o.fcp_valor_st_ret), fcp_valor_st_ret: parte(o.fcp_valor_st_ret),
          };
          // ParceiroZeraImpostosDeICMSSt (:1039-1080), pelo CFOP ORIGINAL da nota (dígitos 2-4)
          if (zera == null) {
            const pz = (await trx.selectFrom('parceiros').select('devolucao_zera_imposto_icmsst')
              .where('codparceiro', '=', Number(o.codparceiro ?? 0)).executeTakeFirst()) as { devolucao_zera_imposto_icmsst?: string } | undefined;
            zera = String(pz?.devolucao_zera_imposto_icmsst ?? 'N') === 'S';
          }
          if (zera) {
            const d3 = String(o.cfop_origem ?? '').slice(1, 4);
            const zeraSt = () => Object.assign(item, { icms_st_aliquota: 0, icms_st_bc: 0, icms_st_reducao_bc: 0, icms_st_valor: 0 });
            if (d3 === '401' || d3 === '403' || d3 === '405') {
              Object.assign(item, { icms_aliquota: 0, icms_bc: 0, icms_reducao_bc: 0, icms_valor: 0, cst: 60 });
              zeraSt();
            } else if (d3 === '101' || d3 === '102') {
              zeraSt();
              const red = num(o.icms_red_bc_nota);
              item.cst = red === 100 || red === 0 ? 0 : 20;
            }
          }
          out.push(item);
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
