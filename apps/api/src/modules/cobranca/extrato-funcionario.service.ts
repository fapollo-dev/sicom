import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ExtratoFuncionarioDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** o TIPO do legado é o TEXTO da OBS (UFuncionario.pas:65-70). */
const TIPO_OBS = sql`CASE WHEN upper(a.obs) LIKE '%CONTA ORIGINADA DE VENDAS%' THEN 'Compras'
                          WHEN upper(a.obs) LIKE '%ADIANTAMENTO%' THEN 'Adiantamento'
                          WHEN upper(a.obs) LIKE '%QUEBRA%' THEN 'Quebra'
                          WHEN upper(a.obs) LIKE '%ESTORNO%INDEVIDO%' THEN 'Estorno Indevido'
                          ELSE 'Convênio de Funcionários' END`;

/** o operador do funcionário: MAX(CODOPERADOR) entre os ativos do parceiro (7 parceiros têm 2+ — o MAX escolhe um). */
const OPS = sql`ops AS (SELECT codparceiro, max(codoperador) AS codoperador, count(*)::int AS n
                          FROM operadores WHERE coalesce(desabilitado, 'N') = 'N' AND codparceiro IS NOT NULL
                         GROUP BY codparceiro)`;

/**
 * EXTRATO DE FUNCIONÁRIO (`FRMRELFUNCIONARIO`). **9 acessos, 4 operadores.** Dossiê: `uRelFuncionario.md`.
 * Migration 263.
 *
 * O extrato do convênio de funcionários: DÉBITOS (`areceber`: compras no convênio, quebras de caixa, estornos)
 * e CRÉDITOS (`apagar`: adiantamentos, acertos), no período, por convênio (`parceiros.codconvenio`) e por
 * operador. SINTÉTICO = "1 - Extrato" (funcionário × tipo × dia, com sinal); ANALÍTICO = "2/3" (linha a
 * linha, com o centro de custo: AR por `codplc`, AP por `codplcfuncionarios`).
 *
 * Regras copiadas do fonte (UFuncionario.pas): exclui agrupados (AR `agrupado<>'S'`; AP também
 * `codcxagrupamentocr = 0`); AP entra '+', AR '−'; situação pela QUITADA; o filtro "Tipo" é o mesmo LIKE na
 * OBS; convênio obrigatório quando o filtro é "Todos" (`Validacoes`, URelFuncionario.pas:272-276) e, se
 * informado, tem de ser convênio de alguém (`ParceiroEConvenio`). O 3º ramo do UNION (`AGRUPARECEBER`) tem
 * **0 linhas na produção** e não foi replicado.
 *
 * ⚠️ O legado não filtra empresa (`FiltraEmpresa := False`) — em 2026 o AP de funcionários está em 4
 * empresas e o AR em 2. Aqui tenant-scoped. E 74% dos AR de funcionários de 2026 (7.490, R$ 314 mil) têm
 * `AGRUPADO='S'` e ficam fora por regra — os consolidados (OBS nula) caem em 'Convênio de Funcionários'.
 */
@Injectable()
export class ExtratoFuncionarioService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private filtroObs(f: ExtratoFuncionarioDto) {
    switch (f.filtro) {
      case 'compra': return sql`AND upper(a.obs) LIKE '%CONTA ORIGINADA DE VENDAS%'`;
      case 'adiantamento': return sql`AND upper(a.obs) LIKE '%ADIANTAMENTO%'`;
      case 'quebra': return sql`AND upper(a.obs) LIKE '%QUEBRA%'`;
      case 'estorno': return sql`AND upper(a.obs) LIKE '%ESTORNO%INDEVIDO%'`;
      default: return sql``;
    }
  }

  private situacao(f: ExtratoFuncionarioDto) {
    if (f.situacao === 'quitados') return sql`AND a.quitada = 'S'`;
    if (f.situacao === 'abertos') return sql`AND coalesce(a.quitada, 'N') <> 'S'`;
    return sql``;
  }

  /** os parceiros que são `codconvenio` de funcionários — a lista do botão de busca do legado. */
  async convenios(): Promise<Array<Record<string, unknown>>> {
    const rows = (await sql<Record<string, unknown>>`
      SELECT c.codparceiro, c.razao, c.fantasia, count(f.codparceiro)::int AS funcionarios
        FROM parceiros c JOIN parceiros f ON f.codconvenio = c.codparceiro
       GROUP BY c.codparceiro, c.razao, c.fantasia
       ORDER BY c.razao`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    return rows.map((r) => ({ ...r, codparceiro: Number(r.codparceiro) }));
  }

  private async validar(db: AnyDB, f: ExtratoFuncionarioDto) {
    if (f.filtro === 'todos' && f.codconvenio == null) throw new BusinessRuleError('CONVENIO_OBRIGATORIO');
    if (f.codconvenio != null) {
      const e = (await sql<{ ok: unknown }>`SELECT 1 AS ok FROM parceiros WHERE codconvenio = ${f.codconvenio} LIMIT 1`.execute(db)).rows[0];
      if (!e) throw new BusinessRuleError('PARCEIRO_NAO_E_CONVENIO', { codparceiro: f.codconvenio });
    }
  }

  async gerar(f: ExtratoFuncionarioDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.validar(db, f);
    const conv = f.codconvenio ?? null;
    const opf = f.codoperador ?? null;
    const sit = this.situacao(f);
    const obs = this.filtroObs(f);
    const comum = sql`
         AND (${conv}::integer IS NULL OR p.codconvenio = ${conv}::integer)
         AND (${opf}::integer IS NULL OR op.codoperador = ${opf}::integer)
         ${sit} ${obs}`;
    const whereAp = sql`
       WHERE a.codempresa = ${emp}
         AND coalesce(a.codcxagrupamentocr, 0) = 0 AND coalesce(a.agrupado, 'N') = 'N'
         AND a.dtcompra::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date ${comum}`;
    const whereAr = sql`
       WHERE a.codempresa = ${emp}
         AND coalesce(a.agrupado, 'N') = 'N'
         AND a.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date ${comum}`;

    const linhas = f.tipo === 'sintetico'
      ? (await sql<Record<string, unknown>>`
          WITH ${OPS},
          ap AS (
            SELECT a.codparceiro, op.codoperador, coalesce(op.n, 0) AS operadores, p.fantasia AS nome, ${TIPO_OBS} AS tipo,
                   a.dtcompra::date AS data, '+' AS sinal, sum(a.valor) AS valor, count(*)::int AS titulos
              FROM apagar a JOIN parceiros p ON p.codparceiro = a.codparceiro LEFT JOIN ops op ON op.codparceiro = p.codparceiro
              ${whereAp}
             GROUP BY 1, 2, 3, 4, 5, 6),
          ar AS (
            SELECT a.codparceiro, op.codoperador, coalesce(op.n, 0) AS operadores, p.fantasia AS nome, ${TIPO_OBS} AS tipo,
                   a.dtvenda::date AS data, '-' AS sinal, sum(a.valor) AS valor, count(*)::int AS titulos
              FROM areceber a JOIN parceiros p ON p.codparceiro = a.codparceiro LEFT JOIN ops op ON op.codparceiro = p.codparceiro
              ${whereAr}
             GROUP BY 1, 2, 3, 4, 5, 6)
          SELECT * FROM (SELECT * FROM ap UNION ALL SELECT * FROM ar) x
           ORDER BY nome, codoperador, codparceiro, tipo, data, sinal
           LIMIT ${f.limite}`.execute(db)).rows
      : (await sql<Record<string, unknown>>`
          WITH ${OPS},
          ar AS (
            SELECT a.codparceiro, op.codoperador, coalesce(op.n, 0) AS operadores, p.fantasia AS nome, pl.desccodplc,
                   coalesce(pl.descricao, coalesce(a.obs, 'Convênios de funcionários')) AS tipo,
                   a.dtvenda::date AS data, a.valor * (-1) AS valor, a.codrcb AS documento, a.nrodup AS parcelas, a.tipodoc, a.obs,
                   'AR' AS origem, coalesce(a.quitada, 'N') AS quitada
              FROM areceber a JOIN parceiros p ON p.codparceiro = a.codparceiro LEFT JOIN ops op ON op.codparceiro = p.codparceiro
              LEFT JOIN plc pl ON pl.codplc = a.codplc
              ${whereAr}),
          ap AS (
            SELECT a.codparceiro, op.codoperador, coalesce(op.n, 0) AS operadores, p.fantasia AS nome, pl.desccodplc,
                   coalesce(pl.descricao, coalesce(a.obs, 'Convênios de funcionários')) AS tipo,
                   a.dtcompra::date AS data, a.valor AS valor, a.codapg AS documento, a.nrodup AS parcelas, a.tipodoc, a.obs,
                   'AP' AS origem, coalesce(a.quitada, 'N') AS quitada
              FROM apagar a JOIN parceiros p ON p.codparceiro = a.codparceiro LEFT JOIN ops op ON op.codparceiro = p.codparceiro
              LEFT JOIN plc pl ON pl.codplc = a.codplcfuncionarios
              ${whereAp})
          SELECT * FROM (SELECT * FROM ar UNION ALL SELECT * FROM ap) x
           ORDER BY nome, codoperador, codparceiro, tipo, desccodplc, data
           LIMIT ${f.limite}`.execute(db)).rows;

    // por funcionário: créditos (AP, '+') − débitos (AR, '−') = saldo
    const porFuncionario = new Map<number, { codparceiro: number; nome: string; codoperador: number | null; operadores: number; creditos: number; debitos: number; saldo: number; linhas: number }>();
    for (const l of linhas) {
      const cod = Number(l.codparceiro);
      const cur = porFuncionario.get(cod) ?? { codparceiro: cod, nome: String(l.nome ?? ''), codoperador: l.codoperador == null ? null : Number(l.codoperador), operadores: Number(l.operadores ?? 0), creditos: 0, debitos: 0, saldo: 0, linhas: 0 };
      const v = num(l.valor);
      const credito = f.tipo === 'sintetico' ? l.sinal === '+' : v >= 0;
      if (credito) cur.creditos += Math.abs(v); else cur.debitos += Math.abs(v);
      cur.linhas += 1;
      porFuncionario.set(cod, cur);
    }
    const funcionarios = [...porFuncionario.values()].map((x) => ({ ...x, creditos: r2(x.creditos), debitos: r2(x.debitos), saldo: r2(x.creditos - x.debitos) }));
    const creditos = r2(funcionarios.reduce((s, x) => s + x.creditos, 0));
    const debitos = r2(funcionarios.reduce((s, x) => s + x.debitos, 0));

    return {
      tipo: f.tipo,
      linhas: linhas.map((l) => ({ ...l, codparceiro: Number(l.codparceiro), codoperador: l.codoperador == null ? null : Number(l.codoperador), valor: num(l.valor) })),
      funcionarios,
      truncado: linhas.length >= f.limite,
      totais: { linhas: linhas.length, funcionarios: funcionarios.length, creditos, debitos, saldo: r2(creditos - debitos) },
    };
  }
}
