import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { movimentoDaTroca, type ItemTroca } from './troca-estoque';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * TROCA — fechar e reabrir os itens. O ESTOQUE já saiu quando o item entrou na troca (o gatilho `ESTOQUE_TROCA`, troca-estoque.ts): fechar
 * (FECHADO N→S) só tira a quantidade do QTDETROCA — devolve o saldo apenas com ORIGEM_FECHAMENTO TROCA/SCRAP, que a produção nunca usa —,
 * e reabrir (S→N) devolve ao QTDETROCA. Antes o Apollo dava a baixa no fechar: as 130 linhas de troca abertas que vêm do legado (a
 * mercadoria já saiu lá) seriam baixadas de novo. Tenant fail-closed; operador obrigatório.
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

  /** fecha a troca: os itens abertos passam a FECHADO 'S' (sai do QTDETROCA) */
  async fechar(codtroca: number): Promise<{ codtroca: number; itens: number }> {
    return this.trocarEstado(codtroca, 'S');
  }

  /** reabre a troca: os itens fechados voltam a FECHADO 'N' (volta ao QTDETROCA) */
  async reabrir(codtroca: number): Promise<{ codtroca: number; itens: number }> {
    return this.trocarEstado(codtroca, 'N');
  }

  private async trocarEstado(codtroca: number, para: 'S' | 'N'): Promise<{ codtroca: number; itens: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = (await trx.selectFrom('troca').select(['codtroca', 'dtcadastro']).where('codtroca', '=', codtroca).where('idempresa', '=', emp).forUpdate().executeTakeFirst()) as
        { codtroca: number; dtcadastro: unknown } | undefined;
      if (!t) throw new BusinessRuleError('TROCA_NAO_ENCONTRADA', { codtroca });
      let q = trx.selectFrom('itens_troca').select(['coditenstroca', 'idproduto', 'qtde', 'vrcusto', 'estoqueretirada', 'fechado', 'origem_fechamento', 'codscrap']).where('codtroca', '=', codtroca);
      q = para === 'S' ? q.where((eb: any) => eb.or([eb('fechado', '<>', 'S'), eb('fechado', 'is', null)])) : q.where('fechado', '=', 'S');
      const itens = (await q.orderBy('coditenstroca').execute()) as Array<ItemTroca & { coditenstroca: number }>;
      if (!itens.length) throw new BusinessRuleError(para === 'S' ? 'TROCA_SEM_ITENS_ABERTOS' : 'TROCA_SEM_ITENS_FECHADOS', { codtroca });
      const c = { emp, codtroca, dtcadastro: t.dtcadastro, op };
      for (const it of itens) {
        await movimentoDaTroca(trx, c, it, { ...it, fechado: para });
        await trx.updateTable('itens_troca').set({ fechado: para, usultalteracao: op, dtultimalteracao: sql`now()` }).where('coditenstroca', '=', it.coditenstroca).execute();
      }
      return { codtroca, itens: itens.length };
    });
  }
}
