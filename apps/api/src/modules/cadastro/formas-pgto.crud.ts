import { formaPgtoSchema, atualizarFormaPgtoSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * FORMAS DE PAGAMENTO (uCadFormaPgto) — corte-1, DECLARATIVO. empresaScoped (IDEMPRESA, como
 * contas_bancarias), PK IDPGTO por sequence (pkGerada:true). MODALIDADE/ATALHO únicos por empresa
 * (índices parciais → 409). A regra cross-field DESTINO='QUE'≠PDV vive no zod (superRefine, back+front).
 * Soft-delete = campo `inativo` (o legado usa INATIVO, não INDR) + hard-delete do engine (como
 * contas_bancarias.ativo). Prerequisito do Caixa corte-2d (contábil por modalidade + tesouraria).
 */
export const formasPgtoCrudConfig: CrudConfig = {
  tabela: 'formas_pgto',
  pk: 'idpgto',
  view: 'get_formas_pgto',
  empresaScoped: true, // IDEMPRESA (carimba no create, filtra no read/list)
  colunas: [
    'modalidade', 'atalho', 'destino',
    'plccofre', 'codcontacorrente', 'codplanocontas',
    'recebe_pdv', 'permite_sangria_pdv', 'lanc_movimento_individual', 'tipo', 'inativo', 'data_inativo',
  ],
  rbacForm: 'FRMCADFORMAPGTO',
  colunasPesquisa: ['idpgto', 'modalidade', 'atalho', 'destino'],
  replica: false,
  // soft-delete legado (INATIVO+DATA_INATIVO): ao inativar, carimba a data; ao reativar, limpa.
  derivar: (dto) => {
    if (dto.inativo === 'S') return { data_inativo: new Date() };
    if (dto.inativo === 'N') return { data_inativo: null };
    return {};
  },
};

export const FormasPgtoCrudController = createCrudController({
  path: 'cadastro/formas-pgto',
  config: formasPgtoCrudConfig,
  schema: formaPgtoSchema,
  updateSchema: atualizarFormaPgtoSchema,
});
