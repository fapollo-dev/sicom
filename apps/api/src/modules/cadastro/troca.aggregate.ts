import { trocaSchema, atualizarTrocaSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

/**
 * TROCA DE MERCADORIA COM FORNECEDOR (FRMTROCAMERCADORIAFOR) — corte-1: NÚCLEO do documento (agregado mestre-detalhe
 * troca + itens_troca). Fornecedor deve realizar troca (parceiros.realiza_troca='S'); produto idem
 * (produtos.realizatroca='S') — fiel ao legado. Custo (vrcusto/vrcustorep) SNAPSHOT de MULTI_PRECO
 * (server-authoritative). A BAIXA de estoque é o passo `fechar` (troca.service) — decoplado como Scrap/Inventário.
 * validarRemocao trava excluir doc com item já FECHADO (baixa aplicada — estorne antes). empresaScoped; exclusão física.
 */

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

export const trocaAggregateConfig: AggregateConfig = {
  tabela: 'troca',
  pk: 'codtroca',
  view: 'get_troca',
  rbacForm: 'FRMTROCAMERCADORIAFOR',
  empresaScoped: true,
  softDelete: false, // exclusão física (fiel — sem INDR)
  colunas: ['codparceiro', 'data', 'descricao'],
  colunasPesquisa: ['codtroca', 'data', 'fornecedor', 'status', 'qtde_itens', 'valor_total'],
  detalhes: [
    {
      tabela: 'itens_troca',
      pk: 'coditenstroca',
      fk: 'codtroca',
      chave: 'itens',
      colunas: ['idempresa', 'idproduto', 'qtde', 'vrcusto', 'vrcustorep', 'estoqueretirada', 'fechado'],
      // custo SERVER-AUTHORITATIVE de MULTI_PRECO (o operador não digita custo). fechado='N' ao criar (a baixa é o `fechar`).
      derivarItensTrx: async (itens, trx, emp) => {
        const out: Record<string, unknown>[] = [];
        for (const it of itens) {
          const pid = Number(it.idproduto);
          const mp = (await trx.selectFrom('multi_preco').select(['vrcusto', 'vrcustorep']).where('idproduto', '=', pid).where('idempresa', '=', emp).executeTakeFirst()) as { vrcusto?: unknown; vrcustorep?: unknown } | undefined;
          out.push({
            ...it,
            idempresa: emp,
            idproduto: pid,
            qtde: num(it.qtde),
            vrcusto: num(mp?.vrcusto),
            vrcustorep: num(mp?.vrcustorep),
            estoqueretirada: it.estoqueretirada ?? 'LOJA',
            fechado: 'N',
          });
        }
        return out;
      },
    },
  ],
  derivarTrx: async () => ({ usucadastro: currentTenant().operadorId ?? null, usultalteracao: currentTenant().operadorId ?? null }),
  validar: async ({ dto, id, db }) => {
    // fold do padrão Scrap: editar (PUT) uma troca com item FECHADO (baixa aplicada) dessincronizaria a baixa → trava.
    if (id != null) {
      const temFechado = await db.selectFrom('itens_troca').select('coditenstroca').where('codtroca', '=', id).where('fechado', '=', 'S').executeTakeFirst();
      if (temFechado) throw new BusinessRuleError('TROCA_ITEM_FECHADO', { codtroca: id });
    }
    // fornecedor (do header) deve realizar troca.
    const cp = Number((dto as any).codparceiro);
    if (Number.isInteger(cp) && cp > 0) {
      const forn = (await db.selectFrom('parceiros').select(['codparceiro', 'realiza_troca']).where('codparceiro', '=', cp).executeTakeFirst()) as { realiza_troca?: string } | undefined;
      if (!forn) throw new BusinessRuleError('PARCEIRO_NAO_ENCONTRADO', { codparceiro: cp });
      if (String(forn.realiza_troca ?? 'N') !== 'S') throw new BusinessRuleError('FORNECEDOR_NAO_REALIZA_TROCA', { codparceiro: cp });
    }
    // itens: produto existe e realiza troca.
    const itens = Array.isArray((dto as any).itens) ? ((dto as any).itens as Array<Record<string, unknown>>) : null;
    if (itens && itens.length) {
      const ids = Array.from(new Set(itens.map((i) => Number(i.idproduto)).filter((n) => Number.isInteger(n) && n > 0)));
      if (ids.length) {
        const prods = (await db.selectFrom('produtos').select(['idproduto', 'realizatroca']).where('idproduto', 'in', ids).execute()) as Array<{ idproduto: number; realizatroca?: string }>;
        const map = new Map(prods.map((p) => [Number(p.idproduto), String(p.realizatroca ?? 'N')]));
        for (const idp of ids) {
          if (!map.has(idp)) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: idp });
          if (map.get(idp) !== 'S') throw new BusinessRuleError('PRODUTO_NAO_REALIZA_TROCA', { idproduto: idp });
        }
      }
    }
  },
  validarRemocao: async ({ id, db }) => {
    const fechado = await db.selectFrom('itens_troca').select('coditenstroca').where('codtroca', '=', id).where('fechado', '=', 'S').executeTakeFirst();
    if (fechado) throw new BusinessRuleError('TROCA_ITEM_FECHADO', { codtroca: id }); // reabrir/estornar antes
  },
};

export const TrocaAggregateController = createAggregateController({
  path: 'cadastro/troca',
  config: trocaAggregateConfig,
  schema: trocaSchema,
  updateSchema: atualizarTrocaSchema,
});
