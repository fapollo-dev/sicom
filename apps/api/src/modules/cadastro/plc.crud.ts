import { plcSchema, atualizarPlcSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * PLC (Plano de Contas Gerencial / centro de custo) — lookup do rateio contábil da NF (F5).
 * DECLARATIVO (engine). CHAVE NATURAL (codplc), sem auditoria, hard-delete. O rateio
 * (nf_contabil.codcc) guarda o codplc.
 */
export const plcCrudConfig: CrudConfig = {
  tabela: 'plc',
  pk: 'codplc',
  pkGerada: false,
  view: 'get_plc',
  colunas: ['desccodplc', 'descricao'],
  rbacForm: 'FRMCADCENTROCUSTO',
  audit: false,
  replica: false,
  historico: false,
  colunasPesquisa: ['codplc', 'desccodplc', 'descricao'],
};

export const PlcCrudController = createCrudController({
  path: 'cadastro/plc',
  config: plcCrudConfig,
  schema: plcSchema,
  updateSchema: atualizarPlcSchema,
});
