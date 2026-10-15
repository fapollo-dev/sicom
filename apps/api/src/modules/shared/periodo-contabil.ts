import { sql, type Kysely } from 'kysely';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/** flags de bloqueio do PERIODO_CONTABIL por área (fiel ao Oracle). */
export type BloqPeriodo = 'bloq_nf' | 'bloq_rcb' | 'bloq_baixa_rcb' | 'bloq_apg' | 'bloq_baixa_apg' | 'bloq_adiantamento_forn';

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

/**
 * Trava do DIA FECHADO (FECHAMENTO.STATUS = 'F' do «Fechamento diário», FRMFECHAMENTODIARIO) — o `RetornarValores('FECHAMENTO', DATA;IDEMPRESA)`
 * que o legado faz antes de mexer em documento fiscal: a NF no Editar (uNF.pas:3933 — "Dia FECHADO não é permitida alteração dos
 * documentos!"), no Excluir (:4090) e no Gravar (:4565 — "…alteração ou inclusão de documentos!"). Compara pela DATA (o
 * `FormataCastData('DATA')`). `data` nula não trava. Produção: as lojas 1 e 2 fecham dias (120 e 151 em 2026).
 */
export async function assertDiaNaoFechado(db: AnyDB, emp: number, data: unknown, inclusao = false): Promise<void> {
  if (data == null || data === '') return;
  const fechado = await db.selectFrom('fechamento').select('data')
    .where('idempresa', '=', emp).where('status', '=', 'F').where('data', '=', sql`cast(${data} as date)`)
    .executeTakeFirst();
  if (fechado) {
    throw new BusinessRuleError(inclusao ? 'DIA_FECHADO_INCLUSAO' : 'DIA_FECHADO', { data: String(data).slice(0, 10) },
      inclusao ? 'Dia FECHADO não é permitida alteração ou inclusão de documentos!' : 'Dia FECHADO não é permitida alteração dos documentos!');
  }
}
