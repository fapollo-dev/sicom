import { contaBancariaSchema, atualizarContaBancariaSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * Contas Bancárias — DECLARATIVO via engine. Prova o engine com FK/LOOKUP: a coluna
 * 'codbco' (FK → bancos) é só mais uma coluna; a view get_contas_bancarias faz o JOIN
 * e traz o nome do banco na listagem. A integridade do FK é garantida pelo Postgres.
 */
export const contasBancariasCrudConfig: CrudConfig = {
  tabela: 'contas_bancarias',
  pk: 'codconta',
  view: 'get_contas_bancarias',
  colunas: ['codbco', 'titular', 'nroconta', 'ativo'],
  rbacForm: 'FRMCADCONTASBANCARIAS',
  colunasPesquisa: ['codconta', 'banco', 'titular', 'nroconta'],
  softDelete: false,
  replica: false,
};

export const ContasBancariasCrudController = createCrudController({
  path: 'cadastro/contas-bancarias',
  config: contasBancariasCrudConfig,
  schema: contaBancariaSchema,
  updateSchema: atualizarContaBancariaSchema,
});
