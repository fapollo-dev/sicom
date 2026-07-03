import { operadorSchema, atualizarOperadorSchema, TIPOOP_IDGRUPO } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';

/**
 * OPERADORES (uCadUsuarios "Cadastro de usuários") — corte-1 núcleo cadastral, DECLARATIVO.
 * GLOBAL (empresaScoped:false — o legado não tem coluna de empresa), PK DIGITADA (pkGerada:false),
 * soft-delete via INDR (como o legado). `idgrupo` é DERIVADO de `tipoop` (uCadUsuarios.pas:451).
 * LOGIN único = índice parcial `ux_operadores_login` (051) → 409 no colisão. Senha/empresas/perfis/
 * supervisionados/biometria = cortes seguintes.
 */
export const operadoresCrudConfig: CrudConfig = {
  tabela: 'operadores',
  pk: 'codoperador',
  pkGerada: false, // codoperador digitado
  view: 'get_operadores',
  // ATIVO/CODIGOAUXILIAR são colunas reais mas NÃO editadas pela tela legada (bloqueio=DESABILITADO,
  // situação=INDR) → fora do delta. idgrupo é derivado de tipoop.
  colunas: [
    'nome', 'login', 'tipoop', 'idgrupo', 'codparceiro', 'idsupervisor',
    'desabilitado', 'desabilita_operacoes_basicas', 'desabilita_desconto_pdv',
    'solicitar_alteracao_senha',
  ],
  rbacForm: 'FRMCADOPERADOR',
  softDelete: true, // excluir → INDR='E'
  empresaScoped: false, // operador é global no schema
  replica: false,
  colunasPesquisa: ['codoperador', 'nome', 'login', 'tipoop'],
  // idgrupo derivado do tipo (uCadUsuarios.pas:451-462) — o usuário nunca digita o grupo.
  derivar: (dto) => {
    const t = dto.tipoop as string | undefined;
    const g = t ? TIPOOP_IDGRUPO[t] : undefined;
    return g != null ? { idgrupo: g } : {};
  },
};

export const OperadoresCrudController = createCrudController({
  path: 'cadastro/operadores',
  config: operadoresCrudConfig,
  schema: operadorSchema,
  updateSchema: atualizarOperadorSchema,
});
