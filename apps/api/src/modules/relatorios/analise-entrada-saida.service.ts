import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * ANÁLISE DE ENTRADA × SAÍDA (`FRMANALISEENTRADAXSAIDA`, `uAnaliseEntradaXSaida.pas`).
 * Dossiê: `uAnaliseEntradaXSaida.md`. **68 acessos, 9 operadores.**
 *
 * Por **fornecedor** e produto: quanto entrou pela nota e quanto saiu — e a saída pode vir de **pedidos** ou
 * de **vendas**, escolha do operador (`rgPedVen`). Só quantidade, sem valor: a pergunta aqui é de giro, não
 * de dinheiro.
 *
 * É a terceira tela da família, e cada uma responde a uma pergunta diferente:
 *  · `uRelEntradasSaidas.md` — lista as notas e compara totais;
 *  · `uRelEntSai.md` — por produto, entrada NF × venda, **com valores**;
 *  · esta — por **fornecedor**, e deixa escolher **pedido** em vez de venda.
 *
 * ── ⚠️ Os filtros do legado ANULAM o LEFT JOIN, e o produto some sem aviso ─────────────────────────────
 * O SQL original faz `LEFT JOIN PARCEIROS P`, `LEFT JOIN FAMILIAS_PROD D` (grupo) e `E` (departamento) — e
 * depois filtra no `WHERE`:
 *
 * ```sql
 * AND P.RAZAO LIKE :RAZAO AND D.DESCRICAO LIKE :DESCRICAO AND E.DESCRICAO LIKE :DEPTO
 * ```
 *
 * Com o filtro vazio o parâmetro vira `'%%'` — mas **`NULL LIKE '%%'` é falso**. Então todo produto **sem
 * fornecedor, sem grupo ou sem departamento** desaparece do relatório, mesmo sem filtro nenhum. O `LEFT
 * JOIN` é anulado pelo próprio `WHERE`.
 *
 * Medido na produção em 17/09/2026: **4.502 produtos sem grupo** e **4.520 sem departamento** (de 47.711) —
 * e em agosto/2026 isso derrubaria **652 linhas de venda, 38 produtos, R$ 7.111,31**. Pouco em valor, mas
 * invisível: o operador não tem como saber que sumiu.
 *
 * Aqui o filtro só se aplica **quando preenchido**, e o produto sem cadastro aparece com o rótulo
 * `(SEM FORNECEDOR)`, `(SEM GRUPO)` ou `(SEM DEPARTAMENTO)` — que é o que faz alguém ir arrumar o cadastro.
 */
@Injectable()
export class AnaliseEntradaSaidaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: {
    dataIni: string; dataFim: string;
    origemSaida?: 'VENDAS' | 'PEDIDOS' | null;
    fornecedor?: string | null; grupo?: string | null; departamento?: string | null;
  }): Promise<{
    origemSaida: 'VENDAS' | 'PEDIDOS';
    linhas: Array<Record<string, unknown>>;
    totais: { itens: number; entrada: number; saida: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (f.dataIni > f.dataFim) throw new BusinessRuleError('DATA_INICIAL_MAIOR', { dataIni: f.dataIni, dataFim: f.dataFim });
    const origem = f.origemSaida ?? 'VENDAS';

    // ⚠️ os filtros só entram QUANDO PREENCHIDOS — senão anulariam o LEFT JOIN (ver o cabeçalho)
    const filtro = (col: ReturnType<typeof sql>, v?: string | null) =>
      (v && v.trim() ? [sql`${col} ILIKE ${`%${v.trim()}%`}`] : []);

    const fNf = [
      ...filtro(sql`pa.razao`, f.fornecedor),
      ...filtro(sql`g.descricao`, f.grupo),
      ...filtro(sql`d.descricao`, f.departamento),
    ];
    const ondeNf = fNf.length ? sql`AND ${sql.join(fNf, sql` AND `)}` : sql``;

    const linhas = (await sql<Record<string, unknown>>`
      WITH mov AS (
        -- ENTRADA: a nota de entrada do período
        SELECT p.codfor,
               coalesce(pa.razao, '(SEM FORNECEDOR)') AS fornecedor,
               p.codbarra, p.descricao AS produto,
               p.codgrupo, coalesce(g.descricao, '(SEM GRUPO)') AS desc_grupo,
               p.coddpto, coalesce(d.descricao, '(SEM DEPARTAMENTO)') AS depto,
               sum(np.quantidade) AS qtd_entrada, 0::numeric AS qtd_saida
          FROM nf
          JOIN nf_prod np           ON np.codnf = nf.codnf
          LEFT JOIN produtos p      ON p.idproduto = np.codproduto
          LEFT JOIN familias_prod g ON g.codfamilia = p.codgrupo AND g.tipo = 'G'
          LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto  AND d.tipo = 'D'
          LEFT JOIN parceiros pa    ON pa.codparceiro = p.codfor
         WHERE nf.idempresa = ${emp}
           AND nf.tipo = 'E'
           AND coalesce(nf.cancelada, 'N') = 'N'
           AND nf.dtcontabil::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${ondeNf}
         GROUP BY p.codfor, pa.razao, p.codbarra, p.descricao, p.codgrupo, g.descricao, p.coddpto, d.descricao
        UNION ALL
        -- SAÍDA: venda ou pedido, conforme o rádio do legado
        ${origem === 'PEDIDOS'
          ? sql`
        SELECT p.codfor, coalesce(pa.razao, '(SEM FORNECEDOR)'),
               p.codbarra, p.descricao, p.codgrupo, coalesce(g.descricao, '(SEM GRUPO)'),
               p.coddpto, coalesce(d.descricao, '(SEM DEPARTAMENTO)'),
               0, sum(j.qtde)
          FROM pedidos j
          LEFT JOIN produtos p      ON p.idproduto = j.codproduto
          LEFT JOIN familias_prod g ON g.codfamilia = p.codgrupo AND g.tipo = 'G'
          LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto  AND d.tipo = 'D'
          LEFT JOIN parceiros pa    ON pa.codparceiro = p.codfor
         WHERE j.idempresa = ${emp}
           AND coalesce(j.cancelado, 'N') = 'N'
           AND j.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${ondeNf}
         GROUP BY p.codfor, pa.razao, p.codbarra, p.descricao, p.codgrupo, g.descricao, p.coddpto, d.descricao`
          : sql`
        SELECT p.codfor, coalesce(pa.razao, '(SEM FORNECEDOR)'),
               p.codbarra, p.descricao, p.codgrupo, coalesce(g.descricao, '(SEM GRUPO)'),
               p.coddpto, coalesce(d.descricao, '(SEM DEPARTAMENTO)'),
               0, sum(v.qtde)
          FROM vendas v
          LEFT JOIN produtos p      ON p.idproduto = v.codproduto
          LEFT JOIN familias_prod g ON g.codfamilia = p.codgrupo AND g.tipo = 'G'
          LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto  AND d.tipo = 'D'
          LEFT JOIN parceiros pa    ON pa.codparceiro = p.codfor
         WHERE v.idempresa = ${emp}
           AND coalesce(v.cancelado, 'N') = 'N'
           AND v.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${ondeNf}
         GROUP BY p.codfor, pa.razao, p.codbarra, p.descricao, p.codgrupo, g.descricao, p.coddpto, d.descricao`}
      )
      SELECT m.codfor, m.fornecedor, m.codbarra, m.produto,
             m.codgrupo, m.desc_grupo, m.coddpto, m.depto,
             sum(m.qtd_entrada) AS qtd_entrada,
             sum(m.qtd_saida)   AS qtd_saida,
             (sum(m.qtd_saida) - sum(m.qtd_entrada)) AS diferenca
        FROM mov m
       GROUP BY m.codfor, m.fornecedor, m.codbarra, m.produto, m.codgrupo, m.desc_grupo, m.coddpto, m.depto
       ORDER BY m.depto, m.desc_grupo, m.fornecedor, m.produto
       LIMIT 20001
    `.execute(db)).rows;

    return {
      origemSaida: origem,
      linhas,
      totais: {
        itens: linhas.length,
        entrada: r2(linhas.reduce((s, l) => s + num(l.qtd_entrada), 0)),
        saida: r2(linhas.reduce((s, l) => s + num(l.qtd_saida), 0)),
      },
    };
  }
}
