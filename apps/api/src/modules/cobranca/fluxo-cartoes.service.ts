import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * FLUXO DE CARTÕES (`FRMFLUXOCARTOES`, `udmFluxoCartoes`). Dossiê: `uFluxoCartoes.md`.
 * **98 acessos, 7 operadores.**
 *
 * Quanto a loja vendeu no cartão, **quanto já caiu na conta e quanto ainda vai cair** — por dia e, quando se
 * abre o dia, por operadora. É a visão de recebível que falta ao extrato: o dinheiro existe, mas ainda não
 * está lá.
 *
 * `CARTAO` tem **2.059.893 linhas** em 2.201 dias, a última de hoje (medido em 15/09/2026). `LIBERADO = 'S'`
 * é o que a operadora já pagou.
 *
 * ── ⚠️ O legado DUPLICA o dia na grade, e a coluna "total" mostra parcial ──────────────────────────────
 * O SQL original agrupa por `TRUNC(DTVENDA), C.LIBERADO` e calcula `SUM(C.VALOR) AS TOTALVENDASMES` dentro
 * desse grupo. Como `LIBERADO` entra no `GROUP BY`, **cada dia com parte recebida e parte a receber vira
 * DUAS linhas** — e em nenhuma delas o "total" é o total do dia: é o total daquele status.
 *
 * Medido: **1.485 dos 2.201 dias (67%)** saem duplicados. O operador vê o mesmo dia duas vezes e soma na
 * cabeça. Aqui é **uma linha por dia**, com as três colunas que o nome delas promete — total, recebido e a
 * receber — e a soma fecha.
 */
@Injectable()
export class FluxoCartoesService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** o fluxo por DIA no período. */
  async porDia(f: { dataIni: string; dataFim: string; codoperadora?: number | null }): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { total: number; recebido: number; aReceber: number; dias: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (f.dataIni > f.dataFim) throw new BusinessRuleError('DATA_INICIAL_MAIOR', { dataIni: f.dataIni, dataFim: f.dataFim });

    const onde = [
      sql`c.idempresa = ${emp}`,
      sql`c.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`,
    ];
    if (f.codoperadora) onde.push(sql`c.codoperadora = ${f.codoperadora}`);

    const linhas = (await sql<Record<string, unknown>>`
      SELECT c.dtvenda::date AS dtvenda,
             -- ⚠️ UMA linha por dia: o legado agrupa também por LIBERADO e duplica 67% dos dias
             round(sum(c.valor)::numeric, 2) AS total_vendas,
             round(sum(CASE WHEN coalesce(c.liberado, 'N') = 'S' THEN c.valor ELSE 0 END)::numeric, 2) AS recebidas,
             round(sum(CASE WHEN coalesce(c.liberado, 'N') <> 'S' THEN c.valor ELSE 0 END)::numeric, 2) AS nao_recebidas,
             count(*)::int AS lancamentos
        FROM cartao c
       WHERE ${sql.join(onde, sql` AND `)}
       GROUP BY c.dtvenda::date
       ORDER BY 1
       LIMIT 5001
    `.execute(db)).rows;

    return {
      linhas,
      totais: {
        total: r2(linhas.reduce((s, l) => s + num(l.total_vendas), 0)),
        recebido: r2(linhas.reduce((s, l) => s + num(l.recebidas), 0)),
        aReceber: r2(linhas.reduce((s, l) => s + num(l.nao_recebidas), 0)),
        dias: linhas.length,
      },
    };
  }

  /** o detalhe de um dia, por OPERADORA — a segunda consulta da tela. */
  async porOperadora(data: string): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await sql<Record<string, unknown>>`
      SELECT c.dtvenda::date AS dtvenda,
             coalesce(o.operadora, '(SEM OPERADORA)') AS operadora, c.codoperadora,
             round(sum(c.valor)::numeric, 2) AS total_vendas,
             round(sum(CASE WHEN coalesce(c.liberado, 'N') = 'S' THEN c.valor ELSE 0 END)::numeric, 2) AS recebidas,
             round(sum(CASE WHEN coalesce(c.liberado, 'N') <> 'S' THEN c.valor ELSE 0 END)::numeric, 2) AS nao_recebidas,
             count(*)::int AS lancamentos
        FROM cartao c
        LEFT JOIN operadoras o ON o.codoperadoras = c.codoperadora
       WHERE c.idempresa = ${emp} AND c.dtvenda::date = ${data}::date
       GROUP BY c.dtvenda::date, o.operadora, c.codoperadora
       ORDER BY 2
    `.execute(db)).rows;
  }
}
