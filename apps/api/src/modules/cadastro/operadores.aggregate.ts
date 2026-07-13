import { operadorSchema, atualizarOperadorSchema, TIPOOP_IDGRUPO } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import { BusinessRuleError } from '../../shared/errors/app-error';
import type { AggregateConfig } from '../../shared/crud/crud-config';

/**
 * OPERADORES (uCadUsuarios) — corte-2: migra o CRUD simples para MESTRE-DETALHE (AggregateEngineService)
 * p/ ganhar as **empresas-permitidas** (ponte 1:N `relacao_operador_empresa`, substitute delete+insert com
 * PK surrogate — espelha o master-detail do legado). GLOBAL (empresaScoped:false → o guard de tenant é no-op)
 * + PK DIGITADA + soft-delete INDR do master; a ponte é HARD-delete na cascata (relação pura, sem INDR — e o
 * Oracle confirma: operador excluído fica sem empresa). `idgrupo` derivado de `tipoop` (uCadUsuarios.pas:451).
 *
 * Regras portadas: ≥1 empresa no gravar (uCadUsuarios.pas:444 — via zod `empresas.min(1)`, opcional no update
 * parcial); **usuário-sistema PROTEGIDO** (não editar/excluir/criar/renomear) — logins 'SICOM' (literal legado
 * uCadUsuarios.pas:332/358) + 'ADMIN' (op 1 real deste tenant, Oracle). `idsupervisor` é lookup opcional
 * (0 dados reais, sem FK — auto-relação de aplicação).
 * ADIADO (corte seguinte): senha+hash+login/sessão/auth, perfis/PERMISSOES granular, biometria, MENU,
 * ENFORCEMENT das empresas (sem consumidor no retaguarda até o epic de auth).
 */
// Logins do usuário-SISTEMA: 'SICOM' (literal do legado, uCadUsuarios.pas:332/358) + 'ADMIN' (o real
// deste tenant — op 1 'ACESSO DE PROGRAMADOR', Oracle). Não editar/excluir, nem criar/renomear PARA eles.
const LOGINS_PROTEGIDOS = ['SICOM', 'ADMIN'];
const ehProtegido = (login: unknown): boolean => LOGINS_PROTEGIDOS.includes(String(login ?? '').toUpperCase());

async function loginProtegido(db: { selectFrom: (t: string) => any }, id: number): Promise<boolean> {
  const r = await db.selectFrom('operadores').select('login').where('codoperador', '=', id).executeTakeFirst();
  return ehProtegido(r?.login);
}

export const operadoresAggregateConfig: AggregateConfig = {
  tabela: 'operadores',
  pk: 'codoperador',
  pkGerada: false, // codoperador digitado
  view: 'get_operadores',
  colunas: [
    'nome', 'login', 'tipoop', 'idgrupo', 'codparceiro', 'idsupervisor',
    'desabilitado', 'desabilita_operacoes_basicas', 'desabilita_desconto_pdv',
    'solicitar_alteracao_senha',
  ],
  rbacForm: 'FRMCADOPERADOR',
  softDelete: true, // excluir master → INDR='E' (a ponte é apagada na cascata)
  // senha_hash (070) NUNCA sai no read/echo — a allowlist `colunas` só filtra a escrita; o read faz selectAll.
  colunasOcultasLeitura: ['senha_hash'],
  empresaScoped: false, // operador é global no schema
  replica: false,
  colunasPesquisa: ['codoperador', 'nome', 'login', 'tipoop'],
  detalhes: [
    // empresas-permitidas: ponte N:N (PK surrogate codrelacao gerada por sequence; substitute no update).
    { tabela: 'relacao_operador_empresa', pk: 'codrelacao', fk: 'codoperador', chave: 'empresas', colunas: ['codempresa'] },
  ],
  // idgrupo derivado do tipo (uCadUsuarios.pas:451-462) — o usuário nunca digita o grupo.
  derivar: (dto) => {
    const t = dto.tipoop as string | undefined;
    const g = t ? TIPOOP_IDGRUPO[t] : undefined;
    return g != null ? { idgrupo: g } : {};
  },
  // trava do usuário-sistema: (a) não CRIAR/RENOMEAR para um login protegido (checa dto.login) e
  // (b) não EDITAR um operador de sistema existente (checa o login gravado pela PK, no update).
  validar: async ({ dto, id, db }) => {
    if (ehProtegido(dto.login)) throw new BusinessRuleError('OPERADOR_PROTEGIDO', { login: dto.login });
    if (id != null && (await loginProtegido(db, id))) throw new BusinessRuleError('OPERADOR_PROTEGIDO', { codoperador: id });
  },
  validarRemocao: async ({ id, db }) => {
    if (await loginProtegido(db, id)) throw new BusinessRuleError('OPERADOR_PROTEGIDO', { codoperador: id });
  },
};

export const OperadoresAggregateController = createAggregateController({
  path: 'cadastro/operadores',
  config: operadoresAggregateConfig,
  schema: operadorSchema,
  updateSchema: atualizarOperadorSchema,
});
