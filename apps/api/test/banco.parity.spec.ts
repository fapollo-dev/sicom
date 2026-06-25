import { describe, it, expect } from 'vitest';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { TenantDB } from '../src/shared/database/db-types';
import {
  qDelete,
  qInsertUser,
  qList,
  qOutbox,
  qReadByCodbco,
  qStampAudit,
  qUpdateUser,
} from '../src/modules/cadastro/banco.queries';

/**
 * Paridade de SQL — compara o SQL emitido pelos builders com os GOLDEN capturados
 * do legado em execução (dossiê uCadBancos §4/§9). Não precisa de banco: usa
 * Kysely.compile() (offline). É o "verde que vale" do piloto no lado da escrita/leitura.
 */
// Kysely só para compilar (o Pool nunca abre conexão em .compile()).
const db = new Kysely<TenantDB>({ dialect: new PostgresDialect({ pool: new Pool({}) }) });
const sqlOf = (q: { compile: () => { sql: string } }) => q.compile().sql;

describe('Paridade SQL — Cadastro de Bancos (vs golden do legado)', () => {
  it('READ por código — golden: select * from BANCOS where CODBCO = :Codigo', () => {
    expect(sqlOf(qReadByCodbco(db, 740))).toBe(
      'select * from "bancos" where "codbco" = $1',
    );
  });

  it('LIST/pesquisa — golden: select ... from GET_BANCOS', () => {
    expect(sqlOf(qList(db))).toBe('select * from "get_bancos"');
  });

  it('INSERT é DELTA (só colunas tocadas) — golden: insert into BANCOS (AGENCIA,BANCO,CIDADE,AGENCIA_CEDENTE) values (...)', () => {
    const q = qInsertUser(db, {
      agencia: '9999',
      banco: 'TESTE CLAUDE',
      cidade: 'TESTE',
      agencia_cedente: 1,
    });
    expect(sqlOf(q)).toBe(
      'insert into "bancos" ("agencia", "banco", "cidade", "agencia_cedente") values ($1, $2, $3, $4) returning "codbco"',
    );
  });

  it('UPDATE é DELTA (só coluna alterada) — golden: update BANCOS set CIDADE=:1 where CODBCO=:2', () => {
    expect(sqlOf(qUpdateUser(db, 740, { cidade: 'TESTE2' }))).toBe(
      'update "bancos" set "cidade" = $1 where "codbco" = $2',
    );
  });

  it('DELETE físico por chave — golden: delete from BANCOS where CODBCO=:1', () => {
    expect(sqlOf(qDelete(db, 740))).toBe(
      'delete from "bancos" where "codbco" = $1',
    );
  });

  it('Carimbo de auditoria = statement separado (golden: UPDATE ... USULTALTERACAO, DTULTIMALTERACAO)', () => {
    expect(sqlOf(qStampAudit(db, 740, 1, false))).toBe(
      'update "bancos" set "usultalteracao" = $1, "dtultimalteracao" = now() where "codbco" = $2',
    );
    // no INSERT, carimba também DTCADASTRO
    expect(sqlOf(qStampAudit(db, 740, 1, true))).toBe(
      'update "bancos" set "usultalteracao" = $1, "dtultimalteracao" = now(), "dtcadastro" = now() where "codbco" = $2',
    );
  });

  it('Outbox de replicação (espelha REM_BANCOS→REMESSA_SERVER)', () => {
    expect(sqlOf(qOutbox(db, 'INSERT', 740))).toBe(
      'insert into "outbox" ("tipo", "tabela", "chave", "campochave", "instrucao") values ($1, $2, $3, $4, $5)',
    );
  });
});
