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
  colunas: [
    'descricao',
    // CFOP × SITUAÇÃO (aba "Situação do documento") + devolução + flags — colunas já existentes na tabela.
    'situacao_icms_entradas_nf', 'situacao_icms_saidas_nf',
    'situacao_pis_entradas_nf', 'situacao_pis_saidas_nf',
    'situacao_cofins_entradas_nf', 'situacao_cofins_saidas_nf',
    'idsituacao_nf_saida', 'cfop_devolucao', 'proc_cupom', 'gera_financeiro_auto',
  ],
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
