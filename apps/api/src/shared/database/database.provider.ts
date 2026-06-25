import { Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { TenantDB } from './db-types';
import { currentTenant } from '../tenant/tenant-context';

export interface PgConnInfo {
  host: string;
  port: number;
  user: string;
  password: string;
  databasePrefix: string; // banco do tenant = prefix + tenantId
}

function connFromEnv(): PgConnInfo {
  return {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'apollo',
    password: process.env.PGPASSWORD ?? 'apollo',
    databasePrefix: process.env.PG_TENANT_PREFIX ?? 'apollo_tenant_',
  };
}

/**
 * Pool no compute, silo no dado (ADR-004): UMA frota serve todos os tenants,
 * roteando por tenant para o BANCO certo (db-per-tenant). Um pool Kysely por tenant,
 * cacheado. forTenant() = primário; forTenantRead() = réplica (mesmo banco nesta fatia).
 */
@Injectable()
export class DatabaseProvider implements OnModuleDestroy {
  private readonly pools = new Map<string, Kysely<TenantDB>>();

  async onModuleDestroy(): Promise<void> {
    await this.closeAll();
  }

  private readonly conn: PgConnInfo;

  // @Optional: o Nest injeta undefined (PgConnInfo é interface, sem token DI) →
  // caímos no env. Em testes, instanciamos com `new DatabaseProvider(PG_CONN)`.
  constructor(@Optional() conn?: PgConnInfo) {
    this.conn = conn ?? connFromEnv();
  }

  forTenant(): Kysely<TenantDB> {
    return this.dbFor(currentTenant().tenantId);
  }

  /** Leitura pesada → réplica (ADR-007). Nesta fatia aponta ao mesmo banco. */
  forTenantRead(): Kysely<TenantDB> {
    return this.dbFor(currentTenant().tenantId);
  }

  /** Acesso direto por tenant (usado em scripts/seed/migrate, fora de request). */
  dbFor(tenantId: string): Kysely<TenantDB> {
    let db = this.pools.get(tenantId);
    if (!db) {
      db = new Kysely<TenantDB>({
        dialect: new PostgresDialect({
          pool: new Pool({
            host: this.conn.host,
            port: this.conn.port,
            user: this.conn.user,
            password: this.conn.password,
            database: this.conn.databasePrefix + tenantId,
            max: 10,
          }),
        }),
      });
      this.pools.set(tenantId, db);
    }
    return db;
  }

  async closeAll(): Promise<void> {
    for (const db of this.pools.values()) await db.destroy();
    this.pools.clear();
  }
}
