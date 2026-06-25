import { ncmSchema, atualizarNcmSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * Cadastro de NCM — DECLARATIVO (engine). Prova: CHAVE NATURAL (pkGerada:false →
 * o create insere o CODIGO do dto), datas (vigência) e memo (descricao/observacao).
 * Sem INDR no legado → hard-delete (softDelete omitido).
 */
export const ncmCrudConfig: CrudConfig = {
  tabela: 'ncm',
  pk: 'codigo',
  pkGerada: false, // chave natural: usuário digita o código NCM
  view: 'get_ncm',
  colunas: ['ncmsh', 'descricao', 'ipi', 'vigencia_inicio', 'vigencia_fim', 'observacao'],
  rbacForm: 'FRMCADNCM',
  // sem softDelete → hard-delete (NCM não tem INDR)
  replica: false,
  colunasPesquisa: ['codigo', 'ncmsh', 'descricao'],
};

export const NcmCrudController = createCrudController({
  path: 'cadastro/ncm',
  config: ncmCrudConfig,
  schema: ncmSchema,
  updateSchema: atualizarNcmSchema,
});
