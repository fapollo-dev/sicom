import { Kysely, sql } from 'kysely';
import type { TenantDB, BancosTable } from '../../shared/database/db-types';

/**
 * Builders PUROS de query (recebem um Kysely<TenantDB>, retornam a query SEM executar).
 * Espelham os golden capturados do legado em runtime
 * (ver dossiê uCadBancos §4/§9, `pinheirao@dbhomologacao` 2026-06-24):
 *   - read:   select * from BANCOS B where B.CODBCO = :Codigo
 *   - list:   select ...,GET_BANCOS.* from GET_BANCOS
 *   - insert: insert into "BANCOS" (<colunas tocadas>) values (...)        (delta)
 *   - stamp:  UPDATE BANCOS SET USULTALTERACAO=, DTULTIMALTERACAO=[, DTCADASTRO=] WHERE CODBCO=
 *   - update: update "BANCOS" set "<col>"=:1 where "CODBCO"=:2             (delta)
 *   - delete: delete from "BANCOS" where "CODBCO"=:1
 * Testáveis por `.compile().sql` (paridade de SQL — o "verde que vale").
 */

/** Colunas editáveis pelo usuário (sem PK nem auditoria). */
export type BancoUserCols = Partial<
  Pick<
    BancosTable,
    | 'agencia'
    | 'banco'
    | 'cidade'
    | 'uf'
    | 'agencia_cedente'
    | 'codbcoblt'
    | 'convenio'
    | 'carteira_cobranca'
    | 'variacao_carteira'
  >
>;

export const qReadByCodbco = (db: Kysely<TenantDB>, codbco: number) =>
  db.selectFrom('bancos').selectAll().where('codbco', '=', codbco);

export const qList = (db: Kysely<TenantDB>) =>
  db.selectFrom('get_bancos').selectAll();

/** INSERT delta: só as colunas fornecidas. Retorna a PK gerada (sequence). */
export const qInsertUser = (db: Kysely<TenantDB>, values: BancoUserCols) =>
  db.insertInto('bancos').values(values as any).returning('codbco');

/** UPDATE delta: só as colunas alteradas. */
export const qUpdateUser = (
  db: Kysely<TenantDB>,
  codbco: number,
  values: BancoUserCols,
) => db.updateTable('bancos').set(values as any).where('codbco', '=', codbco);

export const qDelete = (db: Kysely<TenantDB>, codbco: number) =>
  db.deleteFrom('bancos').where('codbco', '=', codbco);

/** Carimbo de auditoria (statement separado, igual ao legado SetaOperadorAlteracao). */
export const qStampAudit = (
  db: Kysely<TenantDB>,
  codbco: number,
  operadorId: number | null,
  isInsert: boolean,
) =>
  db
    .updateTable('bancos')
    .set({
      usultalteracao: operadorId,
      dtultimalteracao: sql`now()`,
      ...(isInsert ? { dtcadastro: sql`now()` } : {}),
    } as any)
    .where('codbco', '=', codbco);

/** Evento de replicação no outbox (espelha REM_BANCOS→REMESSA_SERVER). */
export const qOutbox = (
  db: Kysely<TenantDB>,
  tipo: 'INSERT' | 'UPDATE' | 'DELETE',
  codbco: number,
) =>
  db.insertInto('outbox').values({
    tipo,
    tabela: 'BANCOS',
    chave: codbco,
    campochave: 'CODBCO',
    instrucao:
      tipo === 'DELETE'
        ? `DELETE FROM BANCOS WHERE CODBCO =${codbco}`
        : `SELECT * FROM BANCOS WHERE CODBCO =${codbco}`,
  } as any);
