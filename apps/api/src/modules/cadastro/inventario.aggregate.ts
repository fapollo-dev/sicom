import { sql } from 'kysely';
import { inventarioLivroSchema, atualizarInventarioLivroSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

/**
 * INVENTÁRIO (FRMINVENTARIO — uInventario) — corte-1: NÚCLEO do documento (agregado mestre-detalhe:
 * `inventario_livro` + itens `inventario`). FIEL ao legado: PLANILHA sem máquina de estado (o documento é sempre
 * editável; a efetivação é rerodável). O operador informa idproduto + qtde CONTADA; os campos de snapshot
 * (descricao/unidade/codbarra/vrcusto/vrvenda) são materializados pelo servidor (produtos + multi_preco) —
 * server-authoritative. empresaScoped; soft-delete INDR. A diferença e o "aplicar ao estoque" são verticais
 * (inventario.service). Sem efeitos aqui (o efeito é o `aplicar`).
 */

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

export const inventarioAggregateConfig: AggregateConfig = {
  tabela: 'inventario_livro',
  pk: 'codinvent',
  view: 'get_inventario_livro',
  rbacForm: 'FRMINVENTARIO',
  empresaScoped: true,
  softDelete: true,
  colunas: ['descricao', 'dtinventario', 'dtinicial', 'tipoinventario', 'modeloinventario', 'produtos_ativos', 'apenas_estoque'],
  colunasPesquisa: ['codinvent', 'descricao', 'dtinventario', 'qtde_itens'],
  detalhes: [
    {
      tabela: 'inventario',
      pk: 'sequencia',
      fk: 'codinvent',
      chave: 'itens',
      colunas: ['idempresa', 'idproduto', 'codbarra', 'descricao', 'unidade', 'codsubgrupo', 'aliquota', 'qtde', 'vrcusto', 'vrvenda', 'tipo'],
      // SNAPSHOT server-authoritative: o operador só fornece idproduto + qtde (contado); descricao/unidade/codbarra
      // vêm de PRODUTOS e vrcusto/vrvenda de MULTI_PRECO (por empresa) — fiel à carga do legado (GetCustoProduto).
      derivarItensTrx: async (itens, trx, emp) => {
        const out: Record<string, unknown>[] = [];
        for (const it of itens) {
          const pid = Number(it.idproduto);
          const prod = (await trx
            .selectFrom('produtos')
            .select(['descricao', 'unidade', 'codbarra', 'aliquota'])
            .where('idproduto', '=', pid)
            .executeTakeFirst()) as { descricao?: string; unidade?: string; codbarra?: string; aliquota?: string } | undefined;
          const mp = (await trx
            .selectFrom('multi_preco')
            .select(['vrcusto', 'vrvenda'])
            .where('idproduto', '=', pid)
            .where('idempresa', '=', emp)
            .executeTakeFirst()) as { vrcusto?: unknown; vrvenda?: unknown } | undefined;
          out.push({
            ...it,
            idempresa: emp, // o engine não carimba idempresa no detalhe → deriva aqui (tabela tem NOT NULL)
            descricao: prod?.descricao ?? it.descricao ?? null,
            unidade: prod?.unidade ?? it.unidade ?? null,
            codbarra: prod?.codbarra ?? it.codbarra ?? null,
            aliquota: prod?.aliquota ?? it.aliquota ?? null,
            vrcusto: it.vrcusto != null ? num(it.vrcusto) : num(mp?.vrcusto),
            vrvenda: it.vrvenda != null ? num(it.vrvenda) : num(mp?.vrvenda),
            tipo: it.tipo ?? 'P',
            qtde: num(it.qtde),
          });
        }
        return out;
      },
    },
  ],
  derivarTrx: async () => ({ usucadastro: currentTenant().operadorId ?? null, usultalteracao: currentTenant().operadorId ?? null }),
  validar: async ({ dto, db }) => {
    // itens: cada produto tem de existir (erro claro em vez de 23503 cru). Sem trava de estado (fiel — planilha).
    const itens = Array.isArray(dto.itens) ? (dto.itens as Array<Record<string, unknown>>) : null;
    if (itens && itens.length) {
      const ids = Array.from(new Set(itens.map((i) => Number(i.idproduto)).filter((n) => Number.isInteger(n) && n > 0)));
      if (ids.length) {
        const existentes = new Set(
          ((await db.selectFrom('produtos').select('idproduto').where('idproduto', 'in', ids).execute()) as Array<{ idproduto: number }>).map((r) => Number(r.idproduto)),
        );
        for (const id of ids) if (!existentes.has(id)) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: id });
      }
    }
  },
};

export const InventarioAggregateController = createAggregateController({
  path: 'cadastro/inventario',
  config: inventarioAggregateConfig,
  schema: inventarioLivroSchema,
  updateSchema: atualizarInventarioLivroSchema,
});
