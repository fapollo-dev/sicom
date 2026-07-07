import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * PEDIDO DE COMPRA — serviço VERTICAL das transições de ESTADO (o CRUD do agregado é o
 * AggregateEngineService). Workflow do legado: rascunho (FECHADO='N') → fechado (FECHADO='S').
 * `fechar` confirma o pedido (exige ao menos 1 item); depois disso o agregado bloqueia edição/
 * exclusão (validar/validarRemocao). `reabrir` volta p/ rascunho (bloqueado se já faturado — a NF de
 * entrada é corte futuro; a guarda fica de pé). Tenant por IDEMPRESA + operador, fail-closed.
 */
@Injectable()
export class PedidoCompraService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number {
    const o = currentTenant().operadorId ?? null;
    if (o == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return o;
  }

  /** fecha o pedido (N→S): exige ≥1 item; CAS em FECHADO p/ evitar duplo-fechamento concorrente. */
  async fechar(codpedcomp: number): Promise<{ codpedcomp: number; fechado: 'S' }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await trx
        .selectFrom('pedidocompra')
        .select(['codpedcomp', 'fechado'])
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E') // pedido excluído (soft-delete) é inexistente
        .forUpdate()
        .executeTakeFirst();
      if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
      if ((pc as any).fechado === 'S') throw new BusinessRuleError('PEDIDO_JA_FECHADO', { codpedcomp });

      const itens = await trx
        .selectFrom('pedidocompra_i')
        .select(({ fn }: any) => [fn.count('codpedcompi').as('n')])
        .where('codpedcomp', '=', codpedcomp)
        .executeTakeFirst();
      if (Number((itens as any)?.n ?? 0) === 0) throw new BusinessRuleError('PEDIDO_SEM_ITENS', { codpedcomp });

      const upd = await trx
        .updateTable('pedidocompra')
        .set({ fechado: 'S', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where((eb: any) => eb.or([eb('fechado', '<>', 'S'), eb('fechado', 'is', null)]))
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('PEDIDO_JA_FECHADO', { codpedcomp });
      return { codpedcomp, fechado: 'S' as const };
    });
  }

  /** reabre o pedido (S→N): bloqueado se já faturado (NF de entrada = corte futuro; guarda de pé). */
  async reabrir(codpedcomp: number): Promise<{ codpedcomp: number; fechado: 'N' }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await trx
        .selectFrom('pedidocompra')
        .select(['codpedcomp', 'fechado', 'dtfaturamento'])
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E') // pedido excluído (soft-delete) é inexistente
        .forUpdate()
        .executeTakeFirst();
      if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
      if ((pc as any).fechado !== 'S') throw new BusinessRuleError('PEDIDO_NAO_FECHADO', { codpedcomp });
      if ((pc as any).dtfaturamento != null) throw new BusinessRuleError('PEDIDO_FATURADO', { codpedcomp });

      // CAS em FECHADO (cinto-e-suspensório com o forUpdate) — padrão do repo (caixa.reabrir).
      const upd = await trx
        .updateTable('pedidocompra')
        .set({ fechado: 'N', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where('fechado', '=', 'S')
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('PEDIDO_NAO_FECHADO', { codpedcomp });
      return { codpedcomp, fechado: 'N' as const };
    });
  }
}
