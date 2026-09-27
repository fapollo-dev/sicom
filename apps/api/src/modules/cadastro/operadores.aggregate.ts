import { operadorSchema, atualizarOperadorSchema, TIPOOP_IDGRUPO } from '@apollo/shared';
import { opcoesConcedidas } from '../../shared/acesso/acesso.service';
import { exigirOpcao } from '../../shared/acesso/controles';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import { BusinessRuleError } from '../../shared/errors/app-error';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { hashSenha } from '../../shared/auth/crypto';
import { sql } from 'kysely';

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
    // o MENU (cbbMenu: 1 Padrão, 2 Personalizado — 2 no NewRecord, uRdmCadUsuarios.pas:213), o CODIGOAUXILIAR (EdtCodigoAuxiliar,
    // uCadUsuarios.dfm:404) e o que o binário novo acrescentou: ATIVO ('S' no novo; S→N 3 vezes em 2026) e BLOQUEARSUPERLIBERARPROP
    'menu', 'codigoauxiliar', 'ativo', 'bloquearsuperliberarprop',
  ],
  // o NewRecord: MENU 2, e o que o binário novo grava em todo operador novo (90 de 90 em 2026: ATIVO 'S', BLOQUEARSUPERLIBERARPROP 'N')
  derivarTrx: async ({ dto }) => {
    const out: Record<string, unknown> = {};
    if (dto.menu === undefined) out.menu = 2;
    if (dto.ativo === undefined) out.ativo = 'S';
    if (dto.bloquearsuperliberarprop === undefined) out.bloquearsuperliberarprop = 'N';
    return out;
  },
  rbacForm: 'FRMCADUSUARIOS',
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'Cadastro de usuários' },
  softDelete: true, // excluir master → INDR='E' (a ponte é apagada na cascata)
  // o operador excluído perde as PERMISSOES (`ExcluirPermissoesOperadorExcluido`, uRdmCadUsuarios.pas:324 — com INDR='E')
  aoRemover: async ({ id, db }) => {
    await db.deleteFrom('permissoes').where('codoperador', '=', id).execute();
  },
  // senha_hash (070) NUNCA sai no read/echo — a allowlist `colunas` só filtra a escrita; o read faz selectAll.
  colunasOcultasLeitura: ['senha_hash'],
  empresaScoped: false, // operador é global no schema
  replica: false,
  colunasPesquisa: ['codoperador', 'nome', 'login', 'tipoop'],
  detalhes: [
    // empresas-permitidas: ponte N:N (PK surrogate codrelacao gerada por sequence; substitute no update).
    {
      tabela: 'relacao_operador_empresa', pk: 'codrelacao', fk: 'codoperador', chave: 'empresas', colunas: ['codempresa'],
      // a empresa retirada do operador leva as PERMISSOES dele nela (`ExcluirPermissoesEmpresasExluidas`, uRdmCadUsuarios.pas:291-322)
      antesDeSubstituirTrx: async ({ trx, masterId }) =>
        ((await trx.selectFrom('relacao_operador_empresa').select('codempresa').where('codoperador', '=', masterId).execute()) as Array<{ codempresa: number }>).map((r) => Number(r.codempresa)),
      aposInserirItensTrx: async ({ trx, masterId, itens, snapshot }) => {
        const antes = (snapshot as number[] | undefined) ?? [];
        const agora = new Set(itens.map((i) => Number(i.codempresa)));
        const retiradas = antes.filter((e) => !agora.has(e));
        if (retiradas.length) await trx.deleteFrom('permissoes').where('codoperador', '=', masterId).where('codempresa', 'in', retiradas).execute();
      },
    },
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
    // "A senha informada não confere!" (:423); na inclusão a senha é obrigatória — sem ela o operador não entra (auditoria de
    // esqueletos §4.9: 88 de 88 inclusões de 2025-26 com senha no legado; o app não tinha como definir a de outro operador)
    if (dto.senha != null && dto.confirmacaoSenha != null && dto.senha !== dto.confirmacaoSenha) throw new BusinessRuleError('OPERADOR_SENHA_NAO_CONFERE');
    if (id == null && !String(dto.senha ?? '').length) throw new BusinessRuleError('OPERADOR_SENHA_OBRIGATORIA');
    // permissão de controle: a senha do retaguarda (edtSenhaRetaguarda, TDBEdit com Tag 1 — no form de cadastro o edit é desabilitado)
    // só para quem tem a opção — produção 27/09/2026: 9 de 37 operador×loja com acesso à tela sem ela. A troca da PRÓPRIA senha é
    // outro caminho (/auth). Só na tela (operador).
    if (String(dto.senha ?? '').length && currentTenant().operadorId != null) {
      exigirOpcao(await opcoesConcedidas(db, 'FRMCADUSUARIOS'), 'FRMCADUSUARIOS', 'EDTSENHARETAGUARDA', 'definir a senha do retaguarda');
    }
    if (id != null && (await loginProtegido(db, id))) throw new BusinessRuleError('OPERADOR_PROTEGIDO', { codoperador: id });
  },
  // a senha do cadastro vai ao hash forte (a cifra reversível do legado — SENHA/LOGIN_SENHA — não é gravada, como no cutover
  // das senhas) e o operador troca no primeiro acesso (SOLICITAR_ALTERACAO_SENHA)
  aposGravarTrx: async ({ trx, id, dto }) => {
    const senha = String(dto.senha ?? '');
    if (!senha) return;
    await sql`UPDATE operadores SET senha_hash = ${hashSenha(senha)}, solicitar_alteracao_senha = 'S', tentativas_login = 0, bloqueado_ate = NULL
               WHERE codoperador = ${id}`.execute(trx);
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
