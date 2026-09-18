import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ExtratoClientesDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MESES = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

/**
 * EXTRATO DE CLIENTES (`FRMEXTRATOCLIENTES`). **13 acessos, 2 operadores.** Dossiê: `uExtratoClientes.md`. Migration 257.
 *
 * Quatro modelos sobre o A Receber (período / referência a menor / a maior / saldo em), por emissão, vencimento
 * ou baixa; em aberto, baixados ou todos; por cliente; analítico ou sintético. Sempre sem os agrupados.
 *
 * ── Três dos quatro modelos do legado não filtram empresa ───────────────────────────────────────────────
 * Só o "saldo" tem `A.CODEMPRESA`. Medido em 2026: 3.129 títulos na loja 1, **6.364** no total — o extrato de um
 * cliente trazia os títulos dele nas outras lojas. Aqui os quatro são tenant-scoped.
 *
 * ── O "saldo em" confia em `ARECEBER.DTPGTO` — vazio em 44.130 quitados ─────────────────────────────────
 * R$ 13,78 milhões de títulos quitados sem DTPGTO (11.782 com a baixa registrada) entram como em aberto na data
 * de referência. Aqui a data efetiva de pagamento é `coalesce(areceber.dtpgto, dtpgto da baixa ativa)`.
 */
@Injectable()
export class ExtratoClientesService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: ExtratoClientesDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const codparceiro = f.codparceiro ?? null;
    const valorMax = f.valorMax ?? null;

    // a data de pagamento EFETIVA: a do título quando há, senão a da baixa ativa (o defeito dos 44.130)
    const dtpgto = sql`coalesce(a.dtpgto, bx.dtpgto)`;
    const campo = f.campoData === 'emissao' ? sql`a.dtvenda` : f.campoData === 'vencimento' ? sql`a.dtvenc` : dtpgto;
    const ref = sql`${f.dataIni}::date`;
    const filtroModelo =
      f.modelo === 'periodo' ? sql`${campo} >= ${ref} AND ${campo} < ${f.dataFim}::date + 1`
      : f.modelo === 'refMenor' ? sql`(${campo} <= ${ref} OR ${campo} IS NULL)`
      : f.modelo === 'refMaior' ? sql`(${campo} >= ${ref} OR ${campo} IS NULL)`
      : sql`a.dtvenda <= ${ref} AND (${dtpgto} > ${ref} OR ${dtpgto} IS NULL) AND (${valorMax}::numeric IS NULL OR a.valor <= ${valorMax}::numeric)`;
    const filtroStatus = f.status === 'aberto' ? sql`AND coalesce(a.quitada, 'N') = 'N'` : f.status === 'baixado' ? sql`AND a.quitada = 'S'` : sql``;

    const rows = (await sql<Record<string, unknown>>`
      SELECT a.codrcb, a.codparceiro, pa.razao, a.duplicata, nf.nronf, a.nrocupom,
             to_char(a.dtvenda, 'YYYY-MM-DD') AS dtvenda, to_char(a.dtvenc, 'YYYY-MM-DD') AS dtvenc,
             to_char(${dtpgto}, 'YYYY-MM-DD') AS dtpgto,
             a.valor, coalesce(bx.juros, 0) AS juros, coalesce(bx.acre_desc, 0) AS acre_desc, coalesce(bx.valorpg, 0) AS valor_pg,
             coalesce(a.quitada, 'N') AS quitada, extract(month from ${campo})::int AS mes_num, a.obs
        FROM areceber a
        LEFT JOIN LATERAL (SELECT b.juros, b.acre_desc, b.valorpg, b.dtpgto FROM areceber_bx b
                            WHERE b.codrcb = a.codrcb AND coalesce(b.indr, 'I') = 'I' ORDER BY b.dtpgto DESC LIMIT 1) bx ON true
        LEFT JOIN parceiros pa ON pa.codparceiro = a.codparceiro
        LEFT JOIN nf ON nf.codnf = a.idnf
       WHERE a.codempresa = ${emp}
         AND coalesce(a.agrupado, 'N') = 'N'
         AND ${filtroModelo}
         ${filtroStatus}
         AND (${codparceiro}::integer IS NULL OR a.codparceiro = ${codparceiro}::integer)
       ORDER BY pa.razao, a.dtvenc, a.codrcb
       LIMIT ${f.limite + 1}
    `.execute(db)).rows;
    const truncado = rows.length > f.limite;
    const lista = (truncado ? rows.slice(0, f.limite) : rows).map((r) => ({
      codrcb: Number(r.codrcb), codparceiro: Number(r.codparceiro), razao: r.razao ?? '', duplicata: r.duplicata, nronf: r.nronf ?? null, nrocupom: r.nrocupom ?? null,
      dtvenda: r.dtvenda, dtvenc: r.dtvenc, dtpgto: r.dtpgto ?? null,
      valor: r2(num(r.valor)), juros: r2(num(r.juros)), acreDesc: r2(num(r.acre_desc)), valorPg: r2(num(r.valor_pg)),
      quitada: r.quitada, mes: r.mes_num == null ? '' : MESES[Number(r.mes_num) - 1], obs: r.obs ?? null,
    }));
    const totais = {
      titulos: lista.length,
      valor: r2(lista.reduce((s, l) => s + l.valor, 0)), juros: r2(lista.reduce((s, l) => s + l.juros, 0)),
      acreDesc: r2(lista.reduce((s, l) => s + l.acreDesc, 0)), valorPg: r2(lista.reduce((s, l) => s + l.valorPg, 0)),
    };
    if (f.tipo === 'sintetico') {
      const porCliente = new Map<number, { codparceiro: number; razao: string; titulos: number; valor: number; juros: number; acreDesc: number; valorPg: number }>();
      for (const l of lista) {
        const c = porCliente.get(l.codparceiro) ?? { codparceiro: l.codparceiro, razao: String(l.razao), titulos: 0, valor: 0, juros: 0, acreDesc: 0, valorPg: 0 };
        c.titulos++; c.valor = r2(c.valor + l.valor); c.juros = r2(c.juros + l.juros); c.acreDesc = r2(c.acreDesc + l.acreDesc); c.valorPg = r2(c.valorPg + l.valorPg);
        porCliente.set(l.codparceiro, c);
      }
      return { tipo: 'sintetico', modelo: f.modelo, clientes: [...porCliente.values()].sort((a, b) => a.razao.localeCompare(b.razao)), totais, truncado };
    }
    return { tipo: 'analitico', modelo: f.modelo, titulos: lista, totais, truncado };
  }
}
