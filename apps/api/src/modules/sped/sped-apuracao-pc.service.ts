import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * APURAÇÃO PIS/COFINS (EFD-Contribuições bloco M) — corte-2a: CRÉDITO DE ENTRADA. Consolida, por período, o
 * crédito de PIS/COFINS dos NFs de ENTRADA já migrados (nf_prod.bcpiscofinse/vrpise/vrcofinse, valorados no
 * import do XML), agrupado por (CST, alíquota) → apuracao_pc_det (TIPO='C'). O DÉBITO de saída (cupons/ReduçãoZ
 * do PDV) NÃO está migrado → a consolidação (M200/M600, valor a recolher) fica ADIADA. Idempotente por período
 * (delete-then-insert). COD_CRED/NAT_BC_CRED usam defaults ('101'/1) — a classificação completa do crédito é refino.
 */
@Injectable()
export class SpedApuracaoPcService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async apurar(dtini: string, dtfim: string): Promise<{ codapuracao_pc: number; grupos: number; total_credito_pis: number; total_credito_cofins: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // idempotente: remove a apuração anterior do mesmo período (cascade no detalhe).
      await trx.deleteFrom('apuracao_pc').where('idempresa', '=', emp).where('dataini', '=', dtini).where('datafim', '=', dtfim).execute();
      const cab = (await trx
        .insertInto('apuracao_pc')
        .values({ idempresa: emp, dataini: dtini, datafim: dtfim, codoperador: op })
        .returning('codapuracao_pc')
        .executeTakeFirstOrThrow()) as { codapuracao_pc: number };
      const codapuracao_pc = Number(cab.codapuracao_pc);

      // CRÉDITO de entrada agregado por (CST, alíquota PIS/COFINS) a partir dos itens dos NFs de entrada do período
      // (processados, não cancelados). Base/valor = os já valorados do import do XML (mig 089). Só linhas com crédito.
      const grupos = (await trx
        .selectFrom('nf_prod as np')
        .innerJoin('nf as n', 'n.codnf', 'np.codnf')
        .select([
          // fold auditoria [BAIXA]: CST nulo → default '50' (crédito básico) — o M105 exige CST_PIS preenchido.
          sql`coalesce(nullif(trim(np.cstpiscofins),''),'50')`.as('cst'),
          sql`coalesce(np.aliqpise,0)`.as('aliqpis'),
          sql`coalesce(np.aliqcofinse,0)`.as('aliqcofins'),
          sql`round(coalesce(sum(np.bcpiscofinse),0),2)`.as('basecalculo'),
          sql`round(coalesce(sum(np.vrpise),0),2)`.as('valorpis'),
          sql`round(coalesce(sum(np.vrcofinse),0),2)`.as('valorcofins'),
        ])
        .where('n.idempresa', '=', emp)
        .where('n.tipo', '=', 'E')
        .where(sql`coalesce(n.proc,'N')`, '=', 'S')
        .where(sql`coalesce(n.cancelada,'N')`, '<>', 'S')
        .where(sql`coalesce(n.statusnfe,'')`, '<>', 'C')
        .where(sql`n.dtcontabil`, '>=', dtini)
        .where(sql`n.dtcontabil`, '<=', dtfim)
        .where((eb) => eb.or([eb('np.vrpise', '>', 0), eb('np.vrcofinse', '>', 0)]))
        .groupBy([sql`coalesce(nullif(trim(np.cstpiscofins),''),'50')`, sql`coalesce(np.aliqpise,0)`, sql`coalesce(np.aliqcofinse,0)`])
        .execute()) as Array<{ cst: number | null; aliqpis: unknown; aliqcofins: unknown; basecalculo: unknown; valorpis: unknown; valorcofins: unknown }>;

      let totPis = 0;
      let totCofins = 0;
      for (const g of grupos) {
        await trx
          .insertInto('apuracao_pc_det')
          .values({
            codapuracao_pc,
            tipo: 'C',
            id_tipocredito: '101',
            id_basecredito: 1,
            idpiscofins: null,
            cst_pis: g.cst != null ? Number(g.cst) : null,
            basecalculo: Number(g.basecalculo) || 0,
            aliqpis: Number(g.aliqpis) || 0,
            valorpis: Number(g.valorpis) || 0,
            aliqcofins: Number(g.aliqcofins) || 0,
            valorcofins: Number(g.valorcofins) || 0,
          })
          .execute();
        totPis += Number(g.valorpis) || 0;
        totCofins += Number(g.valorcofins) || 0;
      }
      return { codapuracao_pc, grupos: grupos.length, total_credito_pis: Math.round(totPis * 100) / 100, total_credito_cofins: Math.round(totCofins * 100) / 100 };
    });
  }
}
