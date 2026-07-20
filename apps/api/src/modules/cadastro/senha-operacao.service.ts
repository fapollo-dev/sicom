import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TipoSenhaOperacao } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { hashSenha, verificarSenha, DUMMY_HASH } from '../../shared/auth/crypto';

type AnyDB = any;

const COLUNA: Record<TipoSenhaOperacao, string> = {
  admin: 'senha_admin_hash',
  desc: 'senha_desc_hash',
  cancel: 'senha_cancel_hash',
  gaveta: 'senha_gaveta_hash',
};

/**
 * SENHA DE OPERAÇÃO por empresa (E7). O admin define (hash scrypt, não a cifra César do legado); ações sensíveis
 * verificam. A senha é da EMPRESA corrente (currentTenant). verificar SEMPRE roda um scrypt (timing-safe, DUMMY_HASH)
 * e não distingue "não configurada" de "senha errada" (não vira oráculo). Consumidores (desconto/cancelamento/
 * estorno/gaveta) chamam `verificar` como gate — o wire por ação é o corte-2.
 */
@Injectable()
export class SenhaOperacaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** lê um número de config GLOBAL (fallback no default) — igual ao AuthService.cfgNum. */
  private async cfgNum(db: AnyDB, codigo: string, def: number): Promise<number> {
    const r = (await db.selectFrom('configuracoes').select('valor').where('codigo', '=', codigo).executeTakeFirst()) as { valor?: unknown } | undefined;
    const n = r?.valor != null ? Number(String(r.valor).replace(',', '.')) : NaN;
    return Number.isFinite(n) ? n : def;
  }

  /** admin define a senha de operação de um tipo (hash). */
  async definir(tipo: TipoSenhaOperacao, senha: string): Promise<{ tipo: TipoSenhaOperacao }> {
    const op = currentTenant().operadorId ?? null;
    const emp = this.emp();
    const r = await (this.dbp.forTenant() as AnyDB)
      .updateTable('empresas')
      .set({ [COLUNA[tipo]]: hashSenha(senha), usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('idempresa', '=', emp)
      .executeTakeFirst();
    if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('EMPRESA_NAO_ENCONTRADA', { idempresa: emp });
    return { tipo };
  }

  /**
   * verifica a senha de operação de um tipo contra o hash da empresa. Timing-safe (sempre roda scrypt); não-configurada
   * → false (não conta no lockout — não há segredo p/ força-bruta). LOCKOUT por (empresa, tipo) (fast-follow, espelha o
   * corte-3c): bloqueada → 422 SENHA_OPERACAO_BLOQUEADA; N falhas → bloqueia M min; correta → zera; janela expirada recomeça.
   */
  async verificar(tipo: TipoSenhaOperacao, senha: string): Promise<{ ok: boolean }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB; // write: o lockout incrementa/zera o contador

    // lockout: (empresa, tipo) bloqueado recusa ANTES de verificar. Janela expirada → recomeça (zera abaixo, no fluxo).
    const lk = (await db
      .selectFrom('empresas_senha_lockout')
      .select(['tentativas', 'bloqueado_ate'])
      .where('idempresa', '=', emp)
      .where('tipo', '=', tipo)
      .executeTakeFirst()) as { tentativas?: number; bloqueado_ate?: unknown } | undefined;
    if (lk?.bloqueado_ate && new Date(lk.bloqueado_ate as string | number | Date).getTime() > Date.now()) {
      const ate = new Date(lk.bloqueado_ate as string | number | Date).getTime();
      throw new BusinessRuleError('SENHA_OPERACAO_BLOQUEADA', { tipo, minutos: Math.max(1, Math.ceil((ate - Date.now()) / 60000)) });
    }

    const row = (await db
      .selectFrom('empresas')
      .select([COLUNA[tipo] + ' as hash'])
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as { hash?: string | null } | undefined;
    const ok = !!row?.hash && verificarSenha(senha, row?.hash ?? DUMMY_HASH); // sempre roda scrypt (anti-timing)

    if (ok) {
      // correta → zera o contador/desbloqueio (se havia).
      if (lk && (Number(lk.tentativas ?? 0) !== 0 || lk.bloqueado_ate != null)) {
        await db.updateTable('empresas_senha_lockout').set({ tentativas: 0, bloqueado_ate: null, updated_at: sql`now()` }).where('idempresa', '=', emp).where('tipo', '=', tipo).execute();
      }
      return { ok: true };
    }
    // senha NÃO configurada → false, mas NÃO conta (não há segredo real p/ força-bruta).
    if (!row?.hash) return { ok: false };

    // errada → incrementa (upsert) e bloqueia ao exceder o limite (config global).
    const max = await this.cfgNum(db, 'AUTH_MAX_TENTATIVAS_SENHA_OPERACAO', 5);
    const upd = (await db
      .insertInto('empresas_senha_lockout')
      .values({ idempresa: emp, tipo, tentativas: 1, updated_at: sql`now()` })
      .onConflict((oc: AnyDB) => oc.columns(['idempresa', 'tipo']).doUpdateSet({ tentativas: sql`empresas_senha_lockout.tentativas + 1`, updated_at: sql`now()` }))
      .returning('tentativas')
      .executeTakeFirst()) as { tentativas?: number } | undefined;
    if (max > 0 && Number(upd?.tentativas ?? 0) >= max) {
      const bloqMin = await this.cfgNum(db, 'AUTH_BLOQUEIO_SENHA_OPERACAO_MINUTOS', 15);
      await db.updateTable('empresas_senha_lockout').set({ bloqueado_ate: sql`now() + make_interval(secs => ${bloqMin * 60})` }).where('idempresa', '=', emp).where('tipo', '=', tipo).execute();
    }
    return { ok: false };
  }
}
