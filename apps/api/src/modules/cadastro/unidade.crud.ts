import { unidadeSchema, atualizarUnidadeSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * Cadastro de UNIDADE (catálogo de apoio do Produto) — DECLARATIVO (engine).
 * PK gerada por sequence, SEM auditoria (tabela só tem codunidade/sigla/descricao),
 * hard-delete. Alvo do lookup de UNIDADE no Produto.
 */
export const unidadeCrudConfig: CrudConfig = {
  tabela: 'unidade',
  pk: 'codunidade',
  view: 'get_unidade',
  colunas: ['sigla', 'descricao'],
  rbacForm: 'FRMCADUNIDADE',
  audit: false,
  replica: false,
  colunasPesquisa: ['codunidade', 'sigla', 'descricao'],
};

export const UnidadeCrudController = createCrudController({
  path: 'cadastro/unidades',
  config: unidadeCrudConfig,
  schema: unidadeSchema,
  updateSchema: atualizarUnidadeSchema,
});
