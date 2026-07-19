import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { LoginDto, LoginResposta, TrocarSenhaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError, ForbiddenActionError, UnauthenticatedError } from '../../shared/errors/app-error';
import { hashSenha, verificarSenha, DUMMY_HASH, gerarRefreshToken, hashRefreshToken } from '../../shared/auth/crypto';
import { signJwt } from '../../shared/auth/jwt';
import { randomUUID } from 'node:crypto';

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
  /** TTL do ACCESS token (env AUTH_ACCESS_TTL_MIN; default 12h — sem mudança de comportamento no corte-1). */
  private accessTtlSeg(): number {
    const min = Number(process.env.AUTH_ACCESS_TTL_MIN);
    return Number.isFinite(min) && min > 0 ? Math.floor(min * 60) : 12 * 60 * 60;
  }
  /** TTL do REFRESH token (env AUTH_REFRESH_TTL_DIAS; default 7 dias). */
  private refreshTtlSeg(): number {
    const dias = Number(process.env.AUTH_REFRESH_TTL_DIAS);
    return Number.isFinite(dias) && dias > 0 ? Math.floor(dias * 86400) : 7 * 86400;
  }

  /** emite um REFRESH token novo (nova FAMÍLIA) e persiste só o hash. Retorna o texto claro (vai 1x ao cliente). */
  private async emitirRefresh(db: AnyDB, codoperador: number, codempresa: number, ip: string | null): Promise<string> {
    const token = gerarRefreshToken();
    await db
      .insertInto('operadores_refresh_tokens')
      .values({ codoperador, codempresa, familia: randomUUID(), token_hash: hashRefreshToken(token), expira_em: sql`now() + make_interval(secs => ${this.refreshTtlSeg()})`, ip })
      .execute();
    return token;
  }

  /** lê um número de config GLOBAL (valor-base; o login é pré-empresa, sem override). Fallback no default. */
  private async cfgNum(db: AnyDB, codigo: string, def: number): Promise<number> {
    const r = (await db.selectFrom('configuracoes').select('valor').where('codigo', '=', codigo).executeTakeFirst()) as { valor?: unknown } | undefined;
    const n = r?.valor != null ? Number(String(r.valor).replace(',', '.')) : NaN;
    return Number.isFinite(n) ? n : def;
  }

  async login(dto: LoginDto, meta: AcessoMeta = {}): Promise<LoginResposta> {
    const tenant = this.tenant();
    const db = this.dbp.forTenant() as AnyDB;

    const op = (await db
      .selectFrom('operadores')
      .select(['codoperador', 'nome', 'login', 'desabilitado', 'senha_hash', 'solicitar_alteracao_senha', 'tentativas_login', 'bloqueado_ate'])
      .where(sql`upper(login)`, '=', dto.login.toUpperCase())
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as
      | { codoperador: number; nome: string | null; login: string | null; desabilitado: string | null; senha_hash: string | null; solicitar_alteracao_senha: string | null; tentativas_login: number | null; bloqueado_ate: unknown }
      | undefined;

    // corte-3c — LOCKOUT (endurecimento além do legado): conta conhecida BLOQUEADA recusa antes da senha. Se a
    // janela expirou, recomeça do zero. (Enumeração mínima consciente: revela que a conta existe+bloqueou — é
    // inerente ao lockout; padrão de UX de ERP interno.)
    if (op?.bloqueado_ate) {
      const ate = new Date(op.bloqueado_ate as string | number | Date).getTime();
      if (ate > Date.now()) {
        throw new ForbiddenActionError('OPERADOR_BLOQUEADO', { minutos: Math.max(1, Math.ceil((ate - Date.now()) / 60000)) });
      }
      await db.updateTable('operadores').set({ tentativas_login: 0, bloqueado_ate: null }).where('codoperador', '=', op.codoperador).execute();
      op.tentativas_login = 0;
      op.bloqueado_ate = null;
    }

    // fold B1: verifica SEMPRE um scrypt (contra o hash real OU o dummy) → tempo constante, sem oráculo de
    // existência de usuário. Credenciais inválidas (inexistente / senha errada / sem hash) → MESMA resposta.
    const senhaOk = verificarSenha(dto.senha, op?.senha_hash ?? DUMMY_HASH);
    if (!op || !senhaOk) {
      if (op) {
        // corte-3c: conta a falha e BLOQUEIA ao exceder o limite (config global). Auditoria LOGON_FAIL (conta conhecida).
        const max = await this.cfgNum(db, 'AUTH_MAX_TENTATIVAS_LOGIN', 5);
        const upd = (await db
          .updateTable('operadores')
          .set({ tentativas_login: sql`coalesce(tentativas_login,0) + 1` })
          .where('codoperador', '=', op.codoperador)
          .returning('tentativas_login')
          .executeTakeFirst()) as { tentativas_login?: number } | undefined;
        if (max > 0 && Number(upd?.tentativas_login ?? 0) >= max) {
          const bloqMin = await this.cfgNum(db, 'AUTH_BLOQUEIO_LOGIN_MINUTOS', 15);
          // secs (double) tolera config fracionária; make_interval(mins=>n) exigiria inteiro (fold #7).
          await db.updateTable('operadores').set({ bloqueado_ate: sql`now() + make_interval(secs => ${bloqMin * 60})` }).where('codoperador', '=', op.codoperador).execute();
        }
        await db.insertInto('operadores_acessos').values({ codoperador: op.codoperador, ip: meta.ip ?? null, nomecomputador: meta.nomecomputador ?? null, versao: meta.versao ?? null, tipo: 'LOGON_FAIL' }).execute();
      } else {
        // corte-3c: login DESCONHECIDO agora É auditado (codoperador nullable + login_tentativa) — a limitação do 3a.
        // slice(0,50) defensivo (o schema já limita a 50; belt-and-suspenders contra flood do log — fold #1).
        await db.insertInto('operadores_acessos').values({ codoperador: null, login_tentativa: dto.login.slice(0, 50), ip: meta.ip ?? null, nomecomputador: meta.nomecomputador ?? null, versao: meta.versao ?? null, tipo: 'LOGON_FAIL' }).execute();
      }
      throw new UnauthenticatedError('CREDENCIAIS_INVALIDAS');
    }

    // senha correta → zera o contador / desbloqueia (corte-3c).
    if (Number(op.tentativas_login ?? 0) !== 0 || op.bloqueado_ate != null) {
      await db.updateTable('operadores').set({ tentativas_login: 0, bloqueado_ate: null }).where('codoperador', '=', op.codoperador).execute();
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
      : signJwt({ tenant, sub: op.codoperador, emp: empresa }, this.nowSeg(), this.accessTtlSeg());
    // refresh só para sessão PLENA — o token `chg` (troca obrigatória) é restrito a /auth/* e não renova sozinho.
    const refresh = mustChange ? undefined : await this.emitirRefresh(db, op.codoperador, empresa, meta.ip ?? null);
    return {
      token,
      refresh,
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

  /**
   * RENOVA o access token a partir de um REFRESH válido (rota PÚBLICA — o access pode já ter expirado; o tenant vem
   * do header). ROTAÇÃO: revoga o refresh apresentado e emite um novo na MESMA família. DETECÇÃO DE REUSO: um refresh
   * já revogado apresentado = roubo → revoga a FAMÍLIA inteira e recusa (força re-login de todos os elos). Qualquer
   * falha retorna o MESMO 401 SESSAO_EXPIRADA (não-oráculo). Concorrência: o front deve serializar o refresh (um
   * único in-flight) — dois refreshes simultâneos do mesmo token disparam a detecção de reuso (limitação consciente).
   */
  async renovar(refreshPlain: string, meta: AcessoMeta = {}): Promise<LoginResposta> {
    const tenant = this.tenant();
    const db = this.dbp.forTenant() as AnyDB;
    const hash = hashRefreshToken(refreshPlain);
    const row = (await db
      .selectFrom('operadores_refresh_tokens')
      .select(['id', 'codoperador', 'codempresa', 'familia', 'expira_em', 'revogado_em'])
      .where('token_hash', '=', hash)
      .executeTakeFirst()) as { id: number; codoperador: number; codempresa: number | null; familia: string; expira_em: unknown; revogado_em: unknown } | undefined;
    if (!row) throw new UnauthenticatedError('SESSAO_EXPIRADA');

    // REUSO: refresh já revogado sendo reapresentado → possível roubo → revoga a FAMÍLIA inteira.
    if (row.revogado_em != null) {
      await db.updateTable('operadores_refresh_tokens').set({ revogado_em: sql`now()` }).where('familia', '=', row.familia).where('revogado_em', 'is', null).execute();
      throw new UnauthenticatedError('SESSAO_EXPIRADA');
    }
    if (new Date(row.expira_em as string | number | Date).getTime() <= Date.now()) throw new UnauthenticatedError('SESSAO_EXPIRADA');

    const revogarFamilia = () => db.updateTable('operadores_refresh_tokens').set({ revogado_em: sql`now()` }).where('familia', '=', row.familia).where('revogado_em', 'is', null).execute();

    const op = (await db
      .selectFrom('operadores')
      .select(['codoperador', 'nome', 'login', 'desabilitado', 'solicitar_alteracao_senha', 'bloqueado_ate'])
      .where('codoperador', '=', row.codoperador)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { codoperador: number; nome: string | null; login: string | null; desabilitado: string | null; solicitar_alteracao_senha: string | null; bloqueado_ate: unknown } | undefined;
    if (!op || op.desabilitado === 'S') {
      await revogarFamilia();
      throw new UnauthenticatedError('SESSAO_EXPIRADA');
    }
    // fold auditoria [BAIXA]: conta BLOQUEADA (corte-3c) não renova — força re-login (que devolve OPERADOR_BLOQUEADO).
    // Bloqueio é temporário → NÃO revoga a família (some ao expirar a janela). Sem cap absoluto de sessão (adiado).
    if (op.bloqueado_ate && new Date(op.bloqueado_ate as string | number | Date).getTime() > Date.now()) {
      throw new UnauthenticatedError('SESSAO_EXPIRADA');
    }
    // fold auditoria [MÉDIA]: troca obrigatória (fold M2 do login) NÃO pode ser burlada pelo refresh — recusa e força
    // re-login, que emite o token `chg` restrito a /auth/*. (Não revoga: o refresh só volta a valer após a troca+re-login.)
    if (op.solicitar_alteracao_senha === 'S') throw new UnauthenticatedError('SESSAO_EXPIRADA');

    // fold auditoria [ALTA]: a EMPRESA da sessão pode ter sido revogada (RELACAO_OPERADOR_EMPRESA) após o login —
    // o login recusaria (OPERADOR_SEM_EMPRESA); o refresh tem de recusar também, senão renova acesso à empresa perdida.
    const empresas = (await db
      .selectFrom('relacao_operador_empresa as r')
      .leftJoin('empresas as e', 'e.idempresa', 'r.codempresa')
      .select(['r.codempresa as idempresa', 'e.razao_social as nome'])
      .where('r.codoperador', '=', op.codoperador)
      .orderBy('r.codempresa')
      .execute()) as Array<{ idempresa: number; nome: string | null }>;
    const empresa = Number(row.codempresa);
    if (!empresas.some((x) => Number(x.idempresa) === empresa)) {
      await revogarFamilia();
      throw new UnauthenticatedError('SESSAO_EXPIRADA');
    }

    // fold auditoria [MÉDIA]: ROTAÇÃO ATÔMICA por CAS — revoga o atual só se AINDA ativo (WHERE revogado_em IS NULL).
    // Se 0 linhas, outra chamada já rotacionou este token (corrida/reuso) → detecta e revoga a família (sem dois elos).
    const upd = await db.updateTable('operadores_refresh_tokens').set({ revogado_em: sql`now()` }).where('id', '=', row.id).where('revogado_em', 'is', null).executeTakeFirst();
    if (Number((upd as { numUpdatedRows?: unknown })?.numUpdatedRows ?? 0) !== 1) {
      await revogarFamilia();
      throw new UnauthenticatedError('SESSAO_EXPIRADA');
    }
    const novoRefresh = gerarRefreshToken();
    await db
      .insertInto('operadores_refresh_tokens')
      .values({ codoperador: op.codoperador, codempresa: empresa, familia: row.familia, token_hash: hashRefreshToken(novoRefresh), expira_em: sql`now() + make_interval(secs => ${this.refreshTtlSeg()})`, ip: meta.ip ?? null })
      .execute();

    const token = signJwt({ tenant, sub: op.codoperador, emp: empresa }, this.nowSeg(), this.accessTtlSeg());
    return {
      token,
      refresh: novoRefresh,
      empresa,
      empresas,
      operador: { codoperador: op.codoperador, nome: op.nome, login: op.login },
      mustChangePassword: false, // troca obrigatória já foi barrada acima
    };
  }

  /** LOGOFF (auditoria) + REVOGA a família do refresh apresentado (mata a sessão de fato — o access stateless só some ao expirar). */
  async logout(meta: AcessoMeta = {}, refreshPlain?: string | null): Promise<{ ok: true }> {
    const ctx = currentTenant();
    const op = ctx.operadorId ?? null;
    if (op == null) throw new UnauthenticatedError('NAO_AUTENTICADO');
    const db = this.dbp.forTenant() as AnyDB;
    await db
      .insertInto('operadores_acessos')
      .values({ codoperador: op, codempresa: ctx.empresaId ?? null, ip: meta.ip ?? null, nomecomputador: meta.nomecomputador ?? null, versao: meta.versao ?? null, tipo: 'LOGOFF' })
      .execute();
    if (refreshPlain) {
      // revoga a FAMÍLIA do refresh apresentado (o access stateless expira sozinho; sem refresh não há renovação).
      // fold auditoria [BAIXA]: só revoga se a família for do PRÓPRIO operador da sessão (não deixa A matar sessão de B).
      const fam = (await db.selectFrom('operadores_refresh_tokens').select(['familia', 'codoperador']).where('token_hash', '=', hashRefreshToken(refreshPlain)).executeTakeFirst()) as { familia?: string; codoperador?: number } | undefined;
      if (fam?.familia && Number(fam.codoperador) === op) {
        await db.updateTable('operadores_refresh_tokens').set({ revogado_em: sql`now()` }).where('familia', '=', fam.familia).where('revogado_em', 'is', null).execute();
      }
    }
    return { ok: true };
  }
}
