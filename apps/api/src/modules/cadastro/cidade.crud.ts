import { cidadeSchema, atualizarCidadeSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * Cadastro de CIDADES — DECLARATIVO (engine). Chave natural (pkGerada:false),
 * SEM auditoria (audit:false — a tabela só tem idcidade/iduf/cidade) e hard-delete.
 * É o alvo do LOOKUP/FK de Bairros.
 */
export const cidadeCrudConfig: CrudConfig = {
  tabela: 'cidades',
  pk: 'idcidade',
  pkGerada: false,
  view: 'get_cidades',
  colunas: ['iduf', 'cidade'],
  rbacForm: 'FRMCADCIDADES',
  audit: false, // sem USULTALTERACAO/DT* na tabela real
  replica: false,
  colunasPesquisa: ['idcidade', 'cidade', 'iduf'],
};

export const CidadeCrudController = createCrudController({
  path: 'cadastro/cidades',
  config: cidadeCrudConfig,
  schema: cidadeSchema,
  updateSchema: atualizarCidadeSchema,
});
