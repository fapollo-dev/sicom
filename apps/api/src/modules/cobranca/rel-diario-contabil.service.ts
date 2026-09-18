import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelDiarioContabilDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * LIVRO DIÁRIO (`FRMRELDIARIOCONTABIL`). **4 acessos, 4 operadores.** Dossiê: `uRelDiarioContabil.md`.
 * Migration 270.
 *
 * O terceiro livro da casa, ao lado do balancete (258) e do balanço (265): cada lançamento do diário vira
 * DUAS linhas — uma na conta debitada, outra na creditada — com data, código expandido, descrição da
 * conta, histórico (`deschist` + `complemento`), origem (com o nome, de `origem_contabil`), documento e o
 * valor na coluna certa.
 *
 * ── O fold que muda número ────────────────────────────────────────────────────────────────────────────
 * O legado usa `UNION` (não `UNION ALL`): duas linhas idênticas em tudo — mesmo dia, conta, histórico,
 * origem, documento e valor — colapsam numa só, e o livro perde um lançamento legítimo. Aqui é
 * `UNION ALL`, com o `coddiario` em cada linha. E é tenant-scoped: o legado somava as cinco empresas.
 */
@Injectable()
export class RelDiarioContabilService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: RelDiarioContabilDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const conta = f.conta?.trim() ? `${f.conta.trim()}%` : null;
    const origem = f.codorigem ?? null;

    const linhas = (await sql<Record<string, unknown>>`
      WITH mov AS (
        SELECT d.coddiario, d.datalan, d.contadebito AS conta, d.valor AS debito, 0::numeric AS credito,
               d.deschist, d.complemento, d.codorigem, d.idorigem, d.documento
          FROM diario d
         WHERE d.codempresa = ${emp} AND d.contadebito IS NOT NULL
           AND d.datalan BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
        UNION ALL
        SELECT d.coddiario, d.datalan, d.contacredito AS conta, 0::numeric AS debito, d.valor AS credito,
               d.deschist, d.complemento, d.codorigem, d.idorigem, d.documento
          FROM diario d
         WHERE d.codempresa = ${emp} AND d.contacredito IS NOT NULL
           AND d.datalan BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
      )
      SELECT m.coddiario, m.datalan AS dia, p.codiexpandido AS conta, p.codplanocontas AS codigoconta,
             p.descricao, trim(coalesce(m.deschist, '') || ' ' || coalesce(m.complemento, '')) AS historico,
             m.codorigem AS origem, o.descorigem AS nome_origem, m.idorigem, m.documento,
             m.debito, m.credito
        FROM mov m
        LEFT JOIN plano_contas p    ON p.codplanocontas = m.conta
        LEFT JOIN origem_contabil o ON o.codorigem = m.codorigem
       WHERE (${conta}::text IS NULL OR p.codiexpandido LIKE ${conta}::text)
         AND (${origem}::integer IS NULL OR m.codorigem = ${origem}::integer)
       ORDER BY m.datalan, p.codiexpandido, m.coddiario
       LIMIT ${f.limite}`.execute(db)).rows;

    const tot = (await sql<Record<string, unknown>>`
      SELECT count(*)::int AS lancamentos,
             coalesce(sum(CASE WHEN contadebito  IS NOT NULL THEN valor ELSE 0 END), 0) AS debito,
             coalesce(sum(CASE WHEN contacredito IS NOT NULL THEN valor ELSE 0 END), 0) AS credito,
             count(*) FILTER (WHERE contadebito IS NULL OR contacredito IS NULL)::int AS meia_partida
        FROM diario
       WHERE codempresa = ${emp} AND datalan BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`.execute(db)).rows[0] ?? {};

    const contabilista = (await sql<Record<string, unknown>>`
      SELECT nome, cpf, crc, cnpj FROM contabilista WHERE codempresa = ${emp}`.execute(db)).rows[0] ?? null;

    const debitoNaLista = r2(linhas.reduce((s, l) => s + num(l.debito), 0));
    const creditoNaLista = r2(linhas.reduce((s, l) => s + num(l.credito), 0));
    return {
      periodo: { de: f.dataIni, ate: f.dataFim },
      contabilista,
      linhas: linhas.map((l) => ({ ...l, coddiario: Number(l.coddiario), debito: num(l.debito), credito: num(l.credito) })),
      truncado: linhas.length >= f.limite,
      totais: {
        linhas: linhas.length, lancamentos: Number(tot.lancamentos ?? 0),
        debito: debitoNaLista, credito: creditoNaLista,
        debitoPeriodo: r2(num(tot.debito)), creditoPeriodo: r2(num(tot.credito)),
        /** lançamento com só uma perna preenchida — vira uma linha só no livro */
        meiaPartida: Number(tot.meia_partida ?? 0),
        diferenca: r2(debitoNaLista - creditoNaLista),
      },
    };
  }
}
