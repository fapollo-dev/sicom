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
 * CORTE-3 (mig 277): a baixa agora é LINHA em `cartao_bx` — 1.169.680 no cliente, R$ 58,4 mi, com baixa
 * PARCIAL real (5.186 recebíveis) e estorno LÓGICO (59.118 com `INDR='E'`). E com a trava que o legado não
 * tem: baixar além do valor é recusado — lá 2.921 cartões têm baixas ativas somando **R$ 131.623,12 a mais**
 * que o próprio valor, porque o lote era estornado sem marcar a baixa e o recebível era baixado de novo.
 * ADIADO (fiel): ajuste/antecipação, taxa→CAIXA, PLC/período, conciliação de extrato.
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
        // corte-3 (mig 277): a baixa vira LINHA em `cartao_bx` (1.169.680 no cliente), com o BRUTO baixado —
        // é o que permite baixa PARCIAL (5.186 cartões no cliente) e o estorno LÓGICO por baixa.
        await this.gravarBaixa(trx, {
          codvendcartao: Number(r.codvendcartao), idempresa: emp, valorpg: r2(num(r.valor)), idlote, codopbx: op,
          obs: `DOCUMENTO BAIXADO NO LOTE: ${idlote}`,
        });
        await trx.updateTable('cartao').set({ liberado: 'S', dtbaixa: sql`now()`, idlote, valor_taxa_paga: taxa, usultalteracao: op, dtultimalteracao: sql`now()` }).where('codvendcartao', '=', r.codvendcartao).where('idempresa', '=', emp).execute();
      }
      // crédito do líquido na conta bancária (razão MCB), 1 linha por lote.
      // `idlote` é a coluna do LEGADO que amarra o crédito ao lote (é por ela que a integração contábil soma o
      // total baixado do lote — `GetSQLMovimentacao`, `UIntegracaoContabil.pas:1979`). `origem`/`idorigem`
      // continuam sendo a chave do nosso estorno.
      await trx.insertInto('mov_contas_bancarias').values({
        codconta: dto.codconta, idempresa: emp, valor: totalLiq, tipomovimento: 'C', origem: 'BXCARTAO', idorigem: idlote, idlote,
        historico: `Baixa de cartão — lote ${idlote} (${abertos.length} recebível(is), taxa ${totalTaxa})`,
        codoperador: op, data_fechamento: sql`now()`, dtcadastro: sql`now()`,
      }).execute();
      return { idlote, itens: abertos.length, total_liquido: totalLiq, total_taxa: totalTaxa };
    });
  }

  /** o saldo do recebível: valor − baixas ATIVAS (as com `indr='E'` não contam). */
  private async baixado(trx: AnyDB, codvendcartao: number): Promise<number> {
    const r = (await sql<{ pg: unknown }>`
      SELECT coalesce(sum(valorpg), 0) AS pg FROM cartao_bx
       WHERE codvendcartao = ${codvendcartao} AND coalesce(indr, 'I') <> 'E'`.execute(trx)).rows[0];
    return r2(num(r?.pg));
  }

  /**
   * grava a baixa — e **recusa passar do valor do recebível**, que é o defeito medido do legado:
   * 2.921 cartões lá têm baixas ativas somando R$ 131.623,12 a mais que o próprio valor (o lote era estornado
   * sem marcar a baixa, e o recebível era baixado de novo).
   */
  private async gravarBaixa(trx: AnyDB, b: { codvendcartao: number; idempresa: number; valorpg: number; idlote: number; codopbx: number | null; obs: string }) {
    const c = (await sql<{ valor: unknown }>`SELECT valor FROM cartao WHERE codvendcartao = ${b.codvendcartao} AND idempresa = ${b.idempresa}`.execute(trx)).rows[0];
    if (!c) throw new BusinessRuleError('CARTAO_NAO_ENCONTRADO', { codvendcartao: b.codvendcartao });
    const valor = r2(num(c.valor));
    const jaBaixado = await this.baixado(trx, b.codvendcartao);
    if (r2(jaBaixado + b.valorpg) > r2(valor + 0.005)) {
      throw new BusinessRuleError('CARTAO_BAIXA_EXCEDE', { codvendcartao: b.codvendcartao, valor, jaBaixado, tentando: b.valorpg });
    }
    await sql`INSERT INTO cartao_bx (codvendcartao, idempresa, valorpg, data_pgto, codopbx, idlote, obs, dtcadastro)
              VALUES (${b.codvendcartao}, ${b.idempresa}, ${b.valorpg}, now(), ${b.codopbx}, ${b.idlote}, ${b.obs}, now())`.execute(trx);
    return r2(jaBaixado + b.valorpg);
  }

  /** as baixas de um recebível, com o saldo — a visão que o corte-2 não tinha. */
  async baixasDoCartao(codvendcartao: number): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const c = (await sql<Record<string, unknown>>`
      SELECT codvendcartao, valor, coalesce(liberado, 'N') AS liberado, dtbaixa, idlote
        FROM cartao WHERE codvendcartao = ${codvendcartao} AND idempresa = ${emp}`.execute(db)).rows[0];
    if (!c) throw new BusinessRuleError('CARTAO_NAO_ENCONTRADO', { codvendcartao });
    const bxs = (await sql<Record<string, unknown>>`
      SELECT codvendcartaobx, valorpg, data_pgto, codopbx, idlote, obs, coalesce(indr, 'I') AS indr
        FROM cartao_bx WHERE codvendcartao = ${codvendcartao} AND idempresa = ${emp}
       ORDER BY codvendcartaobx`.execute(db)).rows;
    const ativas = bxs.filter((b) => b.indr !== 'E');
    const pago = r2(ativas.reduce((s2, b) => s2 + num(b.valorpg), 0));
    return {
      cartao: { ...c, valor: r2(num(c.valor)) },
      baixas: bxs.map((b) => ({ ...b, valorpg: num(b.valorpg), estornada: b.indr === 'E' })),
      totais: { baixas: bxs.length, ativas: ativas.length, pago, saldo: r2(num(c.valor) - pago) },
    };
  }

  async estornarLote(idlote: number): Promise<{ idlote: number; itens: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const recs = (await trx.selectFrom('cartao').select('codvendcartao').where('idlote', '=', idlote).where('idempresa', '=', emp).where('liberado', '=', 'S').forUpdate().execute()) as Array<{ codvendcartao: number }>;
      if (!recs.length) throw new BusinessRuleError('CARTAO_LOTE_NAO_ENCONTRADO', { idlote });
      // corte-3 (mig 277): estorno LÓGICO das baixas do lote (INDR='E' + quem e quando) — o cliente tem 59.118
      // assim. O legado deixava a baixa VALENDO quando o lote era estornado: 2.921 cartões ficaram com baixas
      // ativas somando R$ 131.623,12 A MAIS que o próprio valor. Aqui a baixa morre junto com o lote.
      await sql`UPDATE cartao_bx SET indr = 'E', indr_usuario = ${op}, indr_data = now()
                 WHERE idlote = ${idlote} AND idempresa = ${emp} AND coalesce(indr, 'I') <> 'E'`.execute(trx);
      await trx.updateTable('cartao').set({ liberado: 'N', dtbaixa: null, idlote: null, valor_taxa_paga: null, usultalteracao: op, dtultimalteracao: sql`now()` }).where('idlote', '=', idlote).where('idempresa', '=', emp).execute();
      await trx.deleteFrom('mov_contas_bancarias').where('origem', '=', 'BXCARTAO').where('idorigem', '=', idlote).where('idempresa', '=', emp).execute();
      return { idlote, itens: recs.length };
    });
  }
}
