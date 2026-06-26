import { familiaSchema, atualizarFamiliaSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * Cadastro de FAMILIAS_PROD (catálogo único com discriminador TIPO: G/S/D/O/R) —
 * DECLARATIVO (engine). PK gerada por sequence, SEM auditoria, hard-delete.
 * Alvo dos lookups de grupo/subgrupo/departamento/seção/grupo de preço do Produto.
 */
export const familiasCrudConfig: CrudConfig = {
  tabela: 'familias_prod',
  pk: 'codfamilia',
  view: 'get_familias_prod',
  colunas: ['tipo', 'descricao'],
  rbacForm: 'FRMCADFAMILIAS',
  audit: false,
  replica: false,
  colunasPesquisa: ['codfamilia', 'tipo', 'descricao'],
};

export const FamiliasCrudController = createCrudController({
  path: 'cadastro/familias',
  config: familiasCrudConfig,
  schema: familiaSchema,
  updateSchema: atualizarFamiliaSchema,
});
