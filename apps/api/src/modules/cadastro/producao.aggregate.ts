import { producaoSchema, atualizarProducaoSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

/**
 * PRODUÇÃO (FRMCADPRODUCAO — uCadProducao "Requisição de produção") — corte-1: NÚCLEO do documento (agregado
 * mestre-detalhe `producao` + itens de SAÍDA `itens_producao`). O operador informa produto ACABADO + qtde; o
 * custo/venda (vrcusto/vrvenda) é SNAPSHOT server-authoritative de MULTI_PRECO (igual ao Scrap/Inventário — o
 * operador NÃO digita custo). Cada acabado tem de POSSUIR receita (receita_prod). A explosão da receita, a baixa de
 * ingredientes e a entrada do acabado NÃO acontecem aqui — é o passo `processar`/`reverter` (producao.service),
 * como o Scrap decopla o `aplicar`. empresaScoped; exclusão física (sem INDR). validar/validarRemocao travam
 * editar/excluir doc já PROCESSADO (status='P') — espelha o legado (btnEditar/btnExcluir bloqueiam quando 'P').
 */

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

export const producaoAggregateConfig: AggregateConfig = {
  tabela: 'producao',
  pk: 'codproducao',
  view: 'get_producao',
  rbacForm: 'FRMCADPRODUCAO',
  empresaScoped: true,
  softDelete: false, // legado: exclusão física (permitida só enquanto 'A' — validarRemocao trava 'P')
  // codempresa_producao NÃO é editável pelo cliente — o servidor carimba = emp (derivarTrx). Ver fold [CRÍTICO].
  colunas: ['data', 'codparceiro', 'codplc'],
  colunasPesquisa: ['codproducao', 'data', 'status_label', 'parceiro', 'qtde_itens', 'total_custo'],
  detalhes: [
    {
      tabela: 'itens_producao',
      pk: 'coditenprod',
      fk: 'codproducao',
      chave: 'itens',
      colunas: ['idprodutos', 'qtde', 'unidade', 'vrcusto', 'vrvenda', 'observacao'],
      // SNAPSHOT server-authoritative do custo/venda do ACABADO: o operador fornece produto/qtde; vrcusto/vrvenda
      // vêm de MULTI_PRECO (por empresa) — fiel a RetornarValores('MULTI_PRECO','VRVENDA;VRCUSTO',...).
      derivarItensTrx: async (itens, trx, emp) => {
        const out: Record<string, unknown>[] = [];
        for (const it of itens) {
          const pid = Number(it.idprodutos);
          const mp = (await trx
            .selectFrom('multi_preco')
            .select(['vrcusto', 'vrvenda'])
            .where('idproduto', '=', pid)
            .where('idempresa', '=', emp)
            .executeTakeFirst()) as { vrcusto?: unknown; vrvenda?: unknown } | undefined;
          out.push({
            idprodutos: pid,
            qtde: num(it.qtde),
            unidade: it.unidade ?? null,
            vrcusto: num(mp?.vrcusto),
            vrvenda: num(mp?.vrvenda),
            observacao: it.observacao ?? null,
          });
        }
        return out;
      },
    },
  ],
  derivarTrx: async ({ emp }) => ({
    codoperador: currentTenant().operadorId ?? null,
    // empresa produtora = SEMPRE a empresa do tenant (server-authoritative; fold [CRÍTICO]: não deixar o cliente
    // escolher outra empresa, senão o processar moveria o estoque de OUTRA empresa). Fiel: sempre 1→1 no tenant.
    codempresa_producao: emp,
    usucadastro: currentTenant().operadorId ?? null,
    usultalteracao: currentTenant().operadorId ?? null,
  }),
  validar: async ({ dto, id, db }) => {
    // trava editar (PUT) um doc já PROCESSADO (status='P') — o estorno usa o snapshot ATUAL; editar dessincroniza.
    if (id != null) {
      const p = (await db.selectFrom('producao').select(['status']).where('codproducao', '=', id).executeTakeFirst()) as { status?: string } | undefined;
      if (p?.status === 'P') throw new BusinessRuleError('PRODUCAO_PROCESSADA', { codproducao: id });
    }
    const itens = Array.isArray(dto.itens) ? (dto.itens as Array<Record<string, unknown>>) : null;
    if (!itens || !itens.length) return;
    const ids = Array.from(new Set(itens.map((i) => Number(i.idprodutos)).filter((n) => Number.isInteger(n) && n > 0)));
    if (!ids.length) return;
    // cada produto acabado tem de existir (erro claro em vez de 23503 cru).
    const existentes = new Set(
      ((await db.selectFrom('produtos').select('idproduto').where('idproduto', 'in', ids).execute()) as Array<{ idproduto: number }>).map((r) => Number(r.idproduto)),
    );
    for (const pid of ids) if (!existentes.has(pid)) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: pid });
    // cada acabado tem de POSSUIR receita (fiel a ProdutoPossuiReceita — não se produz sem ficha técnica).
    const comReceita = new Set(
      ((await db.selectFrom('receita_prod').select('idproduto').where('idproduto', 'in', ids).execute()) as Array<{ idproduto: number }>).map((r) => Number(r.idproduto)),
    );
    for (const pid of ids) if (!comReceita.has(pid)) throw new BusinessRuleError('PRODUTO_SEM_RECEITA', { idproduto: pid });
  },
  validarRemocao: async ({ id, db }) => {
    const p = (await db.selectFrom('producao').select(['status']).where('codproducao', '=', id).executeTakeFirst()) as { status?: string } | undefined;
    if (p?.status === 'P') throw new BusinessRuleError('PRODUCAO_PROCESSADA', { codproducao: id }); // reverter antes
  },
};

export const ProducaoAggregateController = createAggregateController({
  path: 'cadastro/producao',
  config: producaoAggregateConfig,
  schema: producaoSchema,
  updateSchema: atualizarProducaoSchema,
});
