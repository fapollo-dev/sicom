import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelEntradasFinanDto, RelEntradasFinanTitulosDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * ENTRADAS × FINANCEIRO (`FRMRELENTRADAS_FINAN`). **11 acessos, 3 operadores.** Dossiê: `uRelEntradas_Finan.md`.
 * Migration 262.
 *
 * "Das notas de entrada do período, quais têm título a pagar — e quais não têm?" Grid de cima: NF tipo E por
 * DTCONTABIL (NRONF ≠ '0'), com totais e fornecedor; grid de baixo: os títulos de `apagar` com `idnf` = a nota,
 * com filtro opcional de vencimento.
 *
 * ── O que mudou em relação ao legado, e por quê ───────────────────────────────────────────────────────
 *  · tenant-scoped (o legado misturava as três lojas: 6.547 NF em 2026);
 *  · `COALESCE(TOTALPROD, 0.01)` não replicado (era gambiarra de divisor; 0 nulos em 2026);
 *  · a nota CANCELADA vem marcada, não escondida;
 *  · cada nota traz `titulos`/`valorTitulos`/`quitados`, e o total traz `semTitulo` — na loja 1, **346 de
 *    4.007** NF de entrada de 2026 (R$ 438 mil) não têm título nenhum. É o número que a tela existe para achar.
 */
@Injectable()
export class RelEntradasFinanService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: RelEntradasFinanDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const cod = f.codparceiro ?? null;
    const base = sql`
        FROM nf n
        LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS titulos, coalesce(sum(a.valor), 0) AS valor_titulos,
                 count(*) FILTER (WHERE coalesce(a.quitada, 'N') = 'S')::int AS quitados
            FROM apagar a WHERE a.idnf = n.codnf) t ON true
       WHERE n.idempresa = ${emp} AND n.tipo = 'E'
         AND coalesce(nullif(trim(n.nronf), ''), '0') <> '0'
         AND n.dtcontabil::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND (${cod}::integer IS NULL OR n.codparceiro = ${cod}::integer)`;

    const notas = (await sql<Record<string, unknown>>`
      SELECT n.codnf, n.nronf, n.serie, n.dtemissao::date AS dtemissao, n.dtcontabil::date AS dtcontabil,
             n.totalprod, n.totalnf, coalesce(n.cancelada, 'N') AS cancelada, n.codparceiro, p.razao AS fornecedor,
             t.titulos, t.valor_titulos, t.quitados
        ${base}
         AND (NOT ${f.somenteSemTitulo}::boolean OR t.titulos = 0)
       ORDER BY n.dtcontabil, n.nronf, n.codnf
       LIMIT ${f.limite}`.execute(db)).rows;

    const tot = (await sql<Record<string, unknown>>`
      SELECT count(*)::int AS notas, coalesce(sum(n.totalprod), 0) AS totalprod, coalesce(sum(n.totalnf), 0) AS totalnf,
             count(*) FILTER (WHERE t.titulos = 0)::int AS sem_titulo,
             coalesce(sum(n.totalnf) FILTER (WHERE t.titulos = 0), 0) AS valor_sem_titulo,
             coalesce(sum(t.valor_titulos), 0) AS valor_titulos,
             count(*) FILTER (WHERE coalesce(n.cancelada, 'N') = 'S')::int AS canceladas
        ${base}`.execute(db)).rows[0] ?? {};

    return {
      notas: notas.map((r) => ({
        codnf: Number(r.codnf), nronf: r.nronf, serie: r.serie ?? null, dtemissao: r.dtemissao, dtcontabil: r.dtcontabil,
        totalprod: num(r.totalprod), totalnf: num(r.totalnf), cancelada: r.cancelada === 'S',
        codparceiro: r.codparceiro == null ? null : Number(r.codparceiro), fornecedor: r.fornecedor ?? '(sem fornecedor)',
        titulos: Number(r.titulos ?? 0), valorTitulos: num(r.valor_titulos), quitados: Number(r.quitados ?? 0),
      })),
      truncado: notas.length >= f.limite,
      totais: {
        notas: Number(tot.notas ?? 0), totalprod: num(tot.totalprod), totalnf: num(tot.totalnf),
        semTitulo: Number(tot.sem_titulo ?? 0), valorSemTitulo: num(tot.valor_sem_titulo),
        valorTitulos: num(tot.valor_titulos), canceladas: Number(tot.canceladas ?? 0),
      },
    };
  }

  /** o grid de baixo: os títulos da nota (só de nota da própria loja), com o filtro de vencimento do legado. */
  async titulos(codnf: number, q: RelEntradasFinanTitulosDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const nf = (await sql<Record<string, unknown>>`SELECT codnf, nronf, idempresa FROM nf WHERE codnf = ${codnf}`.execute(db)).rows[0];
    if (!nf || Number(nf.idempresa) !== emp) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    const vi = q.vencIni ?? null;
    const vf = q.vencFim ?? null;
    const rows = (await sql<Record<string, unknown>>`
      SELECT a.codapg, a.duplicata, a.obs, a.dtcompra::date AS dtcompra, a.codoperador, o.nome AS operador,
             a.codparceiro, d.razao AS fornecedor, coalesce(a.quitada, 'N') AS quitada, a.codempresa, a.idnf, a.gerado,
             a.valor, a.txjuros, a.dtvenc::date AS dtvenc, a.dtpgto::date AS dtpgto, a.tipodoc, a.codbco, b.banco,
             a.gfat, a.nrparcela, a.codgrupo
        FROM apagar a
        LEFT JOIN parceiros d  ON d.codparceiro = a.codparceiro
        LEFT JOIN operadores o ON o.codoperador = a.codoperador
        LEFT JOIN bancos b     ON b.codbco = a.codbco
       WHERE a.idnf = ${codnf}
         AND (${vi}::date IS NULL OR a.dtvenc::date >= ${vi}::date)
         AND (${vf}::date IS NULL OR a.dtvenc::date <= ${vf}::date)
       ORDER BY a.dtvenc, a.codapg`.execute(db)).rows;
    return {
      codnf, nronf: nf.nronf,
      titulos: rows.map((r) => ({ ...r, codapg: Number(r.codapg), valor: num(r.valor), txjuros: num(r.txjuros), quitada: r.quitada === 'S' })),
      totais: { titulos: rows.length, valor: rows.reduce((s, r) => s + num(r.valor), 0), quitados: rows.filter((r) => r.quitada === 'S').length },
    };
  }
}
