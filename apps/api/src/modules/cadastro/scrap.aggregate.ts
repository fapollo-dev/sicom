import { scrapSchema, atualizarScrapSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

/**
 * SCRAP / PERDAS (FRMCADSCRAP — uCadSCRAP) — corte-1: NÚCLEO do documento (agregado mestre-detalhe `scrap` +
 * itens `scrap_item`). FIEL: o operador informa idproduto + qtde + motivo; o custo (vr_custo/vrcustorep) é SNAPSHOT
 * server-authoritative de MULTI_PRECO (igual ao Inventário — GetCustoProduto). Valor = qtde × vr_custo. A BAIXA de
 * estoque NÃO acontece aqui — é o passo `aplicar` (scrap.service), como o Inventário decopla a efetivação.
 * empresaScoped; exclusão FÍSICA (sem INDR). validarRemocao trava excluir doc já aplicado (mov_estoque='S') ou
 * faturado (importado='S').
 */

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

export const scrapAggregateConfig: AggregateConfig = {
  tabela: 'scrap',
  pk: 'codscrap',
  view: 'get_scrap',
  rbacForm: 'FRMCADSCRAP',
  empresaScoped: true,
  softDelete: false, // legado: exclusão física (hard delete + cascata de itens)
  colunas: ['dt_cadastro', 'codplc', 'codparceiro', 'idsituacao_nf', 'obs'],
  colunasPesquisa: ['codscrap', 'dt_cadastro', 'parceiro', 'qtde_itens', 'valor_total'],
  detalhes: [
    {
      tabela: 'scrap_item',
      pk: 'codscrapitem',
      fk: 'codscrap',
      chave: 'itens',
      colunas: ['idempresa', 'idproduto', 'idproduto_filho', 'qtde', 'vr_custo', 'vrcustorep', 'codmotivoop', 'codsetor', 'codfor', 'origem', 'motivo', 'origem_estoque', 'faturado', 'obs'],
      // SNAPSHOT server-authoritative do custo: o operador fornece produto/qtde/motivo; vr_custo/vrcustorep vêm de
      // MULTI_PRECO (por empresa) — fiel a SetaOutrasInformacoesItemScrap. origem/motivo/faturado = defaults do legado.
      derivarItensTrx: async (itens, trx, emp) => {
        const out: Record<string, unknown>[] = [];
        for (const it of itens) {
          const pid = Number(it.idproduto);
          const mp = (await trx
            .selectFrom('multi_preco')
            .select(['vrcusto', 'vrcustorep'])
            .where('idproduto', '=', pid)
            .where('idempresa', '=', emp)
            .executeTakeFirst()) as { vrcusto?: unknown; vrcustorep?: unknown } | undefined;
          out.push({
            ...it,
            idempresa: emp, // o engine não carimba idempresa no detalhe → deriva aqui
            idproduto: pid,
            qtde: num(it.qtde), // SIGNED (fiel ao golden)
            // custo SERVER-AUTHORITATIVE de MULTI_PRECO (o operador NÃO digita o custo — fold auditoria [MÉDIA]:
            // não confiar em vr_custo do cliente, senão o valor da perda seria forjável). Igual à carga do legado.
            vr_custo: num(mp?.vrcusto),
            vrcustorep: num(mp?.vrcustorep),
            codmotivoop: it.codmotivoop != null ? Number(it.codmotivoop) : null,
            codsetor: it.codsetor != null ? Number(it.codsetor) : null,
            codfor: it.codfor != null ? Number(it.codfor) : null,
            idproduto_filho: it.idproduto_filho != null ? Number(it.idproduto_filho) : null,
            origem: 'ESTOQUE',
            motivo: 'LIXO/PERDA',
            faturado: 'N',
            origem_estoque: it.origem_estoque ?? 'E', // default do golden (LOJA); single-bucket ignora o balde
            obs: it.obs ?? null,
          });
        }
        return out;
      },
    },
  ],
  derivarTrx: async () => ({ usucadastro: currentTenant().operadorId ?? null, usultalteracao: currentTenant().operadorId ?? null }),
  validar: async ({ dto, id, db }) => {
    // fold auditoria [ALTA]: editar (PUT) um scrap com baixa APLICADA (mov_estoque='S') ou já FATURADO
    // (importado='S') dessincronizaria a baixa do conjunto de itens (o estornar usa os itens ATUAIS). Trava aqui —
    // espelha o validarRemocao. (leitura fora da txn de escrita, como o validarRemocao; janela TOCTOU mínima.)
    if (id != null) {
      const s = (await db.selectFrom('scrap').select(['mov_estoque', 'importado']).where('codscrap', '=', id).executeTakeFirst()) as { mov_estoque?: string; importado?: string } | undefined;
      if (s?.mov_estoque === 'S') throw new BusinessRuleError('SCRAP_ESTOQUE_APLICADO', { codscrap: id });
      if (s?.importado === 'S') throw new BusinessRuleError('SCRAP_JA_FATURADO', { codscrap: id });
    }
    const itens = Array.isArray(dto.itens) ? (dto.itens as Array<Record<string, unknown>>) : null;
    if (!itens || !itens.length) return;
    // produto de cada item tem de existir (erro claro em vez de 23503 cru).
    const ids = Array.from(new Set(itens.map((i) => Number(i.idproduto)).filter((n) => Number.isInteger(n) && n > 0)));
    if (ids.length) {
      const existentes = new Set(
        ((await db.selectFrom('produtos').select('idproduto').where('idproduto', 'in', ids).execute()) as Array<{ idproduto: number }>).map((r) => Number(r.idproduto)),
      );
      for (const id of ids) if (!existentes.has(id)) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: id });
    }
    // motivo (quando informado, >0) tem de existir e ser de PERDA — tolera null/0 (fiel ao golden: 31k linhas sem motivo).
    const motivos = Array.from(new Set(itens.map((i) => Number(i.codmotivoop)).filter((n) => Number.isInteger(n) && n > 0)));
    if (motivos.length) {
      const validos = new Set(
        ((await db.selectFrom('motivos_operacao').select('codmotivoop').where('codmotivoop', 'in', motivos).where('tipo_operacao', '=', 'PERDA').execute()) as Array<{ codmotivoop: number }>).map((r) => Number(r.codmotivoop)),
      );
      for (const m of motivos) if (!validos.has(m)) throw new BusinessRuleError('MOTIVO_NAO_ENCONTRADO', { codmotivoop: m });
    }
  },
  validarRemocao: async ({ id, db }) => {
    const s = (await db.selectFrom('scrap').select(['mov_estoque', 'importado']).where('codscrap', '=', id).executeTakeFirst()) as { mov_estoque?: string; importado?: string } | undefined;
    if (s?.mov_estoque === 'S') throw new BusinessRuleError('SCRAP_ESTOQUE_APLICADO', { codscrap: id }); // estornar antes
    if (s?.importado === 'S') throw new BusinessRuleError('SCRAP_JA_FATURADO', { codscrap: id });
  },
};

export const ScrapAggregateController = createAggregateController({
  path: 'cadastro/scrap',
  config: scrapAggregateConfig,
  schema: scrapSchema,
  updateSchema: atualizarScrapSchema,
});
