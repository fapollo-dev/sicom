import { operacaoContaSchema, atualizarOperacaoContaSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * Operações de Conta — DECLARATIVO via engine. Prova o engine com campo de LISTA
 * FIXA (TIPO): a coluna 'tipo' é só mais uma coluna; a view get_operacoes_conta
 * decodifica C→CREDITO na listagem. Hard-delete, sem replicação (igual ao legado).
 */
export const operacoesContaCrudConfig: CrudConfig = {
  tabela: 'operacoes_conta',
  pk: 'codopconta',
  view: 'get_operacoes_conta',
  colunas: ['descricao', 'tipo'],
  rbacForm: 'FRMCADOPERACOESCONTA',
  colunasPesquisa: ['codopconta', 'descricao', 'tipo'],
  softDelete: false,
  replica: false,
};

export const OperacoesContaCrudController = createCrudController({
  path: 'cadastro/operacoes-conta',
  config: operacoesContaCrudConfig,
  schema: operacaoContaSchema,
  updateSchema: atualizarOperacaoContaSchema,
});
