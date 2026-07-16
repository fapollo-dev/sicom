import { perfilSchema, atualizarPerfilSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * PERFIL (UCadPerfilOperador) corte-1 — CRUD declarativo dos perfis de RBAC. GLOBAL (sem empresa, fiel ao
 * golden PERFIL). Soft-delete INDR. A atribuição de perfis a operadores é o vertical PerfilRelacaoController.
 */
export const perfilCrudConfig: CrudConfig = {
  tabela: 'perfil',
  pk: 'codperfil',
  view: 'get_perfil',
  colunas: ['perfil', 'ativo', 'tipo'],
  rbacForm: 'FRMCADPERFILOPERADOR',
  colunasPesquisa: ['codigo', 'perfil', 'ativo'],
  softDelete: true,
  replica: false,
};

export const PerfilCrudController = createCrudController({
  path: 'cadastro/perfil',
  config: perfilCrudConfig,
  schema: perfilSchema,
  updateSchema: atualizarPerfilSchema,
});
