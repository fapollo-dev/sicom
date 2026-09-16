import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * CONSULTA A RECEBER POR CLIENTE (`FRMCONSCLIRCB`, `UConsCliRcb.pas` 584 linhas).
 * Dossiê: `uConsCliRcb.md`. **64 acessos, 8 operadores.**
 *
 * Os títulos em aberto de um cliente, com **atraso, juro e total atualizado** — a tela que se abre quando o
 * cliente liga perguntando quanto deve.
 *
 * ── A conta do juro (`UConsCliRcb.dfm`) ────────────────────────────────────────────────────────────────
 * ```
 * atraso   = max(0, hoje − DTVENC)
 * se atraso < TOLERÂNCIA  → juro 0 e total = VALOR
 * senão                   → juro = (taxa ÷ 30) × atraso × VALOR ÷ 100
 * ```
 * A taxa é **mensal**, dividida por 30 para virar diária (juro simples).
 *
 * ⚠️ **a tolerância zera o juro inteiro, não os dias tolerados**: com tolerância de 5 dias, 5 dias de atraso
 * não rendem nada e 6 dias rendem juro sobre os **6** — não sobre 1. É assim no legado e foi mantido: é o
 * combinado com o cliente.
 *
 * ── ⚠️ O JURO E O TOTAL USAM TAXAS DIFERENTES — e isso atinge 99,96% dos títulos ───────────────────────
 * No SQL original, a coluna **JURO** aplica `CASE WHEN TXJUROS > 0 AND TXJUROS < 20 THEN TXJUROS/30 ELSE
 * 9/30 END` — ou seja, taxa fora da faixa cai num **default de 9% ao mês**. Já a coluna **TOTAL** usa
 * `COALESCE(TXJUROS/30, 0)`, **sem** o default.
 *
 * Nos títulos com taxa zero — que são **99.694 de 99.734 (99,96%)** — o resultado é:
 *  · a coluna **JURO** mostra juros a 9% ao mês;
 *  · a coluna **TOTAL** não inclui juro nenhum.
 *
 * Medido nos 46.792 títulos vencidos com taxa zero: **R$ 4.845.428,53** de principal contra
 * **R$ 11.567.551,22** de juro na coluna — juro fantasma de **2,4× o principal**, que não entra no total e
 * não existe, porque a taxa do título é zero.
 *
 * Aqui há **uma taxa só**, usada nas duas colunas: a do título quando está na faixa (0, 20), **zero** quando
 * não está. Os 40 títulos com taxa própria seguem rendendo; os 99.694 sem taxa param de exibir juro
 * inventado. O **total não muda** em relação ao legado — só a coluna de juro deixa de mentir.
 */
@Injectable()
export class ConsCliRcbService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(f: { codparceiro: number; somenteAbertos?: boolean; tolerancia?: number | null }): Promise<{
    titulos: Array<Record<string, unknown>>;
    totais: { titulos: number; principal: number; juro: number; total: number; vencidos: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const tol = f.tolerancia != null ? Number(f.tolerancia) : 0;

    // ⚠️ UMA taxa, usada no juro E no total: a do título quando está na faixa, zero quando não está
    const taxaDia = sql`(CASE WHEN r.txjuros > 0 AND r.txjuros < 20 THEN r.txjuros / 30.0 ELSE 0 END)`;
    const atraso = sql`GREATEST((current_date - r.dtvenc::date), 0)`;

    const titulos = (await sql<Record<string, unknown>>`
      SELECT r.codrcb AS codigo, r.duplicata, r.dtvenda::date AS dtvenda, r.dtvenc::date AS dtvenc,
             r.valor, coalesce(r.txjuros, 0) AS txjuros, r.nrocupom, r.obs,
             coalesce(r.quitada, 'N') AS quitada,
             ${atraso} AS atraso,
             ${tol}::int AS tolerancia,
             -- juro zero enquanto o atraso não passa da tolerância; passando, sobre TODOS os dias
             CASE WHEN ${atraso} < ${tol}::int THEN 0
                  ELSE round((${taxaDia} * ${atraso} * r.valor / 100)::numeric, 2) END AS juro,
             CASE WHEN ${atraso} < ${tol}::int THEN r.valor
                  ELSE round((r.valor + (${taxaDia} * ${atraso} * r.valor / 100))::numeric, 2) END AS total,
             pa.razao AS cliente
        FROM areceber r
        LEFT JOIN parceiros pa ON pa.codparceiro = r.codparceiro
       WHERE r.codparceiro = ${f.codparceiro}
         AND r.codempresa = ${emp}
         ${f.somenteAbertos ? sql`AND coalesce(r.quitada, 'N') = 'N'` : sql``}
       ORDER BY r.dtvenc, r.codrcb
       LIMIT 2001
    `.execute(db)).rows;

    return {
      titulos,
      totais: {
        titulos: titulos.length,
        principal: r2(titulos.reduce((s, t) => s + num(t.valor), 0)),
        juro: r2(titulos.reduce((s, t) => s + num(t.juro), 0)),
        total: r2(titulos.reduce((s, t) => s + num(t.total), 0)),
        vencidos: titulos.filter((t) => num(t.atraso) > 0 && t.quitada !== 'S').length,
      },
    };
  }
}
