import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { LoginDto, LoginResposta, TrocarSenhaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError, ForbiddenActionError, UnauthenticatedError } from '../../shared/errors/app-error';
import { hashSenha, verificarSenha, DUMMY_HASH } from '../../shared/auth/crypto';
import { signJwt } from '../../shared/auth/jwt';

type AnyDB = Kysely<any>;

const TTL_TROCA_OBRIGATORIA_SEG = 15 * 60; // token restrito (chg) vive só 15 min — só p/ trocar a senha

/** metadados do request para a auditoria de acesso (OPERADORES_ACESSOS). */
export interface AcessoMeta {
  ip?: string | null;
  versao?: string | null;
  nomecomputador?: string | null;
}

/**
 * AUTH (OPERADORES corte-3a) — login + troca de senha + auditoria. Substitui a `Sessao`/`EmpresaAtual` global
 * do legado por um JWT assinado que alimenta o TenantCtx. O tenant (banco) vem do header `x-tenant-id`
 * (o middleware já o colocou no contexto ANTES do login — login é público mas escopado ao tenant). A senha é
 * validada por HASH scrypt (não pela cifra reversível do legado). Login escopado por EMPRESA (fiel:
 * RELACAO_OPERADOR_EMPRESA). Backdoors do legado eliminados.
 */
@Injectable()
export class AuthService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private tenant(): string {
    return currentTenant().tenantId;
  }
  private nowSeg(): number {
    return Math.floor(Date.now() / 1000);
  }

  async login(dto: LoginDto, meta: AcessoMeta = {}): Promise<LoginResposta> {
    const tenant = this.tenant();
    const db = this.dbp.forTenant() as AnyDB;

    const op = (await db
      .selectFrom('operadores')
      .select(['codoperador', 'nome', 'login', 'desabilitado', 'senha_hash', 'solicitar_alteracao_senha'])
      .where(sql`upper(login)`, '=', dto.login.toUpperCase())
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as
      | { codoperador: number; nome: string | null; login: string | null; desabilitado: string | null; senha_hash: string | null; solicitar_alteracao_senha: string | null }
      | undefined;

    // fold B1: verifica SEMPRE um scrypt (contra o hash real OU o dummy) → tempo constante, sem oráculo de
    // existência de usuário. Credenciais inválidas (inexistente / senha errada / sem hash) → MESMA resposta.
    const senhaOk = verificarSenha(dto.senha, op?.senha_hash ?? DUMMY_HASH);
    if (!op || !senhaOk) {
      // fold M3: audita a FALHA de um login CONHECIDO (sinal de brute-force contra a conta; trilha que o
      // legado não tinha). Login desconhecido não é auditável (codoperador tem FK NOT NULL) — limitação anotada.
      if (op) {
        await db.insertInto('operadores_acessos').values({ codoperador: op.codoperador, ip: meta.ip ?? null, nomecomputador: meta.nomecomputador ?? null, versao: meta.versao ?? null, tipo: 'LOGON_FAIL' }).execute();
      }
      throw new UnauthenticatedError('CREDENCIAIS_INVALIDAS');
    }
    if (op.desabilitado === 'S') throw new ForbiddenActionError('OPERADOR_DESABILITADO', { codoperador: op.codoperador });

    // empresas-permitidas (RELACAO_OPERADOR_EMPRESA + nome da empresa).
    const empresas = (await db
      .selectFrom('relacao_operador_empresa as r')
      .leftJoin('empresas as e', 'e.idempresa', 'r.codempresa')
      .select(['r.codempresa as idempresa', 'e.razao_social as nome'])
      .where('r.codoperador', '=', op.codoperador)
      .orderBy('r.codempresa')
      .execute()) as Array<{ idempresa: number; nome: string | null }>;
    if (empresas.length === 0) throw new ForbiddenActionError('OPERADOR_SEM_EMPRESA', { codoperador: op.codoperador });

    // seleção da empresa (fiel ao TrocarEmpresa do login legado).
    let empresa: number;
    if (dto.empresa != null) {
      if (!empresas.some((x) => Number(x.idempresa) === Number(dto.empresa))) {
        throw new ForbiddenActionError('OPERADOR_SEM_EMPRESA', { codoperador: op.codoperador, empresa: dto.empresa });
      }
      empresa = Number(dto.empresa);
    } else if (empresas.length === 1) {
      empresa = Number(empresas[0].idempresa);
    } else {
      // várias empresas e nenhuma escolhida → o cliente escolhe e reenvia (sem token ainda).
      return { needsEmpresa: true, empresas };
    }

    // auditoria LOGON (fiel a OPERADORES_ACESSOS; sem registro de FALHA — como o legado).
    await db
      .insertInto('operadores_acessos')
      .values({ codoperador: op.codoperador, codempresa: empresa, ip: meta.ip ?? null, nomecomputador: meta.nomecomputador ?? null, versao: meta.versao ?? null, tipo: 'LOGON' })
      .execute();

    // fold M2: se a troca é obrigatória, o token carrega `chg` (o AcessoGuard barra tudo ≠ /auth/*) e vive só
    // 15 min — o operador não opera com a senha (fraca, do cutover) antes de trocá-la.
    const mustChange = op.solicitar_alteracao_senha === 'S';
    const token = mustChange
      ? signJwt({ tenant, sub: op.codoperador, emp: empresa, chg: true }, this.nowSeg(), TTL_TROCA_OBRIGATORIA_SEG)
      : signJwt({ tenant, sub: op.codoperador, emp: empresa }, this.nowSeg());
    return {
      token,
      empresa,
      empresas,
      operador: { codoperador: op.codoperador, nome: op.nome, login: op.login },
      mustChangePassword: mustChange,
    };
  }

  /** troca de senha do operador AUTENTICADO (ctx). Também é o fluxo de troca obrigatória no 1º acesso. */
  async trocarSenha(dto: TrocarSenhaDto): Promise<{ ok: true }> {
    const ctx = currentTenant();
    const op = ctx.operadorId ?? null;
    if (op == null) throw new UnauthenticatedError('NAO_AUTENTICADO');
    const db = this.dbp.forTenant() as AnyDB;

    return db.transaction().execute(async (trx: AnyDB) => {
      const row = (await trx
        .selectFrom('operadores')
        .select(['codoperador', 'senha_hash'])
        .where('codoperador', '=', op)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .forUpdate()
        .executeTakeFirst()) as { codoperador: number; senha_hash: string | null } | undefined;
      if (!row) throw new UnauthenticatedError('NAO_AUTENTICADO');
      if (!verificarSenha(dto.senhaAtual, row.senha_hash)) throw new BusinessRuleError('SENHA_ATUAL_INVALIDA');

      await trx
        .updateTable('operadores')
        .set({ senha_hash: hashSenha(dto.senhaNova), solicitar_alteracao_senha: 'N', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codoperador', '=', op)
        .execute();
      return { ok: true as const };
    });
  }

  /** identidade corrente (do JWT/ctx) + empresas-permitidas + flag de troca obrigatória. */
  async me(): Promise<LoginResposta> {
    const ctx = currentTenant();
    const op = ctx.operadorId ?? null;
    if (op == null) throw new UnauthenticatedError('NAO_AUTENTICADO');
    const db = this.dbp.forTenant() as AnyDB;
    const row = (await db
      .selectFrom('operadores')
      .select(['codoperador', 'nome', 'login', 'solicitar_alteracao_senha'])
      .where('codoperador', '=', op)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { codoperador: number; nome: string | null; login: string | null; solicitar_alteracao_senha: string | null } | undefined;
    if (!row) throw new UnauthenticatedError('NAO_AUTENTICADO');
    const empresas = (await db
      .selectFrom('relacao_operador_empresa as r')
      .leftJoin('empresas as e', 'e.idempresa', 'r.codempresa')
      .select(['r.codempresa as idempresa', 'e.razao_social as nome'])
      .where('r.codoperador', '=', op)
      .orderBy('r.codempresa')
      .execute()) as Array<{ idempresa: number; nome: string | null }>;
    return {
      empresa: ctx.empresaId ?? undefined,
      empresas,
      operador: { codoperador: row.codoperador, nome: row.nome, login: row.login },
      mustChangePassword: row.solicitar_alteracao_senha === 'S',
    };
  }

  /** LOGOFF (auditoria; JWT é stateless, então é só o registro — o cliente descarta o token). */
  async logout(meta: AcessoMeta = {}): Promise<{ ok: true }> {
    const ctx = currentTenant();
    const op = ctx.operadorId ?? null;
    if (op == null) throw new UnauthenticatedError('NAO_AUTENTICADO');
    const db = this.dbp.forTenant() as AnyDB;
    await db
      .insertInto('operadores_acessos')
      .values({ codoperador: op, codempresa: ctx.empresaId ?? null, ip: meta.ip ?? null, nomecomputador: meta.nomecomputador ?? null, versao: meta.versao ?? null, tipo: 'LOGOFF' })
      .execute();
    return { ok: true };
  }
}
