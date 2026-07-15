import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * AGENDA DE PROMOÇÃO — serviço VERTICAL do workflow (o CRUD é o AggregateEngineService). corte-1: ENCERRAR
 * (aberta → encerrada, grava dtencerramento+operador) e REABRIR (encerrada → aberta). No corte-1 SEM efeito;
 * o corte-2 (aplicação ao multi_preco) usa estas transições p/ ligar/desligar o preço promocional.
 * CAS em dtencerramento (anti-corrida). Tenant fail-closed.
 */
@Injectable()
export class AgendaPromocaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number | null {
    return currentTenant().operadorId ?? null;
  }

  /** encerra a agenda (aberta → encerrada). CAS: só encerra se dtencerramento IS NULL. */
  async encerrar(codagenda: number): Promise<{ codagenda: number; situacao: 'ENCERRADA' }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const ap = await trx
        .selectFrom('agenda_promocao')
        .select(['dtencerramento'])
        .where('codagenda', '=', codagenda)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .forUpdate()
        .executeTakeFirst();
      if (!ap) throw new BusinessRuleError('PROMOCAO_NAO_ENCONTRADA', { codagenda });
      if (ap.dtencerramento != null) throw new BusinessRuleError('PROMOCAO_JA_ENCERRADA', { codagenda });
      const r = await trx
        .updateTable('agenda_promocao')
        .set({ dtencerramento: sql`now()`, codoperadorenc: op, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codagenda', '=', codagenda)
        .where('idempresa', '=', emp)
        .where('dtencerramento', 'is', null)
        .executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('PROMOCAO_JA_ENCERRADA', { codagenda });
      return { codagenda, situacao: 'ENCERRADA' as const };
    });
  }

  /** reabre a agenda (encerrada → aberta). CAS: só reabre se dtencerramento IS NOT NULL. */
  async reabrir(codagenda: number): Promise<{ codagenda: number; situacao: 'ABERTA' }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const ap = await trx
        .selectFrom('agenda_promocao')
        .select(['dtencerramento'])
        .where('codagenda', '=', codagenda)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .forUpdate()
        .executeTakeFirst();
      if (!ap) throw new BusinessRuleError('PROMOCAO_NAO_ENCONTRADA', { codagenda });
      if (ap.dtencerramento == null) throw new BusinessRuleError('PROMOCAO_NAO_ENCERRADA', { codagenda });
      const r = await trx
        .updateTable('agenda_promocao')
        .set({ dtencerramento: null, codoperadorenc: null, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codagenda', '=', codagenda)
        .where('idempresa', '=', emp)
        .where('dtencerramento', 'is not', null)
        .executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('PROMOCAO_NAO_ENCERRADA', { codagenda });
      return { codagenda, situacao: 'ABERTA' as const };
    });
  }
}
