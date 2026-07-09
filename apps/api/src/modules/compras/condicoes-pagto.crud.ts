import { condicoesPagtoSchema, atualizarCondicoesPagtoSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * CONDIÇÃO DE PAGAMENTO (CONDICOES_PAGTO) — cadastral GLOBAL (37 linhas no legado), lookup do Pedido de
 * Compra. Define os prazos (dias) de cada parcela em CD1..CD8. DECLARATIVO via engine.
 *
 * - GLOBAL (empresaScoped:false) — no legado a tabela não tem IDEMPRESA.
 * - Sem INDR/ATIVO → hard-delete (softDelete:false), como o legado.
 * - CODCONPAGTO é PK gerada por sequence (pkGerada default true).
 */
export const condicoesPagtoCrudConfig: CrudConfig = {
  tabela: 'condicoes_pagto',
  pk: 'codconpagto',
  view: 'get_condicoes_pagto',
  empresaScoped: false, // GLOBAL (sem idempresa no legado)
  colunas: ['descricao', 'cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'],
  rbacForm: 'FRMCADCONDICOESPAGTO',
  colunasPesquisa: ['codconpagto', 'descricao', 'cd1', 'cd2', 'cd3'],
  softDelete: false, // legado não tem INDR/ATIVO → hard-delete
  replica: false,
};

export const CondicoesPagtoCrudController = createCrudController({
  path: 'compras/condicoes-pagto',
  config: condicoesPagtoCrudConfig,
  schema: condicoesPagtoSchema,
  updateSchema: atualizarCondicoesPagtoSchema,
});
