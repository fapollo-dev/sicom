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
 * uCadUsuarios.pas:332/358) + 'ADMIN' (op 1 real deste tenant, Oracle). `idsupervisor` só no OPERADOR (sem FK — auto-relação
 * de aplicação); as abas de perfis e de supervisionados gravam no `aposGravarTrx` (ver `gravarPerfis`/`gravarSupervisionados`).
 * Fora daqui: a biometria (BitBtn2, leitor NBioBSP).
 */
// Logins do usuário-SISTEMA: 'SICOM' (literal do legado, uCadUsuarios.pas:332/358) + 'ADMIN' (o real
// deste tenant — op 1 'ACESSO DE PROGRAMADOR', Oracle). Não editar/excluir, nem criar/renomear PARA eles.
const LOGINS_PROTEGIDOS = ['SICOM', 'ADMIN'];
const ehProtegido = (login: unknown): boolean => LOGINS_PROTEGIDOS.includes(String(login ?? '').toUpperCase());

async function loginProtegido(db: { selectFrom: (t: string) => any }, id: number): Promise<boolean> {
  const r = await db.selectFrom('operadores').select('login').where('codoperador', '=', id).executeTakeFirst();
  return ehProtegido(r?.login);
}

/**
 * as abas de PERFIL do operador (uCadUsuarios.pas:220-264, :370-391; uRdmCadUsuarios.pas:230-289, :343-364): a "Perfil operador"
 * (ACESSO → RELACAO_OPERADOR_PERFIL, que conta no acesso quando o CONTROLE_PERMISSOES é Perfil/Ambos — a produção é Ambos) e a
 * "Perfil de compras" (COMPRA → RELACAO_OPERADOR_PERFIL_COMPRA). O legado guarda o histórico: o vínculo novo é uma linha 'I'; o
 * retirado vira 'E' com INDR_USUARIO/INDR_DATA — nada é apagado. Por isso não é um `detalhe` do motor (que regrava delete+insert).
 */
const ABAS_DE_PERFIL = [
  { chave: 'perfis', tipo: 'ACESSO', tabela: 'relacao_operador_perfil' },
  { chave: 'perfis_compra', tipo: 'COMPRA', tabela: 'relacao_operador_perfil_compra' },
] as const;

async function gravarPerfis(trx: any, id: number, dto: Record<string, unknown>): Promise<void> {
  const op = currentTenant().operadorId ?? null;
  for (const aba of ABAS_DE_PERFIL) {
    const lista = dto[aba.chave] as Array<{ codperfil: number }> | undefined;
    if (lista === undefined) continue;
    const quer = [...new Set(lista.map((p) => Number(p.codperfil)))];
    const ativos = ((await trx.selectFrom(aba.tabela).select('codperfil').where('codoperador', '=', id)
      .where(sql`coalesce(indr,'I')`, '<>', 'E').forUpdate().execute()) as Array<{ codperfil: number }>).map((r) => Number(r.codperfil));
    const novos = quer.filter((c) => !ativos.includes(c));
    const saem = ativos.filter((c) => !quer.includes(c));
    if (novos.length) {
      // o que a Pesquisa do legado oferece: perfil ATIVO do TIPO da aba (`ExistePerfilSelecionado`, uCadUsuarios.pas:802-817)
      const validos = new Set(((await trx.selectFrom('perfil').select('codperfil').where('codperfil', 'in', novos)
        .where('ativo', '=', 'S').where(sql`upper(tipo)`, '=', aba.tipo).where(sql`coalesce(indr,'I')`, '<>', 'E')
        .execute()) as Array<{ codperfil: number }>).map((r) => Number(r.codperfil)));
      const invalido = novos.find((c) => !validos.has(c));
      if (invalido != null) throw new BusinessRuleError('OPERADOR_PERFIL_INVALIDO', { codperfil: invalido, tipo: aba.tipo });
      await trx.insertInto(aba.tabela).values(novos.map((codperfil) => ({ codoperador: id, codperfil, indr: 'I', dtcadastro: sql`now()` }))).execute();
    }
    if (saem.length) {
      await trx.updateTable(aba.tabela).set({ indr: 'E', indr_usuario: op, indr_data: sql`now()` })
        .where('codoperador', '=', id).where('codperfil', 'in', saem).where(sql`coalesce(indr,'I')`, '<>', 'E').execute();
    }
  }
}

/**
 * a aba "Operadores supervisionados" — só do SUPERVISOR (`TbsSupervisionados.TabVisible := cbbTipo.ItemIndex = 2`, :754). O Adicionar
 * é a Pesquisa da GET_OPERADORES com TIPO_SIGLA='OPE' (:266-300); o `DepoisGravar` (:557-588) põe o IDSUPERVISOR dos que entraram e
 * limpa o dos que saíram, com UPDATE cru. Quem deixa de ser supervisor perde a lista (cbbTipoExit, :528-549: "O vínculo de supervisor
 * com outros operadores será removido"). Produção 08/10/2026: nenhum operador com IDSUPERVISOR.
 */
async function gravarSupervisionados(trx: any, id: number, dto: Record<string, unknown>): Promise<void> {
  const tipo = ((await trx.selectFrom('operadores').select('tipoop').where('codoperador', '=', id).executeTakeFirst()) as { tipoop?: string } | undefined)?.tipoop;
  const atuais = ((await trx.selectFrom('operadores').select('codoperador').where('idsupervisor', '=', id).execute()) as Array<{ codoperador: number }>).map((r) => Number(r.codoperador));
  const lista = dto.supervisionados as Array<{ codoperador: number }> | undefined;
  const quer = tipo !== 'SUP' ? [] : lista === undefined ? atuais : [...new Set(lista.map((o) => Number(o.codoperador)))].filter((c) => c !== id);
  const novos = quer.filter((c) => !atuais.includes(c));
  const saem = atuais.filter((c) => !quer.includes(c));
  if (novos.length) {
    const validos = new Set(((await trx.selectFrom('operadores').select('codoperador').where('codoperador', 'in', novos)
      .where('tipoop', '=', 'OPE').where(sql`coalesce(indr,'I')`, '<>', 'E').execute()) as Array<{ codoperador: number }>).map((r) => Number(r.codoperador)));
    const invalido = novos.find((c) => !validos.has(c));
    if (invalido != null) throw new BusinessRuleError('OPERADOR_SUPERVISIONADO_INVALIDO', { codoperador: invalido });
    await sql`UPDATE operadores SET idsupervisor = ${id} WHERE codoperador IN (${sql.join(novos)})`.execute(trx);
  }
  if (saem.length) await sql`UPDATE operadores SET idsupervisor = NULL WHERE codoperador IN (${sql.join(saem)})`.execute(trx);
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
  // + as senhas do LEGADO (SENHA, SENHAPDV, SENHARETAGUARDA, LOGIN_SENHA — codificação reversível: César +13) que a carga traz:
  // 286/93/45/286 preenchidas na produção. Só o hash do Apollo autentica; nenhuma delas sai na leitura.
  colunasOcultasLeitura: ['senha_hash', 'senha', 'senhapdv', 'senharetaguarda', 'login_senha'],
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
    const out: Record<string, unknown> = g != null ? { idgrupo: g } : {};
    // o supervisor é do OPERADOR: nos outros tipos o campo fica desabilitado e é limpo (ProcessaRegrasSupervisor, :745-755)
    if (t && t !== 'OPE') out.idsupervisor = null;
    return out;
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
    // o supervisor escolhido: a Pesquisa do legado só oferece SUPERVISOR não desabilitado (uCadUsuarios.pas:497-501). Só confere quando
    // muda — o que já está gravado não trava o Gravar se o supervisor for desabilitado depois.
    const sup = dto.idsupervisor == null ? null : Number(dto.idsupervisor);
    if (sup != null && (dto.tipoop === undefined || dto.tipoop === 'OPE')) {
      const atual = id == null ? null : ((await db.selectFrom('operadores').select('idsupervisor').where('codoperador', '=', id).executeTakeFirst()) as { idsupervisor?: number | null } | undefined)?.idsupervisor;
      if (atual == null || Number(atual) !== sup) {
        const ok = await db.selectFrom('operadores').select('codoperador').where('codoperador', '=', sup).where('tipoop', '=', 'SUP')
          .where(sql`coalesce(desabilitado,'N')`, '=', 'N').where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst();
        if (!ok) throw new BusinessRuleError('OPERADOR_SUPERVISOR_INVALIDO', { idsupervisor: sup });
      }
    }
  },
  // a senha do cadastro vai ao hash forte (a cifra reversível do legado — SENHA/LOGIN_SENHA — não é gravada, como no cutover
  // das senhas) e o operador troca no primeiro acesso (SOLICITAR_ALTERACAO_SENHA)
  aposGravarTrx: async ({ trx, id, dto }) => {
    await gravarPerfis(trx, id, dto);
    await gravarSupervisionados(trx, id, dto);
    const senha = String(dto.senha ?? '');
    if (!senha) return;
    await sql`UPDATE operadores SET senha_hash = ${hashSenha(senha)}, solicitar_alteracao_senha = 'S', tentativas_login = 0, bloqueado_ate = NULL
               WHERE codoperador = ${id}`.execute(trx);
  },
  // a leitura traz as abas: os perfis ativos de cada tipo (as queries do uRdmCadUsuarios.dfm:390-409, :596-619) e os supervisionados
  // (QrySupervisionados, :544-550)
  anexarLeitura: async ({ db, id, registro }) => {
    const out: Record<string, unknown> = { ...registro };
    for (const aba of ABAS_DE_PERFIL) {
      out[aba.chave] = await db.selectFrom(`${aba.tabela} as r`).leftJoin('perfil as p', 'p.codperfil', 'r.codperfil')
        .select(['r.codperfil', 'p.perfil']).where('r.codoperador', '=', id).where(sql`coalesce(r.indr,'I')`, '<>', 'E')
        .orderBy('r.dtcadastro').orderBy('r.codperfil').execute();
    }
    out.supervisionados = await db.selectFrom('operadores').select(['codoperador', 'nome']).where('idsupervisor', '=', id).orderBy('codoperador').execute();
    return out;
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
