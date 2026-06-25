import { loteCobrancaSchema } from '@apollo/shared';
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
