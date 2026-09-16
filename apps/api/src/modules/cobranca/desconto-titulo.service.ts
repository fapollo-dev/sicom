import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * DESCONTO DE TÍTULOS (`FRMDESCONTOTITULO`, `uDescontoTitulo.pas` 1.971 linhas + DM 558).
 * Dossiê: `uDescontoTitulo.md`. **68 acessos, 11 operadores.**
 *
 * ⚠️ **Não é desconto bancário de duplicata — é ENCONTRO DE CONTAS** entre um título a receber e um a pagar
 * do mesmo parceiro. O autor do legado documentou a mecânica num comentário dentro do `Gravar` (`:886`):
 *
 *  · o operador escolhe um RCB e um APG e informa o **valor real** de cada — quanto quer usar do título;
 *  · **o menor valor é abatido no de maior**, e a diferença **gera um título novo**;
 *  · o título maior que o valor real é **baixado parcialmente**, e o restante vira outro título;
 *  · `COD_DESCONTO_TITULO` marca **todos** os títulos da operação; `CODGRUPO_DESCONTO_TITULO` marca só o
 *    **gerado da diferença** — é esse par que permite reverter a operação inteira.
 *
 * Exemplo do autor: RCB 30,00 com valor real 10,00 contra APG 12,00 integral ⇒ título novo de 2,00, e o RCB
 * baixado parcialmente para 10,00 gerando outro de 20,00.
 *
 * **Uso real:** 18 operações, mas **R$ 254.390,96** a receber e **R$ 263.518,12** a pagar, a última em
 * 12/09/2026. Não é volume, é valor — média de 14 mil por operação.
 *
 * ── Corte-1: a VISÃO da operação ────────────────────────────────────────────────────────────────────────
 * Os 68 acessos contra 18 operações dizem que a tela é mais consultada que executada. O corte-1 entrega a
 * consulta completa — quais títulos entraram, o que foi gerado, e o custo da operação. **Executar** o
 * encontro de contas é o corte-2: mexe em cinco tabelas numa transação e merece o cuidado que a
 * baixa de títulos teve.
 */
@Injectable()
export class DescontoTituloService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** as operações de encontro de contas do período, com o resumo de cada uma. */
  async listar(f: { dataIni?: string | null; dataFim?: string | null; codparceiro?: number | null }): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { operacoes: number; aReceber: number; aPagar: number; diferenca: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;

    const onde = [sql`t.cod_desconto_titulo > 0`, sql`t.idempresa = ${emp}`];
    if (f.dataIni && f.dataFim) onde.push(sql`t.dtvenc::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`);
    if (f.codparceiro) onde.push(sql`t.codparceiro = ${f.codparceiro}`);

    const linhas = (await sql<Record<string, unknown>>`
      WITH titulos AS (
        SELECT 'RCB' AS lado, r.codrcb AS codigo, r.cod_desconto_titulo, r.codgrupo_desconto_titulo,
               r.codparceiro, r.valor, r.dtvenc, r.duplicata, coalesce(r.quitada, 'N') AS quitada,
               r.codempresa AS idempresa
          FROM areceber r WHERE coalesce(r.cod_desconto_titulo, 0) > 0
        UNION ALL
        SELECT 'APG', a.codapg, a.cod_desconto_titulo, a.codgrupo_desconto_titulo,
               a.codparceiro, a.valor, a.dtvenc, a.duplicata, coalesce(a.quitada, 'N'),
               a.codempresa AS idempresa
          FROM apagar a WHERE coalesce(a.cod_desconto_titulo, 0) > 0
      )
      SELECT t.cod_desconto_titulo AS operacao,
             max(t.codparceiro) AS codparceiro,
             max(pa.razao) AS parceiro,
             min(t.dtvenc) AS primeiro_vencimento,
             count(*)::int AS titulos,
             sum(CASE WHEN t.lado = 'RCB' THEN t.valor ELSE 0 END) AS total_receber,
             sum(CASE WHEN t.lado = 'APG' THEN t.valor ELSE 0 END) AS total_pagar,
             -- o que a operação custou (ou rendeu): a diferença entre as duas pontas
             round((sum(CASE WHEN t.lado = 'APG' THEN t.valor ELSE 0 END)
                    - sum(CASE WHEN t.lado = 'RCB' THEN t.valor ELSE 0 END))::numeric, 2) AS diferenca,
             -- quantos títulos NASCERAM da operação (os marcados pelo grupo)
             count(*) FILTER (WHERE coalesce(t.codgrupo_desconto_titulo, 0) > 0)::int AS gerados,
             count(*) FILTER (WHERE t.quitada = 'S')::int AS quitados
        FROM titulos t
        LEFT JOIN parceiros pa ON pa.codparceiro = t.codparceiro
       WHERE ${sql.join(onde, sql` AND `)}
       GROUP BY t.cod_desconto_titulo
       ORDER BY t.cod_desconto_titulo DESC
       LIMIT 1001
    `.execute(db)).rows;

    return {
      linhas,
      totais: {
        operacoes: linhas.length,
        aReceber: r2(linhas.reduce((s, l) => s + num(l.total_receber), 0)),
        aPagar: r2(linhas.reduce((s, l) => s + num(l.total_pagar), 0)),
        diferenca: r2(linhas.reduce((s, l) => s + num(l.diferenca), 0)),
      },
    };
  }

  /** os títulos de uma operação, dos dois lados, com o que foi gerado marcado. */
  async detalhar(operacao: number): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await sql<Record<string, unknown>>`
      SELECT 'RCB' AS lado, r.codrcb AS codigo, r.duplicata, r.dtvenc, r.valor,
             coalesce(r.quitada, 'N') AS quitada,
             (coalesce(r.codgrupo_desconto_titulo, 0) > 0) AS gerado_pela_operacao,
             pa.razao AS parceiro
        FROM areceber r
        LEFT JOIN parceiros pa ON pa.codparceiro = r.codparceiro
       WHERE r.cod_desconto_titulo = ${operacao} AND r.codempresa = ${emp}
      UNION ALL
      SELECT 'APG', a.codapg, a.duplicata, a.dtvenc, a.valor,
             coalesce(a.quitada, 'N'),
             (coalesce(a.codgrupo_desconto_titulo, 0) > 0),
             pa.razao
        FROM apagar a
        LEFT JOIN parceiros pa ON pa.codparceiro = a.codparceiro
       WHERE a.cod_desconto_titulo = ${operacao} AND a.codempresa = ${emp}
       ORDER BY 1, 4
    `.execute(db)).rows;
  }
}
