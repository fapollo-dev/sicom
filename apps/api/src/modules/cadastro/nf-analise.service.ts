import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

export type ModeloAnalise = 'TRIBUTARIA' | 'CONFERENCIA';

export interface FiltroAnalise {
  dataIni: string;
  dataFim: string;
  /** 'T' todos · 'E' entrada · 'S' saída (o combo Tipo da tela). */
  tipo?: 'T' | 'E' | 'S';
  nronf?: string | null;
  codparceiro?: number | null;
  razao?: string | null;
  cfop?: number | string | null;
  /** 'S' processadas · 'N' não processadas · 'T' todas (o radio "Notas Processadas"). */
  processadas?: 'S' | 'N' | 'T';
  /** o "Incluir notas de devolução" — desmarcado, exclui os CFOPs marcados como devolução. */
  incluirDevolucao?: boolean;
  /** o "Somente diferenças": nota cujo rateio contábil não fecha com o total. */
  somenteDiferencas?: boolean;
}

/**
 * ANÁLISE DE NOTAS FISCAIS (`FRMNFANALISE`, `UNFAnalise.pas`). Dossiê: `uNFAnalise.md`.
 *
 * A tela de maior uso ainda não migrada fora do PDV — **704 acessos, 19 operadores, o último em 04/09/2026**.
 * É um HUB de nove análises sobre notas; este corte traz as duas que não dependem de nada além do que já
 * existe no Apollo.
 *
 * **1 — SITUAÇÃO TRIBUTÁRIA** (`sqqNF`, `UdmNFAnalise.dfm:352`): as notas do período com o total, o isento e
 * as outras despesas, por parceiro e CFOP. O que dá valor a ela é o filtro **"somente diferenças"**
 * (`UNFAnalise.pas:746`): mostra a nota cujo **rateio contábil não fecha com o total** —
 * `TOTALNF <> (SELECT sum(VALOR) FROM CODCONTABILNF WHERE CODNF = N.CODNF)`. No cliente isso pega
 * **3.037 das 49.282 notas (6,2%)**, e cada uma é um lançamento contábil que vai sair errado.
 *
 * **8 — CONFERÊNCIA DE NOTAS** (`GetSqlAnaliseConferencia` :1257): as notas que alguém ALTEROU, com o nome de
 * quem alterou (`USULTALTERACAO IS NOT NULL`). É a trilha de quem mexeu na nota depois de lançada.
 *
 * Os filtros são os da tela e valem para as duas: período por `DTCONTABIL`, tipo, número, parceiro, razão,
 * CFOP, processadas, devolução.
 *
 * ADIADO (fiel, com procedência): as outras sete opções — precificação (2, 4, 5), tributária por produto (3),
 * formas de pagamento (6), por CST (7) e ICMS-ST a recolher (9). As de precificação dependem do departamento
 * e do agrupamento por fornecedor; a 9 monta um demonstrativo de ST com 24 colunas sobre `nfe_nao_cadastradas`.
 */
@Injectable()
export class NfAnaliseService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async analisar(modelo: ModeloAnalise, f: FiltroAnalise): Promise<{
    modelo: ModeloAnalise; linhas: Array<Record<string, unknown>>;
    totais: { notas: number; totalnf: number; totalprod: number; totalisento: number; divergencia: number };
    truncado: boolean;
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (!f.dataIni || !f.dataFim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');

    const onde = this.filtros(emp, f);
    const LIMITE = 5000;

    // o rateio contábil da nota — é a soma que o "somente diferenças" confronta com o total.
    const rateio = sql`(SELECT coalesce(sum(e.valor), 0.01)::numeric(15,2) FROM nf_contabil e WHERE e.codnf = n.codnf)`;

    const linhas = (await sql<Record<string, unknown>>`
      SELECT n.codnf, n.nronf, to_char(n.dtemissao, 'YYYY-MM-DD') AS dtemissao,
             to_char(n.dtcontabil, 'YYYY-MM-DD') AS dtcontabil,
             n.tipo, n.cfop, c.descricao AS cfop_descricao,
             n.codparceiro, p.razao,
             coalesce(n.totalprod, 0.01) AS totalprod, n.totalnf,
             coalesce(n.totalisento, 0) AS totalisento,
             coalesce(n.totaloutrasdesp, 0) AS totaloutrasdesp,
             coalesce(n.proc, 'N') AS proc,
             ${rateio} AS rateio_contabil,
             (n.totalnf - ${rateio}) AS diferenca,
             ${modelo === 'CONFERENCIA' ? sql`o.nome` : sql`NULL::text`} AS alterado_por,
             ${modelo === 'CONFERENCIA' ? sql`to_char(n.dtultimalteracao, 'YYYY-MM-DD HH24:MI')` : sql`NULL::text`} AS alterado_em
        FROM nf n
        LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
        LEFT JOIN cfop c      ON c.codcfop = n.cfop
        LEFT JOIN operadores o ON o.codoperador = n.usultalteracao
       WHERE ${sql.join(onde, sql` AND `)}
         ${modelo === 'CONFERENCIA' ? sql`AND n.usultalteracao IS NOT NULL` : sql``}
       ORDER BY n.nronf
       LIMIT ${LIMITE + 1}
    `.execute(db)).rows;

    const truncado = linhas.length > LIMITE;
    if (truncado) linhas.length = LIMITE;

    const num = (v: unknown) => (v == null ? 0 : Number(v));
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    return {
      modelo,
      linhas,
      totais: {
        notas: linhas.length,
        totalnf: r2(linhas.reduce((s, l) => s + num(l.totalnf), 0)),
        totalprod: r2(linhas.reduce((s, l) => s + num(l.totalprod), 0)),
        totalisento: r2(linhas.reduce((s, l) => s + num(l.totalisento), 0)),
        divergencia: r2(linhas.reduce((s, l) => s + num(l.diferenca), 0)),
      },
      truncado,
    };
  }

  /** os filtros da tela, um a um (`UNFAnalise.pas:700-760`). */
  private filtros(emp: number, f: FiltroAnalise) {
    const onde = [
      sql`n.idempresa = ${emp}`,
      sql`n.dtcontabil::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`,
    ];
    // o combo Tipo vira `TIPO LIKE '%'` quando é "Todos" — aqui é explícito.
    if (f.tipo === 'E' || f.tipo === 'S') onde.push(sql`n.tipo = ${f.tipo}`);
    if (f.nronf) onde.push(sql`n.nronf LIKE ${`%${f.nronf}%`}`);
    if (f.codparceiro) onde.push(sql`n.codparceiro = ${f.codparceiro}`);
    if (f.razao) onde.push(sql`p.razao ILIKE ${`%${f.razao}%`}`);
    // ⚠️ `nf.cfop` é varchar(4) e `cfop.codcfop` é char(4) no destino — o CFOP é CÓDIGO, não número.
    // Comparar com inteiro dá "operator does not exist: character = integer".
    if (f.cfop) onde.push(sql`n.cfop = ${String(f.cfop)}`);
    // o radio "Notas Processadas": 0 = processadas, 1 = não (inclui nulo), 2 = todas.
    if (f.processadas === 'S') onde.push(sql`n.proc = 'S'`);
    if (f.processadas === 'N') onde.push(sql`(n.proc = 'N' OR n.proc IS NULL)`);
    // desmarcado, exclui o CFOP de devolução — e CFOP sem marca conta como "não é devolução" (:734).
    if (!f.incluirDevolucao) onde.push(sql`(coalesce(c.devolucao, 'N') <> 'S')`);
    // "somente diferenças": o rateio contábil não fecha com o total da nota (:746).
    if (f.somenteDiferencas) {
      onde.push(sql`n.totalnf <> (SELECT coalesce(sum(e.valor), 0.01)::numeric(15,2) FROM nf_contabil e WHERE e.codnf = n.codnf)`);
    }
    return onde;
  }
}
