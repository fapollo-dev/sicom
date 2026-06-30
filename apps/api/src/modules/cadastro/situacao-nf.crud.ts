import { situacaoNfSchema, atualizarSituacaoNfSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * SITUACAO_NF (natureza do documento fiscal) — lookup da NF. DECLARATIVO (engine).
 * CHAVE NATURAL (idsituacao_nf), sem auditoria, hard-delete. A NF guarda o id.
 */
export const situacaoNfCrudConfig: CrudConfig = {
  tabela: 'situacao_nf',
  pk: 'idsituacao_nf',
  pkGerada: false,
  view: 'get_situacao_nf',
  colunas: ['descricao', 'tipo'],
  rbacForm: 'FRMCADSITUACAONF',
  audit: false,
  replica: false,
  historico: false,
  colunasPesquisa: ['idsituacao_nf', 'descricao', 'tipo'],
};

export const SituacaoNfCrudController = createCrudController({
  path: 'cadastro/situacoes-nf',
  config: situacaoNfCrudConfig,
  schema: situacaoNfSchema,
  updateSchema: atualizarSituacaoNfSchema,
});
