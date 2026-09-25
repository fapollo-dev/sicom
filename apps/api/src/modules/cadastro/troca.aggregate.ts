import { trocaSchema, atualizarTrocaSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { movimentoDaTroca, type ItemTroca } from './troca-estoque';

/**
 * TROCA DE MERCADORIA COM FORNECEDOR (FRMTROCAMERCADORIAFOR) — corte-1: NÚCLEO do documento (agregado mestre-detalhe
 * troca + itens_troca). Fornecedor deve realizar troca (parceiros.realiza_troca='S'); produto idem
 * (produtos.realizatroca='S') — fiel ao legado. Custo (vrcusto/vrcustorep) SNAPSHOT de MULTI_PRECO
 * (server-authoritative). O ESTOQUE segue o gatilho `ESTOQUE_TROCA` do legado (troca-estoque.ts): a mercadoria sai quando o item entra
 * na troca e fica em QTDETROCA; alterar a quantidade ou o lugar estorna e retira de novo; excluir o item (ou a troca) estorna. O
 * `fechar` só tira do QTDETROCA. validarRemocao trava excluir doc com item já FECHADO. empresaScoped; exclusão física.
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
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'Troca de mercadorias do fornecedor' },
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
      chaveNatural: ['idproduto'],
      // idem: codscrap, o vínculo com o scrap gerado (lição 124)
      preservarNaoGerenciadas: true,
      colunas: ['idempresa', 'idproduto', 'qtde', 'vrcusto', 'vrcustorep', 'estoqueretirada', 'fechado'],
      // os itens como estavam (o gatilho ESTOQUE_TROCA compara o :OLD com o :NEW)
      antesDeSubstituirTrx: async ({ trx, masterId }) =>
        trx.selectFrom('itens_troca').select(['coditenstroca', 'idproduto', 'qtde', 'vrcusto', 'estoqueretirada', 'fechado', 'origem_fechamento', 'codscrap'])
          .where('codtroca', '=', masterId).orderBy('coditenstroca').execute(),
      // custo SERVER-AUTHORITATIVE de MULTI_PRECO (o operador não digita custo). FECHADO: o que o item já tinha ('N' no item novo — fechar é o passo próprio)
      derivarItensTrx: async (itens, trx, emp, _h, _m, snapshot) => {
        const fila = new Map<number, Array<Record<string, unknown>>>();
        for (const a of (snapshot as Array<Record<string, unknown>> | undefined) ?? []) fila.set(Number(a.idproduto), [...(fila.get(Number(a.idproduto)) ?? []), a]);
        const out: Record<string, unknown>[] = [];
        for (const it of itens) {
          const antiga = fila.get(Number(it.idproduto))?.shift();
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
            fechado: antiga ? (antiga.fechado ?? 'N') : 'N',
          });
        }
        return out;
      },
      // o movimento de estoque de cada item (o gatilho ESTOQUE_TROCA): casado pelo produto na ordem, o item novo retira, o que saiu
      // estorna, o alterado estorna e retira
      aposInserirItensTrx: async ({ trx, itens, snapshot, masterId }) => {
        const t = (await trx.selectFrom('troca').select(['idempresa', 'dtcadastro']).where('codtroca', '=', masterId).executeTakeFirst()) as { idempresa: number; dtcadastro: unknown } | undefined;
        if (!t) return;
        const c = { emp: Number(t.idempresa), codtroca: Number(masterId), dtcadastro: t.dtcadastro, op: currentTenant().operadorId ?? null };
        const fila = new Map<number, ItemTroca[]>();
        for (const a of (snapshot as ItemTroca[] | undefined) ?? []) fila.set(Number(a.idproduto), [...(fila.get(Number(a.idproduto)) ?? []), a]);
        for (const it of itens) await movimentoDaTroca(trx, c, fila.get(Number(it.idproduto))?.shift() ?? null, it as unknown as ItemTroca);
        for (const sobrou of fila.values()) for (const a of sobrou) await movimentoDaTroca(trx, c, a, null);
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
  // excluir a troca exclui os itens: cada um estorna (o DELETE do gatilho ESTOQUE_TROCA)
  aoRemover: async ({ id, db }) => {
    const t = (await db.selectFrom('troca').select(['idempresa', 'dtcadastro']).where('codtroca', '=', id).executeTakeFirst()) as { idempresa: number; dtcadastro: unknown } | undefined;
    if (!t) return;
    const c = { emp: Number(t.idempresa), codtroca: Number(id), dtcadastro: t.dtcadastro, op: currentTenant().operadorId ?? null };
    const itens = (await db.selectFrom('itens_troca').select(['idproduto', 'qtde', 'vrcusto', 'estoqueretirada', 'fechado', 'origem_fechamento', 'codscrap'])
      .where('codtroca', '=', id).orderBy('coditenstroca').execute()) as ItemTroca[];
    for (const it of itens) await movimentoDaTroca(db, c, it, null);
  },
};

export const TrocaAggregateController = createAggregateController({
  path: 'cadastro/troca',
  config: trocaAggregateConfig,
  schema: trocaSchema,
  updateSchema: atualizarTrocaSchema,
});
