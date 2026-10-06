import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelEntradasFinanDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { todasAsEmpresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { empresaParaRelatorio, registroFr3 } from '../../shared/relatorios/registro-fr3';

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
 * Corte 2 pelo fonte (06/10/2026) — o `sqqNF` e o `sqqPagar` do `uDMRelEntradas_Finan`:
 *  - as notas: `TIPO = 'E'`, `TRUNC(DTCONTABIL) BETWEEN`, `NRONF <> '0' AND NRONF IS NOT NULL`, o fornecedor opcional; `TRUNC(DTEMISSAO)`,
 *    `COALESCE(TOTALPROD, 0.01)`; `ORDER BY DTEMISSAO, NRONF` (o NRONF é texto: ordem binária); a cancelada entra (sem filtro), marcada;
 *  - ⚠️ **sem filtro de loja** no legado (6.975 NF de entrada de 2026 em 3 lojas): o Apollo traz as de todas as lojas que o operador
 *    alcança (o corte 1 recortava na loja do login e tinha LIMIT 3000);
 *  - os títulos: `APAGAR` com `IDNF = CODNF` (o `cdsNFsqqPagar` aninhado), com o fornecedor, o operador e o banco. Os campos de
 *    vencimento/emissão da tela legada **não filtram** — o `FiltraDoc` está comentado no fonte (o corte 1 filtrava);
 *  - os contadores (títulos, quitados, sem título) e o "só sem título" são do Apollo e não mudam a lista padrão.
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
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const emps = await todasAsEmpresasDoOperador(db);
    const cod = f.codparceiro ?? null;
    const base = sql`
        FROM nf n
        LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS titulos, coalesce(sum(a.valor), 0) AS valor_titulos,
                 count(*) FILTER (WHERE coalesce(a.quitada, 'N') = 'S')::int AS quitados
            FROM apagar a WHERE a.idnf = n.codnf) t ON true
       WHERE n.idempresa = ANY(${emps}) AND n.tipo = 'E'
         AND n.nronf <> '0' AND n.nronf IS NOT NULL
         AND n.dtcontabil::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND (${cod}::integer IS NULL OR n.codparceiro = ${cod}::integer)`;

    const notas = (await sql<Record<string, unknown>>`
      SELECT n.codnf, n.nronf, n.serie, n.dtemissao::date AS dtemissao, n.dtcontabil::date AS dtcontabil,
             coalesce(n.totalprod, 0.01) AS totalprod, n.totalnf, coalesce(n.cancelada, 'N') AS cancelada, n.codparceiro, p.razao AS fornecedor,
             n.idempresa, t.titulos, t.valor_titulos, t.quitados
        ${base}
         AND (NOT ${f.somenteSemTitulo}::boolean OR t.titulos = 0)
       ORDER BY n.dtemissao::date, n.nronf COLLATE "C", n.codnf`.execute(db)).rows;

    const tot = (await sql<Record<string, unknown>>`
      SELECT count(*)::int AS notas, coalesce(sum(coalesce(n.totalprod, 0.01)), 0) AS totalprod, coalesce(sum(n.totalnf), 0) AS totalnf,
             count(*) FILTER (WHERE t.titulos = 0)::int AS sem_titulo,
             coalesce(sum(n.totalnf) FILTER (WHERE t.titulos = 0), 0) AS valor_sem_titulo,
             coalesce(sum(t.valor_titulos), 0) AS valor_titulos,
             count(*) FILTER (WHERE coalesce(n.cancelada, 'N') = 'S')::int AS canceladas
        ${base}`.execute(db)).rows[0] ?? {};

    return {
      notas: notas.map((r) => ({
        codnf: Number(r.codnf), nronf: r.nronf, serie: r.serie ?? null, dtemissao: r.dtemissao, dtcontabil: r.dtcontabil,
        totalprod: num(r.totalprod), totalnf: num(r.totalnf), cancelada: r.cancelada === 'S',
        codparceiro: r.codparceiro == null ? null : Number(r.codparceiro), fornecedor: r.fornecedor ?? null, idempresa: Number(r.idempresa),
        titulos: Number(r.titulos ?? 0), valorTitulos: num(r.valor_titulos), quitados: Number(r.quitados ?? 0),
      })),
      empresas: emps,
      totais: {
        notas: Number(tot.notas ?? 0), totalprod: num(tot.totalprod), totalnf: num(tot.totalnf),
        semTitulo: Number(tot.sem_titulo ?? 0), valorSemTitulo: num(tot.valor_sem_titulo),
        valorTitulos: num(tot.valor_titulos), canceladas: Number(tot.canceladas ?? 0),
      },
    };
  }

  private static readonly SQL_TITULOS = sql`
      SELECT a.codapg, a.duplicata, a.obs, a.dtcompra, a.codoperador, o.nome AS descoperador, a.codparceiro, d.razao AS descforn,
             a.quitada, a.codempresa AS idempresa, a.idnf, a.gerado, a.valor, a.txjuros, a.dtvenc, a.tipodoc, a.codbco, b.banco AS descbanco,
             a.gfat, a.nrparcela, a.codgrupo
        FROM apagar a
        LEFT JOIN parceiros d  ON d.codparceiro = a.codparceiro
        LEFT JOIN operadores o ON o.codoperador = a.codoperador
        LEFT JOIN bancos b     ON b.codbco = a.codbco`;

  /** o grid de baixo: os títulos da nota (`sqqPagar`, `P.IDNF = :CODNF`; sem ORDER BY no legado — aqui pelo código) */
  async titulos(codnf: number): Promise<Record<string, unknown>> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const emps = await todasAsEmpresasDoOperador(db);
    const nf = (await sql<Record<string, unknown>>`SELECT codnf, nronf, idempresa FROM nf WHERE codnf = ${codnf}`.execute(db)).rows[0];
    if (!nf || !emps.includes(Number(nf.idempresa))) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    const rows = (await sql<Record<string, unknown>>`${RelEntradasFinanService.SQL_TITULOS} WHERE a.idnf = ${codnf} ORDER BY a.codapg`.execute(db)).rows;
    return {
      codnf, nronf: nf.nronf,
      titulos: rows.map((r) => ({ ...r, codapg: Number(r.codapg), valor: num(r.valor), txjuros: num(r.txjuros), quitada: r.quitada === 'S' })),
      totais: { titulos: rows.length, valor: rows.reduce((s, r) => s + num(r.valor), 0), quitados: rows.filter((r) => r.quitada === 'S').length },
    };
  }

  /**
   * O Imprimir (`btnImprimirClick`): `Relatorios\Notas_fiscais_Entradas_Finan.fr3` com o `cdsNF` no `frxDBDatasetNF`, o `cdsPagar`
   * aninhado (os títulos de cada nota) no `frxDBDatasetPagar` e a empresa do login no `frxDBDataset2`. A lista é a da consulta (o legado
   * só habilita o Imprimir com notas).
   */
  async impressao(f: RelEntradasFinanDto) {
    const emp = this.emp();
    const r = await this.gerar(f);
    const db = this.dbp.forTenantRead() as AnyDB;
    const notas = r.notas as Array<Record<string, unknown>>;
    if (!notas.length) throw new BusinessRuleError('SEM_NOTAS', {}, 'Não há notas de entrada no período para imprimir.');
    const ids = notas.map((n) => Number(n.codnf));
    const pagar = (await sql<Record<string, unknown>>`${RelEntradasFinanService.SQL_TITULOS} WHERE a.idnf = ANY(${ids}) ORDER BY a.codapg`.execute(db)).rows;
    const nums = new Set(['codnf', 'totalprod', 'totalnf', 'codparceiro', 'codapg', 'codoperador', 'idempresa', 'idnf', 'valor', 'txjuros', 'codbco', 'codgrupo']);
    return {
      titulo: 'Notas fiscais de entrada × financeiro',
      modelo: await modeloFr3(db, 'Notas_fiscais_Entradas_Finan.fr3'),
      datasets: {
        frxDBDatasetNF: notas.map((n) => registroFr3({
          nronf: n.nronf, codnf: n.codnf, dtemissao: n.dtemissao, totalprod: n.totalprod, totalnf: n.totalnf, razao: n.fornecedor, codparceiro: n.codparceiro,
        }, nums)),
        frxDBDatasetPagar: pagar.map((p) => ({ ...registroFr3(p, nums), __MESTRE: ids.indexOf(Number(p.idnf)) })),
        frxDBDataset2: [await empresaParaRelatorio(db, emp)],
      },
    };
  }
}
