import { marcaSchema, atualizarMarcaSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * Cadastro de Marcas — agora DECLARATIVO (substitui o vertical de 6 arquivos).
 * Herda do engine: auditoria, soft-delete (INDR, como o legado), view de listagem,
 * RBAC. Tela trivial = 1 config. (Espírito ADR-014 / contrato TfrmCadMaster.)
 */
export const marcasCrudConfig: CrudConfig = {
  tabela: 'marcas',
  pk: 'idmarca',
  view: 'get_marcas',
  colunas: ['descricao'],
  rbacForm: 'FRMCADMARCAS',
  colunasPesquisa: ['codigo', 'descricao'],
  softDelete: true, // excluir → INDR='E' (igual ao legado); a lista filtra
  replica: false, // MARCAS não tem trigger REM no legado
};

export const MarcasCrudController = createCrudController({
  path: 'cadastro/marcas',
  config: marcasCrudConfig,
  schema: marcaSchema,
  updateSchema: atualizarMarcaSchema,
});
