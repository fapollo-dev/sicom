import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { PeriodoContabilDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const comp = (v: string | undefined) => (v == null ? null : v.replace('/', ''));

/**
 * CADASTRO DE PERÍODO CONTÁBIL (`FRMCADPERIODOCONTABIL`). **14 acessos, 5 operadores.** Migration 256.
 *
 * A tabela já sustentava as travas de período fechado (`shared/periodo-contabil.ts`), mas não tinha tela nem
 * escrita. A única regra do legado é a competência única (`AND CODPERIODOCONTABIL <> :cod`); aqui por empresa,
 * e a competência gravada normalizada para MMAAAA (o cliente tem '082024' e '02/2025' convivendo).
 */
@Injectable()
export class PeriodoContabilCadService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private linha(r: Record<string, unknown>) {
    return {
      codperiodocontabil: Number(r.codperiodocontabil), competenciaContabil: r.competencia_contabil,
      competenciaFinanceira: r.competencia_financeira ?? null, competenciaGeracao: r.competencia_geracao ?? null,
      dataInicio: r.data_inicio, dataFim: r.data_fim, status: r.status ?? 'N',
      bloqNf: r.bloq_nf ?? 'N', bloqApg: r.bloq_apg ?? 'N', bloqBaixaApg: r.bloq_baixa_apg ?? 'N', bloqRcb: r.bloq_rcb ?? 'N',
      bloqBaixaRcb: r.bloq_baixa_rcb ?? 'N', bloqMovCaixa: r.bloq_mov_caixa ?? 'N', bloqChq: r.bloq_chq ?? 'N',
      bloqAdiantamentoForn: r.bloq_adiantamento_forn ?? 'N', bloqBaixaCrt: r.bloq_baixa_crt ?? 'N',
    };
  }

  async listar() {
    const emp = this.emp();
    const rows = (await sql<Record<string, unknown>>`
      SELECT codperiodocontabil, competencia_contabil, competencia_financeira, competencia_geracao,
             to_char(data_inicio, 'YYYY-MM-DD') AS data_inicio, to_char(data_fim, 'YYYY-MM-DD') AS data_fim, status,
             bloq_nf, bloq_apg, bloq_baixa_apg, bloq_rcb, bloq_baixa_rcb, bloq_mov_caixa, bloq_chq, bloq_adiantamento_forn, bloq_baixa_crt
        FROM periodo_contabil WHERE codempresa = ${emp} ORDER BY data_inicio DESC
    `.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    return rows.map((r) => this.linha(r));
  }

  async obter(cod: number) {
    const emp = this.emp();
    const r = (await sql<Record<string, unknown>>`
      SELECT codperiodocontabil, competencia_contabil, competencia_financeira, competencia_geracao,
             to_char(data_inicio, 'YYYY-MM-DD') AS data_inicio, to_char(data_fim, 'YYYY-MM-DD') AS data_fim, status,
             bloq_nf, bloq_apg, bloq_baixa_apg, bloq_rcb, bloq_baixa_rcb, bloq_mov_caixa, bloq_chq, bloq_adiantamento_forn, bloq_baixa_crt
        FROM periodo_contabil WHERE codempresa = ${emp} AND codperiodocontabil = ${cod}
    `.execute(this.dbp.forTenantRead() as AnyDB)).rows[0];
    if (!r) throw new BusinessRuleError('PERIODO_NAO_ENCONTRADO', { cod });
    return this.linha(r);
  }

  private async competenciaLivre(db: AnyDB, emp: number, competencia: string, exceto: number | null) {
    const dup = (await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM periodo_contabil
       WHERE codempresa = ${emp} AND replace(competencia_contabil, '/', '') = ${competencia}
         AND (${exceto}::integer IS NULL OR codperiodocontabil <> ${exceto}::integer)
    `.execute(db)).rows[0];
    // 'Já existe este período cadastrado!'
    if (Number(dup?.n ?? 0) > 0) throw new BusinessRuleError('PERIODO_JA_CADASTRADO', { competencia });
  }

  async criar(d: PeriodoContabilDto) {
    const emp = this.emp(); const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;
    const cc = comp(d.competenciaContabil)!;
    await this.competenciaLivre(db, emp, cc, null);
    const r = (await sql<{ codperiodocontabil: number }>`
      INSERT INTO periodo_contabil (codempresa, competencia_contabil, competencia_financeira, competencia_geracao, data_inicio, data_fim, status,
                                    bloq_nf, bloq_apg, bloq_baixa_apg, bloq_rcb, bloq_baixa_rcb, bloq_mov_caixa, bloq_chq, bloq_adiantamento_forn, bloq_baixa_crt, usultalteracao, dtultimalteracao)
      VALUES (${emp}, ${cc}, ${comp(d.competenciaFinanceira)}, ${comp(d.competenciaGeracao)}, ${d.dataInicio}::date, ${d.dataFim}::date, ${d.status},
              ${d.bloqNf}, ${d.bloqApg}, ${d.bloqBaixaApg}, ${d.bloqRcb}, ${d.bloqBaixaRcb}, ${d.bloqMovCaixa}, ${d.bloqChq}, ${d.bloqAdiantamentoForn}, ${d.bloqBaixaCrt}, ${op}, now())
      RETURNING codperiodocontabil
    `.execute(db)).rows[0];
    return this.obter(Number(r.codperiodocontabil));
  }

  async atualizar(cod: number, d: PeriodoContabilDto) {
    const emp = this.emp(); const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;
    const cc = comp(d.competenciaContabil)!;
    await this.competenciaLivre(db, emp, cc, cod);
    const r = await sql`
      UPDATE periodo_contabil SET competencia_contabil = ${cc}, competencia_financeira = ${comp(d.competenciaFinanceira)}, competencia_geracao = ${comp(d.competenciaGeracao)},
             data_inicio = ${d.dataInicio}::date, data_fim = ${d.dataFim}::date, status = ${d.status},
             bloq_nf = ${d.bloqNf}, bloq_apg = ${d.bloqApg}, bloq_baixa_apg = ${d.bloqBaixaApg}, bloq_rcb = ${d.bloqRcb}, bloq_baixa_rcb = ${d.bloqBaixaRcb},
             bloq_mov_caixa = ${d.bloqMovCaixa}, bloq_chq = ${d.bloqChq}, bloq_adiantamento_forn = ${d.bloqAdiantamentoForn}, bloq_baixa_crt = ${d.bloqBaixaCrt},
             usultalteracao = ${op}, dtultimalteracao = now()
       WHERE codempresa = ${emp} AND codperiodocontabil = ${cod}
    `.execute(db);
    if (Number(r.numAffectedRows ?? 0) === 0) throw new BusinessRuleError('PERIODO_NAO_ENCONTRADO', { cod });
    return this.obter(cod);
  }

  async excluir(cod: number) {
    const emp = this.emp();
    const r = await sql`DELETE FROM periodo_contabil WHERE codempresa = ${emp} AND codperiodocontabil = ${cod}`.execute(this.dbp.forTenant() as AnyDB);
    if (Number(r.numAffectedRows ?? 0) === 0) throw new BusinessRuleError('PERIODO_NAO_ENCONTRADO', { cod });
    return { codperiodocontabil: cod, excluido: true };
  }
}
