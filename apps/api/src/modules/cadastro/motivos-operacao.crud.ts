import { motivoOperacaoSchema, atualizarMotivoOperacaoSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * MOTIVOS_OPERACAO — lookup DECLARATIVO (molde marcas): soft-delete INDR, view de listagem, RBAC.
 * Consumidor inicial: o Ajuste de Estoque (motivo do ajuste). GLOBAL (o legado não escopa por empresa).
 */
export const motivosOperacaoCrudConfig: CrudConfig = {
  tabela: 'motivos_operacao',
  pk: 'codmotivoop',
  view: 'get_motivos_operacao',
  colunas: ['descricao', 'tipo_operacao'],
  rbacForm: 'FRMCADMOTIVOOPERACAO',
  colunasPesquisa: ['codigo', 'descricao', 'tipo_operacao'],
  softDelete: true,
  replica: false,
};

export const MotivosOperacaoCrudController = createCrudController({
  path: 'cadastro/motivos-operacao',
  config: motivosOperacaoCrudConfig,
  schema: motivoOperacaoSchema,
  updateSchema: atualizarMotivoOperacaoSchema,
});
