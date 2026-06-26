import { aliquotaSchema, atualizarAliquotaSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * Cadastro de ALIQUOTA (catálogo dos códigos fiscais; o detalhe por UF está em
 * DET_ALIQUOTA/007) — DECLARATIVO (engine). CHAVE NATURAL (CODIGO char(3), pkGerada:false),
 * SEM auditoria, hard-delete. O produto guarda o CÓDIGO; alvo do lookup de ALIQUOTA.
 */
export const aliquotaCrudConfig: CrudConfig = {
  tabela: 'aliquota',
  pk: 'codigo',
  pkGerada: false,
  view: 'get_aliquota',
  colunas: ['descricao'],
  rbacForm: 'FRMCADALIQUOTA',
  audit: false,
  replica: false,
  colunasPesquisa: ['codigo', 'descricao'],
};

export const AliquotaCrudController = createCrudController({
  path: 'cadastro/aliquotas',
  config: aliquotaCrudConfig,
  schema: aliquotaSchema,
  updateSchema: atualizarAliquotaSchema,
});
