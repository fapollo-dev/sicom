import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import type { ItemLoteDto } from '@apollo/shared';

interface HeaderCols {
  codparceiro?: number;
  data?: string;
}

/**
 * Repository MESTRE-DETALHE (LOTE_COBRANCA + ITENS_LOTECOB).
 * O agregado (header + itens) é gravado/excluído numa ÚNICA transação — espelha
 * `TfrmCadMasterDet` (form-base): valida/grava itens junto do master; exclusão
 * em cascata. (No alvo a transação é escopada ao caso de uso, não global.)
 */
@Injectable()
export class LoteCobrancaRepository {
  constructor(private readonly dbp: DatabaseProvider) {}

  list() {
    return this.dbp.forTenantRead().selectFrom('get_lote_cobranca').selectAll().execute();
  }

  async read(cod: number) {
    const db = this.dbp.forTenantRead();
    const header = await db
      .selectFrom('lote_cobranca')
      .selectAll()
      .where('codlotecob', '=', cod)
      .executeTakeFirst();
    if (!header) return undefined;
    const itens = await db
      .selectFrom('itens_lotecob')
      .select(['codilotcob', 'codrcb'])
      .where('codlotecob', '=', cod)
      .orderBy('codilotcob')
      .execute();
    return { ...header, itens };
  }

  /** Cria o agregado: header + N itens, numa transação. Retorna codlotecob. */
  async create(header: HeaderCols, itens: ItemLoteDto[]): Promise<number> {
    const operadorId = currentTenant().operadorId ?? null;
    return this.dbp.forTenant().transaction().execute(async (trx) => {
      const ins = await trx
        .insertInto('lote_cobranca')
        .values(header as any)
        .returning('codlotecob')
        .executeTakeFirstOrThrow();
      const cod = Number(ins.codlotecob);
      await trx
        .updateTable('lote_cobranca')
        .set({ usultalteracao: operadorId, dtultimalteracao: sql`now()`, dtcadastro: sql`now()` } as any)
        .where('codlotecob', '=', cod)
        .execute();
      if (itens.length) {
        await trx
          .insertInto('itens_lotecob')
          .values(itens.map((i) => ({ codlotecob: cod, codrcb: i.codrcb })))
          .execute();
      }
      return cod;
    });
  }

  /** Atualiza header e SUBSTITUI os itens (delete+insert), numa transação. */
  async update(cod: number, header: HeaderCols, itens: ItemLoteDto[]): Promise<void> {
    const operadorId = currentTenant().operadorId ?? null;
    await this.dbp.forTenant().transaction().execute(async (trx) => {
      if (Object.keys(header).length) {
        await trx.updateTable('lote_cobranca').set(header as any).where('codlotecob', '=', cod).execute();
      }
      await trx
        .updateTable('lote_cobranca')
        .set({ usultalteracao: operadorId, dtultimalteracao: sql`now()` } as any)
        .where('codlotecob', '=', cod)
        .execute();
      await trx.deleteFrom('itens_lotecob').where('codlotecob', '=', cod).execute();
      if (itens.length) {
        await trx
          .insertInto('itens_lotecob')
          .values(itens.map((i) => ({ codlotecob: cod, codrcb: i.codrcb })))
          .execute();
      }
    });
  }

  /** Exclui o agregado em cascata (itens + header). */
  async remove(cod: number): Promise<void> {
    await this.dbp.forTenant().transaction().execute(async (trx) => {
      await trx.deleteFrom('itens_lotecob').where('codlotecob', '=', cod).execute();
      await trx.deleteFrom('lote_cobranca').where('codlotecob', '=', cod).execute();
    });
  }
}
