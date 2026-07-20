import { sql, type Kysely } from 'kysely';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/** flags de bloqueio do PERIODO_CONTABIL por área (fiel ao Oracle). */
export type BloqPeriodo = 'bloq_nf' | 'bloq_rcb' | 'bloq_baixa_rcb' | 'bloq_apg' | 'bloq_baixa_apg';

/**
 * Trava de PERÍODO CONTÁBIL FECHADO (ValidaPeriodoFechado do legado) — fail-CLOSED: lança PERIODO_FECHADO se a
 * `data` cair num período com STATUS='S' e o flag da área ligado. `data` null → não trava (registro sem competência).
 * A A Receber/Pagar chama na gravação (DTVENDA, flag bloq_rcb/bloq_apg) e na baixa (DTPGTO, bloq_baixa_rcb/apg).
 */
export async function assertPeriodoNaoFechado(db: AnyDB, emp: number, data: unknown, flag: BloqPeriodo): Promise<void> {
  if (data == null || data === '') return;
  // Comparação em granularidade de DATA (fiel ao DateOf do legado, UIntegracaoContabil.pas:286): DTVENDA/DTPGTO
  // são timestamptz (com hora), data_inicio/data_fim são date. Sem o cast, o Postgres promove data_fim p/ meia-noite
  // e um título no ÚLTIMO dia do período (hora>00:00) escaparia da trava. `cast(param as date)` trunca a hora.
  const dataDate = sql`cast(${data} as date)`;
  const fechado = (await db
    .selectFrom('periodo_contabil')
    .select('competencia_contabil')
    .where('codempresa', '=', emp)
    .where('status', '=', 'S')
    .where(flag, '=', 'S')
    .where('data_inicio', '<=', dataDate)
    .where('data_fim', '>=', dataDate)
    .executeTakeFirst()) as { competencia_contabil?: unknown } | undefined;
  if (fechado) throw new BusinessRuleError('PERIODO_FECHADO', { competencia: fechado.competencia_contabil, area: flag });
}
