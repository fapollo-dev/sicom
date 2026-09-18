import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { CaixaDmeDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** o piso da DME (IN RFB 1.761/2017), o mesmo `HAVING ABS(SUM(VALOR)) > 30000` do fonte. */
export const DME_PISO = 30000;

/**
 * CAIXA DME (`FRMRELATORIOCAIXADME`). **9 acessos, 2 operadores** (último 17/08/2026). Dossiê:
 * `uRelatorioCaixaDME.md`. Migration 264.
 *
 * Quem movimentou mais de R$ 30 mil EM ESPÉCIE no período: o `caixa` com `tiporecurso` DINHEIRO, por parceiro
 * não funcionário, ARECEBER (Σ>0) ou APAGAR (Σ<0) pelo sinal, `|Σ| > 30.000`. Sintético = uma linha por
 * parceiro × tipo; analítico = todos os lançamentos em dinheiro de quem passou (os dois tipos, como o legado).
 *
 * Folds documentados na migration: conta também a variante '1 - DINHEIRO' (1.636 lançamentos em 2026 que o
 * legado ignora; não muda quem passa); um endereço só por parceiro (o LEFT JOIN do legado dobrava a soma de
 * quem tem 2 endereços); tenant-scoped; e `totais.semParceiro` mostra o dinheiro sem parceiro (8.618
 * lançamentos, R$ 3,9 mi em 2026) que a DME não enxerga por construção.
 */
@Injectable()
export class CaixaDmeService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: CaixaDmeDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const mov = sql`
      mov AS (
        SELECT c.codcx, c.data, c.obs, c.valor, c.codparceiro, p.razao,
               CASE WHEN c.valor > 0 THEN 'ARECEBER' ELSE 'APAGAR' END AS tipo
          FROM caixa c JOIN parceiros p ON p.codparceiro = c.codparceiro
         WHERE c.idempresa = ${emp}
           AND coalesce(c.codparceiro, 0) <> 0 AND coalesce(p.fun, 'N') = 'N'
           AND c.data::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           AND upper(trim(c.tiporecurso)) IN ('DINHEIRO', '1 - DINHEIRO')),
      doc AS (
        SELECT DISTINCT ON (codparceiro) codparceiro, cnpj_cpf
          FROM parceiros_end ORDER BY codparceiro, (endereco_padrao = 'S') DESC, codend),
      sint AS (
        SELECT m.codparceiro, m.razao, d.cnpj_cpf, m.tipo, sum(m.valor) AS total, count(*)::int AS lancamentos
          FROM mov m LEFT JOIN doc d ON d.codparceiro = m.codparceiro
         GROUP BY m.codparceiro, m.razao, d.cnpj_cpf, m.tipo
        HAVING abs(sum(m.valor)) > ${DME_PISO})`;

    const sintetico = (await sql<Record<string, unknown>>`
      WITH ${mov}
      SELECT * FROM sint ORDER BY tipo, razao, codparceiro LIMIT ${f.limite}`.execute(db)).rows;

    const analitico = f.tipo === 'analitico'
      ? (await sql<Record<string, unknown>>`
          WITH ${mov}
          SELECT m.codcx, m.data, m.obs AS descricao, m.valor, m.codparceiro, m.razao, d.cnpj_cpf, m.tipo
            FROM mov m LEFT JOIN doc d ON d.codparceiro = m.codparceiro
           WHERE m.codparceiro IN (SELECT codparceiro FROM sint)
           ORDER BY m.tipo, m.codparceiro, m.data, m.codcx
           LIMIT ${f.limite}`.execute(db)).rows
      : [];

    const semParceiro = (await sql<Record<string, unknown>>`
      SELECT count(*)::int AS lancamentos, coalesce(sum(valor), 0) AS valor
        FROM caixa c
       WHERE c.idempresa = ${emp} AND coalesce(c.codparceiro, 0) = 0
         AND c.data::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND upper(trim(c.tiporecurso)) IN ('DINHEIRO', '1 - DINHEIRO')`.execute(db)).rows[0] ?? {};

    const empresa = (await sql<Record<string, unknown>>`SELECT fantasia, cnpj FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? null;

    const linhas = sintetico.map((r) => ({ codparceiro: Number(r.codparceiro), razao: r.razao, cnpjCpf: r.cnpj_cpf ?? null, tipo: r.tipo, total: num(r.total), lancamentos: Number(r.lancamentos ?? 0) }));
    const soma = (t: string) => r2(linhas.filter((l) => l.tipo === t).reduce((s, l) => s + l.total, 0));
    return {
      tipo: f.tipo, piso: DME_PISO, empresa,
      sintetico: linhas,
      analitico: analitico.map((r) => ({ ...r, codcx: Number(r.codcx), codparceiro: Number(r.codparceiro), valor: num(r.valor) })),
      truncado: sintetico.length >= f.limite || analitico.length >= f.limite,
      totais: {
        parceiros: new Set(linhas.map((l) => l.codparceiro)).size,
        areceber: { linhas: linhas.filter((l) => l.tipo === 'ARECEBER').length, total: soma('ARECEBER') },
        apagar: { linhas: linhas.filter((l) => l.tipo === 'APAGAR').length, total: soma('APAGAR') },
        semParceiro: { lancamentos: Number(semParceiro.lancamentos ?? 0), valor: num(semParceiro.valor) },
      },
    };
  }
}
