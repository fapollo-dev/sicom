import { cfopSchema, atualizarCfopSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * CFOP (Código Fiscal de Operações) — catálogo/lookup da NF. DECLARATIVO (engine).
 * CHAVE NATURAL (codcfop char(4)), sem auditoria, hard-delete. Header/itens guardam o código.
 */
export const cfopCrudConfig: CrudConfig = {
  tabela: 'cfop',
  pk: 'codcfop',
  pkGerada: false,
  view: 'get_cfop',
  colunas: ['descricao'],
  rbacForm: 'FRMCADCFOP',
  audit: false,
  replica: false,
  historico: false,
  colunasPesquisa: ['codcfop', 'descricao'],
};

export const CfopCrudController = createCrudController({
  path: 'cadastro/cfops',
  config: cfopCrudConfig,
  schema: cfopSchema,
  updateSchema: atualizarCfopSchema,
});
