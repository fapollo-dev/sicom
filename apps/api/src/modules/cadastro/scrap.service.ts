import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000; // numeric(13,3)

/**
 * SCRAP / PERDAS — ações verticais de BAIXA de estoque (molde ajuste-estoque). O documento (cabeçalho+itens) é
 * criado pelo agregado (scrap.aggregate); aqui aplica-se/estorna-se o efeito no estoque, decoplado como no
 * Inventário. `aplicar`: por item, DECREMENTA `estoque.qtde` em `qtde` (movimento RELATIVO — a perda tira do saldo)
 * e grava o KARDEX (`historico_prod`, origem='SCRAP'); marca `scrap.mov_estoque='S'`. `estornar`: reverte com
 * movimento relativo oposto (+qtde) e limpa `mov_estoque`. Movimento RELATIVO (não restaura saldo absoluto) →
 * compõe corretamente mesmo com movimento posterior de outra origem. qtde é SIGNED (fiel ao golden): qtde<0 num
 * item inverte o sentido naturalmente. Tenant por `idempresa` fail-closed; operador obrigatório.
 */
@Injectable()
export class ScrapService {
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

  /** aplica a baixa de estoque de TODOS os itens do scrap (idempotente pela guarda mov_estoque). */
  async aplicar(codscrap: number): Promise<{ codscrap: number; mov_estoque: 'S'; itens: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const s = await trx
        .selectFrom('scrap').select(['codscrap', 'mov_estoque', 'importado'])
        .where('codscrap', '=', codscrap).where('idempresa', '=', emp)
        .forUpdate().executeTakeFirst();
      if (!s) throw new BusinessRuleError('SCRAP_NAO_ENCONTRADO', { codscrap });
      if ((s as any).mov_estoque === 'S') throw new BusinessRuleError('SCRAP_ESTOQUE_JA_APLICADO', { codscrap });
      if ((s as any).importado === 'S') throw new BusinessRuleError('SCRAP_JA_FATURADO', { codscrap });

      const itens = (await trx.selectFrom('scrap_item').select(['idproduto', 'qtde']).where('codscrap', '=', codscrap).execute()) as Array<{ idproduto: number; qtde: unknown }>;
      for (const it of itens) {
        await this.moverEstoque(trx, emp, Number(it.idproduto), -r3(num(it.qtde)), op, `Baixa de estoque via SCRAP cod ${codscrap}`);
      }
      await trx.updateTable('scrap').set({ mov_estoque: 'S', usultalteracao: op, dtultimalteracao: sql`now()` }).where('codscrap', '=', codscrap).where('idempresa', '=', emp).execute();
      return { codscrap, mov_estoque: 'S' as const, itens: itens.length };
    });
  }

  /** estorna a baixa (reverte o saldo com movimento relativo oposto) e limpa mov_estoque. */
  async estornar(codscrap: number): Promise<{ codscrap: number; mov_estoque: null; itens: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const s = await trx
        .selectFrom('scrap').select(['codscrap', 'mov_estoque', 'importado'])
        .where('codscrap', '=', codscrap).where('idempresa', '=', emp)
        .forUpdate().executeTakeFirst();
      if (!s) throw new BusinessRuleError('SCRAP_NAO_ENCONTRADO', { codscrap });
      if ((s as any).mov_estoque !== 'S') throw new BusinessRuleError('SCRAP_ESTOQUE_NAO_APLICADO', { codscrap });
      if ((s as any).importado === 'S') throw new BusinessRuleError('SCRAP_JA_FATURADO', { codscrap });

      const itens = (await trx.selectFrom('scrap_item').select(['idproduto', 'qtde']).where('codscrap', '=', codscrap).execute()) as Array<{ idproduto: number; qtde: unknown }>;
      for (const it of itens) {
        await this.moverEstoque(trx, emp, Number(it.idproduto), r3(num(it.qtde)), op, `Estorno de estoque via SCRAP cod ${codscrap}`);
      }
      await trx.updateTable('scrap').set({ mov_estoque: null, usultalteracao: op, dtultimalteracao: sql`now()` }).where('codscrap', '=', codscrap).where('idempresa', '=', emp).execute();
      return { codscrap, mov_estoque: null, itens: itens.length };
    });
  }

  /** movimento RELATIVO do saldo (delta<0 baixa / delta>0 estorno) + 1 linha de KARDEX (historico_prod, origem='SCRAP'). */
  private async moverEstoque(trx: AnyDB, emp: number, idproduto: number, delta: number, op: number, historico: string) {
    const est = await trx
      .selectFrom('estoque').select(['id_estoque', 'qtde'])
      .where('idproduto', '=', idproduto).where('idempresa', '=', emp)
      .forUpdate().executeTakeFirst();
    const saldoAnt = r3(num((est as any)?.qtde));
    const saldoNovo = r3(saldoAnt + delta);
    if (est) {
      await trx.updateTable('estoque').set({ qtde: saldoNovo }).where('id_estoque', '=', (est as any).id_estoque).execute();
    } else {
      try {
        await trx.insertInto('estoque').values({ idproduto, idempresa: emp, qtde: saldoNovo }).execute();
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('SCRAP_ESTOQUE_CONCORRENTE', { idproduto });
        throw e;
      }
    }
    await trx.insertInto('historico_prod').values({
      idproduto, idempresa: emp, tipo: delta >= 0 ? 'E' : 'S', qtde: Math.abs(delta),
      saldo_anterior: saldoAnt, saldo_novo: saldoNovo, origem: 'SCRAP', codnf: null,
      historico, data: sql`now()`, codoperador: op,
    }).execute();
  }
}
