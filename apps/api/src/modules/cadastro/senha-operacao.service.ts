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

  /** verifica a senha de operação de um tipo contra o hash da empresa. Timing-safe; não-configurada → false. */
  async verificar(tipo: TipoSenhaOperacao, senha: string): Promise<{ ok: boolean }> {
    const emp = this.emp();
    const row = (await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('empresas')
      .select([COLUNA[tipo] + ' as hash'])
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as { hash?: string | null } | undefined;
    const ok = verificarSenha(senha, row?.hash ?? DUMMY_HASH); // sempre roda (anti-timing); sem hash → DUMMY → false
    return { ok: !!row?.hash && ok };
  }
}
