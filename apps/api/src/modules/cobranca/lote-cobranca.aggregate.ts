import { loteCobrancaSchema } from '@apollo/shared';
import { opcoesConcedidas } from '../../shared/acesso/acesso.service';
import { conferirDetalhe } from '../../shared/acesso/controles';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';

/**
 * Lote de Cobrança DECLARATIVO (mestre-detalhe via AggregateEngineService) — prova
 * que o pilar reproduz o vertical hand-written (`LoteCobrancaRepository`): header +
 * itens numa transação, substituição de itens no update, exclusão em cascata.
 * Montado em caminho paralelo (`cobranca/lotes-md`) para conviver com o vertical.
 */
export const loteCobrancaAggregateConfig: AggregateConfig = {
  tabela: 'lote_cobranca',
  pk: 'codlotecob',
  view: 'get_lote_cobranca',
  colunas: ['codparceiro', 'data'],
  rbacForm: 'FRMCADLOTECOBRANCA',
  // permissões de controle da grade (uCadLoteCobranca.dfm, form de cadastro): "Adicionar" (btnAddIten) e "Excluir" (btnExcluirItem)
  // desabilitados sem a opção — produção 27/09/2026: 5 de 23 operador×loja sem "Excluir". Só na tela (operador).
  validar: async ({ dto, id, db }) => {
    if (!Array.isArray(dto.itens) || currentTenant().operadorId == null) return;
    const antigos = id != null
      ? ((await db.selectFrom('itens_lotecob').select('codrcb').where('codlotecob', '=', id).execute()) as Array<{ codrcb: number }>).map((r) => Number(r.codrcb))
      : [];
    conferirDetalhe(await opcoesConcedidas(db, 'FRMCADLOTECOBRANCA'), 'FRMCADLOTECOBRANCA', antigos, (dto.itens as Array<Record<string, unknown>>).map((x) => Number(x.codrcb)),
      { adicionar: 'BTNADDITEN', excluir: 'BTNEXCLUIRITEM', no: 'no lote', do: 'do lote' });
  },
  replica: false,
  detalhes: [
    { tabela: 'itens_lotecob', pk: 'codilotcob', fk: 'codlotecob', colunas: ['codrcb'], chave: 'itens' },
  ],
  colunasPesquisa: ['codlotecob', 'codparceiro'],
};

export const LoteCobrancaAggregateController = createAggregateController({
  path: 'cobranca/lotes-md',
  config: loteCobrancaAggregateConfig,
  schema: loteCobrancaSchema,
  updateSchema: loteCobrancaSchema.partial(),
});
