import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * TROCA — ações verticais de movimento de estoque (molde scrap/ajuste). O documento é criado pelo agregado
 * (troca.aggregate); `fechar` dá BAIXA no estoque dos itens abertos (a mercadoria avariada sai p/ o fornecedor):
 * DECREMENTA `estoque.qtde` em `qtde` (mov RELATIVO) + grava KARDEX (`historico_prod`, origem='TROCA', codtroca no
 * histórico) + marca item `fechado='S'`. `reabrir` reverte (+qtde, fechado='N'). Fiel a ESTOQUE_TROCA no caminho
 * LOJA/ORIGEM_FECHAMENTO=null (baixa definitiva; a reposição volta depois por NF — corte futuro). ADIADO: balde
 * QTDETROCA (reserva), DEPOSITO, INVENTARIO_ROTATIVO. Tenant fail-closed; operador obrigatório.
 */
@Injectable()
export class TrocaService {
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

  /** fecha a troca: baixa de estoque de TODOS os itens abertos (fechado='N'). */
  async fechar(codtroca: number): Promise<{ codtroca: number; itens: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await trx.selectFrom('troca').select('codtroca').where('codtroca', '=', codtroca).where('idempresa', '=', emp).forUpdate().executeTakeFirst();
      if (!t) throw new BusinessRuleError('TROCA_NAO_ENCONTRADA', { codtroca });
      const itens = (await trx.selectFrom('itens_troca').select(['coditenstroca', 'idproduto', 'qtde']).where('codtroca', '=', codtroca).where((eb: any) => eb.or([eb('fechado', '<>', 'S'), eb('fechado', 'is', null)])).execute()) as Array<{ coditenstroca: number; idproduto: number; qtde: unknown }>;
      if (!itens.length) throw new BusinessRuleError('TROCA_SEM_ITENS_ABERTOS', { codtroca });
      for (const it of itens) {
        await this.moverEstoque(trx, emp, Number(it.idproduto), -r3(num(it.qtde)), op, `Retirada do estoque para TROCA. Cód troca ${codtroca}`);
        await trx.updateTable('itens_troca').set({ fechado: 'S', usultalteracao: op, dtultimalteracao: sql`now()` }).where('coditenstroca', '=', it.coditenstroca).execute();
      }
      return { codtroca, itens: itens.length };
    });
  }

  /** reabre a troca: estorna a baixa dos itens fechados (devolve ao estoque). */
  async reabrir(codtroca: number): Promise<{ codtroca: number; itens: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await trx.selectFrom('troca').select('codtroca').where('codtroca', '=', codtroca).where('idempresa', '=', emp).forUpdate().executeTakeFirst();
      if (!t) throw new BusinessRuleError('TROCA_NAO_ENCONTRADA', { codtroca });
      const itens = (await trx.selectFrom('itens_troca').select(['coditenstroca', 'idproduto', 'qtde']).where('codtroca', '=', codtroca).where('fechado', '=', 'S').execute()) as Array<{ coditenstroca: number; idproduto: number; qtde: unknown }>;
      if (!itens.length) throw new BusinessRuleError('TROCA_SEM_ITENS_FECHADOS', { codtroca });
      for (const it of itens) {
        await this.moverEstoque(trx, emp, Number(it.idproduto), r3(num(it.qtde)), op, `Estorno da TROCA. Cód troca ${codtroca}`);
        await trx.updateTable('itens_troca').set({ fechado: 'N', usultalteracao: op, dtultimalteracao: sql`now()` }).where('coditenstroca', '=', it.coditenstroca).execute();
      }
      return { codtroca, itens: itens.length };
    });
  }

  /** movimento RELATIVO do saldo (delta<0 baixa / delta>0 estorno) + 1 linha de KARDEX (origem='TROCA'). */
  private async moverEstoque(trx: AnyDB, emp: number, idproduto: number, delta: number, op: number, historico: string) {
    const est = await trx.selectFrom('estoque').select(['id_estoque', 'qtde']).where('idproduto', '=', idproduto).where('idempresa', '=', emp).forUpdate().executeTakeFirst();
    const saldoAnt = r3(num((est as any)?.qtde));
    const saldoNovo = r3(saldoAnt + delta);
    if (est) {
      await trx.updateTable('estoque').set({ qtde: saldoNovo }).where('id_estoque', '=', (est as any).id_estoque).execute();
    } else {
      try {
        await trx.insertInto('estoque').values({ idproduto, idempresa: emp, qtde: saldoNovo }).execute();
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('TROCA_ESTOQUE_CONCORRENTE', { idproduto });
        throw e;
      }
    }
    await trx.insertInto('historico_prod').values({
      idproduto, idempresa: emp, tipo: delta >= 0 ? 'E' : 'S', qtde: Math.abs(delta),
      saldo_anterior: saldoAnt, saldo_novo: saldoNovo, origem: 'TROCA', codnf: null,
      historico, data: sql`now()`, codoperador: op,
    }).execute();
  }
}
