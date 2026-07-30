import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * CARTÕES corte-2 — BAIXA / LIQUIDAÇÃO em lote (FRMBAIXACARTAO). Fecha o recebível: gera um LOTE (seq_cartao_lote),
 * marca os recebíveis abertos (liberado='S', dtbaixa, idlote, valor_taxa_paga = bruto − líquido) e CREDITA o líquido
 * total numa conta bancária (mov_contas_bancarias, tipomovimento='C', origem='BXCARTAO' [MCB.origem é varchar(10)],
 * idorigem=idlote). O
 * líquido vem da view get_cartao (COALESCE(valorliq, bruto − bruto×txadm_ef/100) — a mesma regra do GET_CARTAO).
 * `estornarLote` reverte tudo (recebíveis → aberto, apaga o crédito). Tenant fail-closed; operador obrigatório.
 * ADIADO (fiel): baixa parcial/ajuste, antecipação, taxa→CAIXA, PLC/período, conciliação de extrato.
 */
@Injectable()
export class CartaoBaixaService {
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

  async baixar(dto: { codconta: number; codvendcartaos: number[] }): Promise<{ idlote: number; itens: number; total_liquido: number; total_taxa: number }> {
    const emp = this.emp();
    const op = this.op();
    const ids = Array.from(new Set((dto.codvendcartaos ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0)));
    if (!ids.length) throw new BusinessRuleError('CARTAO_BAIXA_SEM_ITENS');
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // fold auditoria [ALTA]: a conta de destino TEM de ser da empresa do tenant (contas_bancarias é empresaScoped;
      // sem o filtro idempresa, um POST direto creditaria a conta de OUTRA empresa no mesmo banco de dados). Espelha
      // o areceber-baixa.service.
      const conta = await trx.selectFrom('contas_bancarias').select('codconta').where('codconta', '=', dto.codconta).where('idempresa', '=', emp).executeTakeFirst();
      if (!conta) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { codconta: dto.codconta });
      // TRAVA as linhas ABERTAS na tabela base (FOR UPDATE numa view com outer join não é permitido no PG).
      const abertos = (await trx
        .selectFrom('cartao')
        .select(['codvendcartao', 'valor'])
        .where('codvendcartao', 'in', ids)
        .where('idempresa', '=', emp)
        .where('liberado', '=', 'N')
        .forUpdate()
        .execute()) as Array<{ codvendcartao: number; valor: unknown }>;
      if (!abertos.length) throw new BusinessRuleError('CARTAO_BAIXA_NENHUM_ABERTO');
      // líquido COMPUTADO pela view get_cartao (sem lock — só leitura do cálculo).
      const netRows = (await trx.selectFrom('get_cartao').select(['codvendcartao', 'valor_com_taxa']).where('codvendcartao', 'in', abertos.map((a) => a.codvendcartao)).where('idempresa', '=', emp).execute()) as Array<{ codvendcartao: number; valor_com_taxa: unknown }>;
      const netMap = new Map(netRows.map((r) => [Number(r.codvendcartao), r2(num(r.valor_com_taxa))]));
      const loteRes = await trx.executeQuery(sql`select nextval('seq_cartao_lote') as v`.compile(trx));
      const idlote = Number((loteRes.rows[0] as { v: number | string }).v);
      let totalLiq = 0;
      let totalTaxa = 0;
      for (const r of abertos) {
        const liq = netMap.get(Number(r.codvendcartao)) ?? r2(num(r.valor));
        const taxa = r2(num(r.valor) - liq);
        totalLiq = r2(totalLiq + liq);
        totalTaxa = r2(totalTaxa + taxa);
        await trx.updateTable('cartao').set({ liberado: 'S', dtbaixa: sql`now()`, idlote, valor_taxa_paga: taxa, usultalteracao: op, dtultimalteracao: sql`now()` }).where('codvendcartao', '=', r.codvendcartao).where('idempresa', '=', emp).execute();
      }
      // crédito do líquido na conta bancária (razão MCB), 1 linha por lote.
      await trx.insertInto('mov_contas_bancarias').values({
        codconta: dto.codconta, idempresa: emp, valor: totalLiq, tipomovimento: 'C', origem: 'BXCARTAO', idorigem: idlote,
        historico: `Baixa de cartão — lote ${idlote} (${abertos.length} recebível(is), taxa ${totalTaxa})`,
        codoperador: op, data_fechamento: sql`now()`, dtcadastro: sql`now()`,
      }).execute();
      return { idlote, itens: abertos.length, total_liquido: totalLiq, total_taxa: totalTaxa };
    });
  }

  async estornarLote(idlote: number): Promise<{ idlote: number; itens: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const recs = (await trx.selectFrom('cartao').select('codvendcartao').where('idlote', '=', idlote).where('idempresa', '=', emp).where('liberado', '=', 'S').forUpdate().execute()) as Array<{ codvendcartao: number }>;
      if (!recs.length) throw new BusinessRuleError('CARTAO_LOTE_NAO_ENCONTRADO', { idlote });
      await trx.updateTable('cartao').set({ liberado: 'N', dtbaixa: null, idlote: null, valor_taxa_paga: null, usultalteracao: op, dtultimalteracao: sql`now()` }).where('idlote', '=', idlote).where('idempresa', '=', emp).execute();
      await trx.deleteFrom('mov_contas_bancarias').where('origem', '=', 'BXCARTAO').where('idorigem', '=', idlote).where('idempresa', '=', emp).execute();
      return { idlote, itens: recs.length };
    });
  }
}
