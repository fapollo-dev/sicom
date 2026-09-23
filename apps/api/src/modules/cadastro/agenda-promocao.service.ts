import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { gravarHistorico } from '../../shared/crud/historico';
import { lojasDaAgenda, lojasDoCsv } from './agenda-promocao-lojas';

type AnyDB = Kysely<any>;
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const ALVO_MP = { tabela: 'multi_preco', pk: 'idproduto', origem: 'FRMCADAGENDAPROMOCAO' };

/**
 * AGENDA DE PROMOÇÃO — serviço VERTICAL do workflow (o CRUD é o AggregateEngineService): aplicar, encerrar, reabrir e
 * a vigência. Desde a mig 312 tudo é da REDE e loja a loja (a lista de cada item) e o status segue o ciclo do legado
 * N=ABERTA → E=EXECUTANDO → J=FECHADA. CAS em dtencerramento (anti-corrida). Tenant fail-closed.
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

  /** a agenda viva (não excluída), da REDE — a pesquisa do legado não filtra loja (mig 312) */
  private async agenda(trx: AnyDB, codagenda: number) {
    const ap = (await trx
      .selectFrom('agenda_promocao')
      .select(['idempresa', 'dtencerramento', 'flagpromocao'])
      .where('codagenda', '=', codagenda)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .forUpdate()
      .executeTakeFirst()) as { idempresa: number; dtencerramento: unknown; flagpromocao: string | null } | undefined;
    if (!ap) throw new BusinessRuleError('PROMOCAO_NAO_ENCONTRADA', { codagenda });
    return ap;
  }

  /** desliga o preço promocional que ESTA agenda ligou, em TODAS as lojas (reversão de uCadAgendaPromocao:750) */
  private async reverter(trx: AnyDB, codagenda: number): Promise<number> {
    const r = await trx
      .updateTable('multi_preco')
      .set({ promocao: 'N', vrpromo: null, codagenda: null, dtultprecoalterado: sql`now()` })
      .where('codagenda', '=', codagenda)
      .executeTakeFirst();
    return Number(r?.numUpdatedRows ?? 0);
  }

  /** encerra a agenda (aberta → encerrada): reverte o preço em todas as lojas e a agenda fica FECHADA ('J'). CAS. */
  async encerrar(codagenda: number): Promise<{ codagenda: number; situacao: 'ENCERRADA' }> {
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const ap = await this.agenda(trx, codagenda);
      if (ap.dtencerramento != null) throw new BusinessRuleError('PROMOCAO_JA_ENCERRADA', { codagenda });
      const r = await trx
        .updateTable('agenda_promocao')
        .set({ dtencerramento: sql`now()`, codoperadorenc: op, flagpromocao: 'J', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codagenda', '=', codagenda)
        .where('dtencerramento', 'is', null)
        .executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('PROMOCAO_JA_ENCERRADA', { codagenda });
      await this.reverter(trx, codagenda);
      return { codagenda, situacao: 'ENCERRADA' as const };
    });
  }

  /** reabre a agenda (encerrada → aberta): volta a ABERTA ('N'); a vigência liga o preço se estiver no período. CAS. */
  async reabrir(codagenda: number): Promise<{ codagenda: number; situacao: 'ABERTA' }> {
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const ap = await this.agenda(trx, codagenda);
      if (ap.dtencerramento == null) throw new BusinessRuleError('PROMOCAO_NAO_ENCERRADA', { codagenda });
      const r = await trx
        .updateTable('agenda_promocao')
        .set({ dtencerramento: null, codoperadorenc: null, flagpromocao: 'N', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codagenda', '=', codagenda)
        .where('dtencerramento', 'is not', null)
        .executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('PROMOCAO_NAO_ENCERRADA', { codagenda });
      return { codagenda, situacao: 'ABERTA' as const };
    });
  }

  /**
   * APLICAR o preço promocional: para cada item ATIVO, em CADA LOJA da lista do item (`empresas`, '1, 2' — o
   * AtualizaAtivo percorre a lista, uCadAgendaPromocao.pas:232), grava no MULTI_PRECO da loja `PROMOCAO='S',
   * VRPROMO=VLRPROMOCAO, CODAGENDA=<agenda>`. A agenda passa a EXECUTANDO ('E') com a DATAEXECUCAO — o que o
   * cdsPrincipalBeforePost carimba quando o status vira 'E'. Só loja com preço do produto (linha em multi_preco).
   * No legado quem liga é um serviço fora do fonte (a agenda muda de 'N' para 'E' na data); aqui é a vigência ou o
   * operador (BTNAPLICARPRECO). Encerrada ou FECHADA não aplica.
   */
  async aplicar(codagenda: number): Promise<{ codagenda: number; aplicados: number }> {
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const ap = await this.agenda(trx, codagenda);
      if (ap.dtencerramento != null) throw new BusinessRuleError('PROMOCAO_ENCERRADA', { codagenda });
      if (ap.flagpromocao === 'J') throw new BusinessRuleError('PROMOCAO_FECHADA', { codagenda });
      const lojasAgenda = await lojasDaAgenda(trx, codagenda);

      const itens = (await trx
        .selectFrom('agenda_promocao_itens')
        .select(['idproduto', 'vlrpromocao', 'empresas'])
        .where('codagenda', '=', codagenda)
        .where(sql`coalesce(ativo, 'S')`, '=', 'S')
        .execute()) as Array<{ idproduto: number; vlrpromocao: unknown; empresas: string | null }>;

      let aplicados = 0;
      for (const it of itens) {
        for (const loja of lojasDoCsv(it.empresas, lojasAgenda)) {
          const mp = (await trx
            .selectFrom('multi_preco')
            .select(['id_multi_preco', 'vrpromo', 'promocao'])
            .where('idproduto', '=', it.idproduto)
            .where('idempresa', '=', loja)
            .executeTakeFirst()) as { id_multi_preco: number; vrpromo?: unknown; promocao?: string } | undefined;
          if (!mp) continue; // produto sem preço na loja → não há linha p/ aplicar (fiel ao INNER do legado)
          const promo = num(it.vlrpromocao);
          await trx
            .updateTable('multi_preco')
            .set({ promocao: 'S', vrpromo: promo, codagenda, dtultprecoalterado: sql`now()` })
            .where('id_multi_preco', '=', mp.id_multi_preco)
            .execute();
          await gravarHistorico(
            trx, ALVO_MP, it.idproduto, op, loja,
            { promocao: mp.promocao ?? 'N', vrpromo: num(mp.vrpromo) },
            { promocao: 'S', vrpromo: promo, codagenda },
            'UPDATE',
          );
          aplicados++;
        }
      }
      if (ap.flagpromocao !== 'E') {
        await trx.updateTable('agenda_promocao').set({ flagpromocao: 'E', dataexecucao: sql`now()` }).where('codagenda', '=', codagenda).execute();
      }
      return { codagenda, aplicados };
    });
  }

  /** a agenda saiu da vigência (o fim passou): desliga o preço em todas as lojas e fica FECHADA ('J'), sem encerrar */
  private async fechar(codagenda: number): Promise<void> {
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.reverter(trx, codagenda);
      await trx.updateTable('agenda_promocao').set({ flagpromocao: 'J' }).where('codagenda', '=', codagenda).execute();
    });
  }

  /**
   * VIGÊNCIA — o serviço que, no legado, roda fora do fonte e move o status (a produção mostra o rastro: as 6 agendas
   * vigentes estão 'E' com DATAEXECUCAO, as 1.142 passadas 'J', a futura 'N'):
   *  - ABERTA ('N') dentro do período → aplica (vira EXECUTANDO);
   *  - EXECUTANDO ('E') com o fim passado → desliga o preço e FECHA ('J');
   *  - ABERTA ('N') com o fim passado sem nunca ter rodado → FECHA (6 das 1.142 fechadas não têm DATAEXECUCAO).
   * Da REDE (todas as lojas de cada agenda). Idempotente: o próprio status é o marcador.
   */
  async processarVigencia(): Promise<{ aplicadas: number; desaplicadas: number }> {
    this.emp(); // tenant fail-closed
    const db = this.dbp.forTenantRead() as AnyDB;
    const agendas = (await db
      .selectFrom('agenda_promocao as a')
      .select([
        'a.codagenda as codagenda',
        sql<string>`coalesce(a.flagpromocao, 'N')`.as('flag'),
        sql<boolean>`(a.dtiniciopromocao <= now() and now() < a.dtfimpromocao)`.as('dentro_janela'),
        sql<boolean>`(now() >= a.dtfimpromocao)`.as('passou'),
      ])
      .where('a.dtencerramento', 'is', null)
      .where(sql`coalesce(a.indr,'I')`, '<>', 'E')
      .where(sql<boolean>`coalesce(a.flagpromocao, 'N') IN ('N', 'E')`)
      .execute()) as Array<{ codagenda: number; flag: string; dentro_janela: boolean; passou: boolean }>;

    let aplicadas = 0;
    let desaplicadas = 0;
    for (const a of agendas) {
      if (a.flag === 'N' && a.dentro_janela === true) {
        await this.aplicar(Number(a.codagenda));
        aplicadas++;
      } else if (a.passou === true) {
        await this.fechar(Number(a.codagenda));
        if (a.flag === 'E') desaplicadas++;
      }
    }
    return { aplicadas, desaplicadas };
  }
}
