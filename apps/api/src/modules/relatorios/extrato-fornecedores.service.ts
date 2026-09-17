import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ExtratoFornecedoresDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * EXTRATO DE FORNECEDORES (`FRMEXTRATOFORNECEDORES`, `UextratoFornecedores.pas`).
 * **38 acessos, 4 operadores.** Dossiê: `uExtratoFornecedores.md`. Migration 241.
 *
 * O que se deve a cada fornecedor. O modelo mais valioso é o **saldo numa data passada** — quanto se devia no
 * fechamento do mês —, que é uma pergunta que nenhum outro relatório responde.
 *
 * ── Os cinco modelos (`rgModelo`) ─────────────────────────────────────────────────────────────────────
 * · `PERIODO` — a data escolhida entre as duas pontas
 * · `ATE` / `DESDE` — até ou a partir da data, **incluindo os nulos** (`OR data IS NULL`): um título sem
 *   vencimento não some do extrato, que é o que o legado faz de propósito
 * · `SALDO` — comprado até a data **e ainda não pago naquela data**: `dtcompra <= d` e (`dtpgto > d` ou
 *   (`dtpgto` nulo e não quitado)). É o saldo retroativo, e repare que ele olha a data do pagamento, não o
 *   flag: um título pago DEPOIS da data ainda contava como dívida naquele dia
 * · `SALDO2` — tudo comprado até a data, pago ou não
 * O sexto modelo do legado é o saldo de **cheques próprios**, e fica de fora: `CHQ_PROPRIO` tem **0 linhas**.
 *
 * ── ⚠️ Uma coluna com duas semânticas ─────────────────────────────────────────────────────────────────
 * `CASE A.quitada WHEN 'S' THEN P.DTPGTO ELSE A.DTVENC END DTVENC` — a coluna "vencimento" mostra a data do
 * **pagamento** quando o título está quitado. É intencional (o extrato quer a data que importa em cada
 * estado), e foi mantida; a tela nomeia a coluna de acordo.
 *
 * ── ⚠️ O campo Parceiro do legado é injeção de SQL ────────────────────────────────────────────────────
 * ```pascal
 * if POS('%', edtParceiro.Text) > 0 then Filtro := Filtro + ' AND PA.RAZAO LIKE ' + QuotedStr(...)
 * else                                  Filtro := Filtro + ' AND PA.RAZAO ' + edtParceiro.Text;   // cru
 * ```
 * Sem `%`, o texto entra **direto no SQL, sem aspas** (`:126`). Digitar `NESTLE` gera `AND PA.RAZAO NESTLE` e
 * quebra; só funciona se o operador escrever o operador junto (`= 'NESTLE'`). Aqui o campo é um nome e a
 * busca é por trecho — e o LIKE não derruba título sem parceiro.
 */
@Injectable()
export class ExtratoFornecedoresService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: ExtratoFornecedoresDto): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { titulos: number; valor: number; pago: number; juros: number; acreDesc: number; aberto: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const parceiro = f.parceiro ? `%${f.parceiro.toUpperCase()}%` : null;
    const d1 = f.dataIni;
    const d2 = f.dataFim ?? f.dataIni;

    // a data-base do recorte, conforme o rgDatas
    const base = f.base === 'CONTABIL' ? sql`nf.dtcontabil`
      : f.base === 'PAGAMENTO' ? sql`p.dtpgto` : sql`a.dtvenc`;

    const recorte = f.modelo === 'PERIODO' ? sql`${base}::date BETWEEN ${d1}::date AND ${d2}::date`
      // ⚠️ o nulo ENTRA nos modelos de vigência: é o que o legado faz (`OR data IS NULL`)
      : f.modelo === 'ATE' ? sql`(${base}::date <= ${d1}::date OR ${base} IS NULL)`
      : f.modelo === 'DESDE' ? sql`(${base}::date >= ${d1}::date OR ${base} IS NULL)`
      // o saldo retroativo: comprado até a data e ainda não pago NAQUELE dia
      : f.modelo === 'SALDO' ? sql`(a.dtcompra::date <= ${d1}::date
            AND (p.dtpgto::date > ${d1}::date OR (p.dtpgto IS NULL AND coalesce(a.quitada, 'N') <> 'S')))`
      : sql`a.dtcompra::date <= ${d1}::date`;

    const sit = f.situacao === 'ABERTO' ? sql`AND coalesce(a.quitada, 'N') = 'N'`
      : f.situacao === 'BAIXADO' ? sql`AND coalesce(a.quitada, 'N') = 'S'` : sql``;

    const linhas = (await sql<Record<string, unknown>>`
      SELECT a.codapg, a.duplicata, nf.nronf, a.dtcompra, nf.dtcontabil,
             -- ⚠️ a coluna muda de significado: PAGAMENTO quando quitado, VENCIMENTO quando não
             CASE WHEN coalesce(a.quitada, 'N') = 'S' THEN p.dtpgto ELSE a.dtvenc END AS data_referencia,
             a.dtvenc, p.dtpgto,
             coalesce(pa.razao, '(sem parceiro)') AS razao,
             round(coalesce(a.valor, 0)::numeric, 2) AS valor,
             round(coalesce(p.juros, 0)::numeric, 2) AS juros,
             round(coalesce(p.acre_desc, 0)::numeric, 2) AS acre_desc,
             round(coalesce(p.valorpg, 0)::numeric, 2) AS valor_pg,
             coalesce(a.quitada, 'N') AS quitada, p.idlote
        FROM apagar a
        LEFT JOIN apagar_bx p ON p.codapg = a.codapg AND coalesce(p.indr, 'I') = 'I'
        LEFT JOIN parceiros pa ON pa.codparceiro = a.codparceiro
        LEFT JOIN nf ON nf.codnf = a.idnf
       WHERE a.codempresa = ${emp}
         AND ${recorte}
         -- o agrupado sai: já está representado pelo título do grupo
         AND coalesce(a.agrupado, 'N') = 'N'
         ${sit}
         AND (${parceiro}::text IS NULL OR upper(coalesce(pa.razao, '')) LIKE ${parceiro}::text)
       ORDER BY pa.razao, 6, a.codapg
       LIMIT ${f.limite}
    `.execute(db)).rows;

    const t = { titulos: 0, valor: 0, pago: 0, juros: 0, acreDesc: 0, aberto: 0 };
    // o LEFT JOIN com a baixa multiplica: o VALOR do título entra uma vez, o pago soma todas
    const vistos = new Set<number>();
    for (const l of linhas) {
      const cod = Number(l.codapg);
      if (!vistos.has(cod)) {
        vistos.add(cod);
        t.titulos += 1;
        t.valor += num(l.valor);
        if (String(l.quitada) !== 'S') t.aberto += num(l.valor);
      }
      t.pago += num(l.valor_pg);
      t.juros += num(l.juros);
      t.acreDesc += num(l.acre_desc);
    }
    return {
      linhas,
      totais: {
        titulos: t.titulos, valor: r2(t.valor), pago: r2(t.pago),
        juros: r2(t.juros), acreDesc: r2(t.acreDesc), aberto: r2(t.aberto),
      },
    };
  }
}
