import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { gravarHistorico } from '../../shared/crud/historico';

type AnyDB = Kysely<any>;
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const ALVO_MP = { tabela: 'multi_preco', pk: 'idproduto', origem: 'FRMAGENDAPROMOCAO' };

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
      // corte-2 (reversão fiel a uCadAgendaPromocao:750): desliga o preço promocional que ESTA agenda ligou
      // (só as linhas com codagenda=esta — não toca promoções de outra campanha). vrpromo volta a null.
      await trx
        .updateTable('multi_preco')
        .set({ promocao: 'N', vrpromo: null, codagenda: null, dtultprecoalterado: sql`now()` })
        .where('codagenda', '=', codagenda)
        .where('idempresa', '=', emp)
        .execute();
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

  /**
   * corte-2 — APLICAR o preço promocional (uCadAgendaPromocao:247): p/ cada item ATIVO, grava no MULTI_PRECO
   * vigente da empresa `PROMOCAO='S', VRPROMO=VLRPROMOCAO, CODAGENDA=<agenda>`. O CODAGENDA marca a origem p/
   * a reversão precisa (encerrar). Só produtos com preço na empresa (linha em multi_preco) são afetados.
   * A ativação/desativação AUTOMÁTICA por período (scheduler em dtini/dtfim) e o efeito no PDV são adiados —
   * aqui é a aplicação MANUAL pelo operador (molde do atualizar-precos do pedido). Agenda encerrada não aplica.
   */
  async aplicar(codagenda: number): Promise<{ codagenda: number; aplicados: number }> {
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
      if (ap.dtencerramento != null) throw new BusinessRuleError('PROMOCAO_ENCERRADA', { codagenda });

      const itens = (await trx
        .selectFrom('agenda_promocao_itens')
        .select(['idproduto', 'vlrpromocao'])
        .where('codagenda', '=', codagenda)
        .where('ativo', '=', 'S')
        .execute()) as Array<{ idproduto: number; vlrpromocao: unknown }>;

      let aplicados = 0;
      for (const it of itens) {
        const mp = (await trx
          .selectFrom('multi_preco')
          .select(['id_multi_preco', 'vrpromo', 'promocao'])
          .where('idproduto', '=', it.idproduto)
          .where('idempresa', '=', emp)
          .executeTakeFirst()) as { id_multi_preco: number; vrpromo?: unknown; promocao?: string } | undefined;
        if (!mp) continue; // produto sem preço na empresa → não há linha p/ aplicar (fiel ao INNER do legado)
        const promo = num(it.vlrpromocao);
        await trx
          .updateTable('multi_preco')
          .set({ promocao: 'S', vrpromo: promo, codagenda, dtultprecoalterado: sql`now()` })
          .where('id_multi_preco', '=', mp.id_multi_preco)
          .execute();
        await gravarHistorico(
          trx, ALVO_MP, it.idproduto, op, emp,
          { promocao: mp.promocao ?? 'N', vrpromo: num(mp.vrpromo) },
          { promocao: 'S', vrpromo: promo, codagenda },
          'UPDATE',
        );
        aplicados++;
      }
      return { codagenda, aplicados };
    });
  }

  /** desliga o preço promocional que ESTA agenda ligou (revert do multi_preco) SEM encerrá-la (dtencerramento
   *  intacto) — a agenda só saiu da vigência (dtfim passou), não foi cancelada. Fiel à reversão do encerrar. */
  private async desaplicar(codagenda: number): Promise<void> {
    const emp = this.emp();
    await (this.dbp.forTenant() as AnyDB)
      .updateTable('multi_preco')
      .set({ promocao: 'N', vrpromo: null, codagenda: null, dtultprecoalterado: sql`now()` })
      .where('codagenda', '=', codagenda)
      .where('idempresa', '=', emp)
      .execute();
  }

  /**
   * SCHEDULER de VIGÊNCIA (efeito automático da agenda) — liga/desliga o preço promocional conforme a JANELA
   * [dtinicio, dtfim) de cada agenda ABERTA da empresa, sem intervenção manual. Idempotente: usa o próprio
   * MULTI_PRECO.CODAGENDA como marcador de "aplicada" (nenhuma coluna nova) → só APLICA quando entra na janela e
   * ainda não está aplicada, e só DESAPLICA quando saiu da janela e ainda está aplicada. Pensado p/ um cron chamar
   * periodicamente (por tenant/empresa). O efeito no PDV (LOTEPRECO/etiqueta) segue adiado (depende do PDV).
   */
  async processarVigencia(): Promise<{ aplicadas: number; desaplicadas: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const agendas = (await db
      .selectFrom('agenda_promocao as a')
      .select([
        'a.codagenda as codagenda',
        sql<boolean>`(a.dtiniciopromocao <= now() and now() < a.dtfimpromocao)`.as('dentro_janela'),
        sql<boolean>`exists (select 1 from multi_preco m where m.codagenda = a.codagenda and m.idempresa = ${emp})`.as('aplicada'),
      ])
      .where('a.idempresa', '=', emp)
      .where('a.dtencerramento', 'is', null)
      .where(sql`coalesce(a.indr,'I')`, '<>', 'E')
      .execute()) as Array<{ codagenda: number; dentro_janela: boolean; aplicada: boolean }>;

    let aplicadas = 0;
    let desaplicadas = 0;
    for (const a of agendas) {
      const dentro = a.dentro_janela === true;
      const aplicada = a.aplicada === true;
      if (dentro && !aplicada) {
        await this.aplicar(Number(a.codagenda)); // entrou na vigência → liga
        aplicadas++;
      } else if (!dentro && aplicada) {
        await this.desaplicar(Number(a.codagenda)); // saiu da vigência → desliga (sem encerrar)
        desaplicadas++;
      }
    }
    return { aplicadas, desaplicadas };
  }
}
