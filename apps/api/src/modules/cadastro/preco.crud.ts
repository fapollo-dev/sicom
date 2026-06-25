import { tabelaPrecoSchema, atualizarTabelaPrecoSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * Cadastro de PRECO (Tabela de Reajuste) — DECLARATIVO (engine CRUD). Completa o
 * palette de campos: texto + número/moeda (valor_reajuste) + 2 flags S/N. Herda do
 * engine: soft-delete (INDR), Pesquisa (F6), histórico, RBAC — só uma config.
 */
export const precoCrudConfig: CrudConfig = {
  tabela: 'preco',
  pk: 'id_preco',
  view: 'get_preco',
  colunas: ['descricao', 'valor_reajuste', 'reajuste', 'ativo'],
  rbacForm: 'FRMCADPRECO',
  softDelete: true,
  replica: false,
  colunasPesquisa: ['id_preco', 'descricao', 'valor_reajuste', 'reajuste', 'ativo'],
};

export const PrecoCrudController = createCrudController({
  path: 'cadastro/precos',
  config: precoCrudConfig,
  schema: tabelaPrecoSchema,
  updateSchema: atualizarTabelaPrecoSchema,
});
