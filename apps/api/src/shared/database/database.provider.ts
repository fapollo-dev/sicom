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
      const pool = new Pool({
        host: this.conn.host,
        port: this.conn.port,
        user: this.conn.user,
        password: this.conn.password,
        database: this.conn.databasePrefix + tenantId,
        max: 10,
        // o fuso da SESSÃO é o da loja: `current_date`, `::date` de timestamptz e `to_char` respondem no dia da loja, qualquer que seja o
        // fuso do servidor (num Postgres em UTC, das 21h à meia-noite o `current_date` já seria amanhã — o atraso, o vencimento e o período
        // pulariam um dia). O legado grava a hora local nas colunas DATE/TIMESTAMP; `APOLLO_DB_TIMEZONE` troca, se um dia houver loja em outro fuso.
        options: `-c TimeZone=${process.env.APOLLO_DB_TIMEZONE ?? 'America/Sao_Paulo'}`,
      });
      // a conexão OCIOSA que o servidor derruba (reinício, failover, "terminating connection due to administrator command") chega como
      // 'error' no pool — sem ouvinte, o Node derruba o processo inteiro; o pg-pool já descarta o cliente e a próxima consulta reconecta
      pool.on('error', (err) => console.warn(`[db:${tenantId}] conexão ociosa encerrada pelo servidor: ${err.message}`));
      db = new Kysely<TenantDB>({ dialect: new PostgresDialect({ pool }) });
      this.pools.set(tenantId, db);
    }
    return db;
  }

  /**
   * os tenants deste servidor, para as tarefas que rodam fora de request (o agendador da vigência da agenda de promoção):
   * `APOLLO_TENANTS` (lista separada por vírgula) ou, sem ela, os bancos com o prefixo de tenant no Postgres.
   */
  async listarTenants(): Promise<string[]> {
    const env = (process.env.APOLLO_TENANTS ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    if (env.length) return env;
    const pool = new Pool({ host: this.conn.host, port: this.conn.port, user: this.conn.user, password: this.conn.password, database: 'postgres', max: 1 });
    try {
      const r = await pool.query<{ datname: string }>(`SELECT datname FROM pg_database WHERE datname LIKE $1 AND NOT datistemplate ORDER BY datname`, [`${this.conn.databasePrefix}%`]);
      return r.rows.map((x) => x.datname.slice(this.conn.databasePrefix.length)).filter(Boolean);
    } finally {
      await pool.end();
    }
  }

  async closeAll(): Promise<void> {
    for (const db of this.pools.values()) await db.destroy();
    this.pools.clear();
  }
}
