import { Injectable } from '@nestjs/common';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { gravarHistorico, gravarHistoricoMarca, type HistoricoAlvo } from '../../shared/crud/historico';
import {
  BancoUserCols,
  qDelete,
  qInsertUser,
  qList,
  qOutbox,
  qReadByCodbco,
  qStampAudit,
  qUpdateUser,
} from './banco.queries';

/** alvo do HISTORICO_DINAMICO para BANCOS (mesmo caminho do engine declarativo). */
const HIST_BANCOS: HistoricoAlvo = { tabela: 'bancos', pk: 'codbco', origem: 'FRMCADBANCOS' };

/**
 * Acesso a dados de BANCOS. Espelha o comportamento capturado do legado:
 * escrita = DML delta + carimbo de auditoria (statement separado) + evento de
 * replicação no outbox, TUDO na MESMA transação (no legado a transação era global;
 * aqui é escopada ao caso de uso — hidden-coupling-traps.md).
 */
@Injectable()
export class BancoRepository {
  constructor(private readonly dbp: DatabaseProvider) {}

  read(codbco: number) {
    return qReadByCodbco(this.dbp.forTenantRead(), codbco).executeTakeFirst();
  }

  list() {
    return qList(this.dbp.forTenantRead()).execute();
  }

  /** INSERT delta → carimbo → histórico → outbox(INSERT). Retorna o codbco gerado. */
  async create(values: BancoUserCols): Promise<number> {
    const operadorId = currentTenant().operadorId ?? null;
    const empresaId = currentTenant().empresaId ?? null;
    return this.dbp.forTenant().transaction().execute(async (trx) => {
      const ins = await qInsertUser(trx, values).executeTakeFirstOrThrow();
      const codbco = Number(ins.codbco);
      await qStampAudit(trx, codbco, operadorId, true).execute();
      await gravarHistorico(trx, HIST_BANCOS, codbco, operadorId, empresaId, {}, values, 'INSERT');
      await qOutbox(trx, 'INSERT', codbco).execute();
      return codbco;
    });
  }

  /** UPDATE delta → carimbo → histórico (diff) → outbox(UPDATE). */
  async update(codbco: number, values: BancoUserCols): Promise<void> {
    const operadorId = currentTenant().operadorId ?? null;
    const empresaId = currentTenant().empresaId ?? null;
    await this.dbp.forTenant().transaction().execute(async (trx) => {
      // lê o estado anterior ANTES do update (diff campo-a-campo p/ o histórico)
      const antes = (await qReadByCodbco(trx, codbco).executeTakeFirst()) ?? {};
      await qUpdateUser(trx, codbco, values).execute();
      await qStampAudit(trx, codbco, operadorId, false).execute();
      await gravarHistorico(trx, HIST_BANCOS, codbco, operadorId, empresaId, antes as Record<string, unknown>, values, 'UPDATE');
      await qOutbox(trx, 'UPDATE', codbco).execute();
    });
  }

  /** DELETE físico (BANCOS não tem INDR → hard delete) → histórico(DELETE) → outbox(DELETE). */
  async remove(codbco: number): Promise<void> {
    const operadorId = currentTenant().operadorId ?? null;
    const empresaId = currentTenant().empresaId ?? null;
    await this.dbp.forTenant().transaction().execute(async (trx) => {
      await qDelete(trx, codbco).execute();
      await gravarHistoricoMarca(trx, HIST_BANCOS, codbco, operadorId, empresaId, 'DELETE');
      await qOutbox(trx, 'DELETE', codbco).execute();
    });
  }
}
