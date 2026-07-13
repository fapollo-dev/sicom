import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto de tenant request-scoped (ADR-003/004, seção 02).
 * Substitui a global mutável `EmpresaAtual` do legado por um contexto isolado
 * por request — fail-closed: sem tenant, LANÇA (nunca assume default).
 */
export interface TenantCtx {
  tenantId: string;
  operadorId?: number;
  empresaId?: number;
  /** true quando o operador precisa TROCAR a senha (claim `chg` do JWT) — bloqueia rotas ≠ /auth (fold M2). */
  mustChange?: boolean;
}

export const tenantStore = new AsyncLocalStorage<TenantCtx>();

export function runWithTenant<T>(ctx: TenantCtx, fn: () => T): T {
  return tenantStore.run(ctx, fn);
}

/** Fail-closed: a única porta para saber o tenant corrente. */
export function currentTenant(): TenantCtx {
  const ctx = tenantStore.getStore();
  if (!ctx) throw new Error('TENANT_CONTEXT_MISSING');
  return ctx;
}
