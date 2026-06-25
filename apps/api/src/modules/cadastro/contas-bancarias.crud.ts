import { contaBancariaSchema, atualizarContaBancariaSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * Contas Bancárias — DECLARATIVO via engine. Versão COMPLETA e fiel ao legado
 * (UCadContasBancarias), exceto a aba mestre-detalhe "Liberação de operadores" e o
 * lookup de Plano de Contas, que ficam DEFERIDOS.
 *
 * Padrões exercitados:
 *  - FK/LOOKUP: 'codbco' (FK → bancos) é só mais uma coluna; a view get_contas_bancarias
 *    faz o JOIN e traz o nome do banco. Integridade do FK garantida pelo Postgres.
 *  - ESCOPO POR EMPRESA: empresaScoped:true → o create CARIMBA idempresa = empresa atual
 *    (fail-closed) e read/list FILTRAM por empresa. A view expõe `idempresa`.
 *
 * Exclusão: o legado usa a FLAG ATIVO (não INDR) → mantém hard-delete; ATIVO é campo normal.
 *
 * TODO (Fase X): FK Plano de Contas / aba Operadores quando PLANO_CONTAS/OPERADORES migrarem.
 */
export const contasBancariasCrudConfig: CrudConfig = {
  tabela: 'contas_bancarias',
  pk: 'codconta',
  view: 'get_contas_bancarias',
  empresaScoped: true, // carimba idempresa no create; filtra read/list por empresa
  colunas: [
    'codbco',
    'titular',
    'nroconta',
    'gerente',
    'dtabertura',
    'fone1',
    'obs',
    'codlanccontabil',
    'convenio',
    'carteira_cobranca',
    'variacao_carteira',
    'tipo_cobranca',
    'codigo_transmissao_cobranca',
    'nroconvenio_arqrem',
    'conta_propria',
    'exibe_rel_apuracao_caixa',
    'ativo',
  ], // NÃO inclui idempresa (carimbado pelo engine) nem codconta (PK gerada)
  rbacForm: 'FRMCADCONTASBANCARIAS',
  colunasPesquisa: ['codconta', 'banco', 'titular', 'nroconta', 'gerente', 'ativo'],
  softDelete: false, // legado usa flag ATIVO, não INDR → hard-delete
  replica: false,
};

export const ContasBancariasCrudController = createCrudController({
  path: 'cadastro/contas-bancarias',
  config: contasBancariasCrudConfig,
  schema: contaBancariaSchema,
  updateSchema: atualizarContaBancariaSchema,
});
