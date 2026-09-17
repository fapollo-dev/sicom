import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { AnaliseCasaCarneDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * ANÁLISE COMPRA × VENDA — CASA DE CARNE (`FRMANALISECOMPRAVENDACASACARNE`).
 * **37 acessos, 6 operadores.** Dossiê: `uAnaliseCompraVendaCasaCarne.md`. Migration 242.
 *
 * A casa de carne **compra a peça e vende os cortes**. A análise casa os dois lados aplicando a
 * `DECOMPOSICAO`: no cliente são **13 peças** que viram **30 cortes**, com percentuais de 0,7% a 50% que
 * somam 100% em cada peça. O mecanismo está vivo — um corte foi vendido hoje.
 *
 * ── ⚠️ O CUSTO da peça decomposta sai 2,4 vezes maior no legado ───────────────────────────────────────
 * As duas linhas do `CASE` são assimétricas, e é um erro de digitação com consequência:
 *
 * ```sql
 * CASE P.DECOMPOSICAO WHEN 'N' THEN Sum(N.QTDE)
 *                     ELSE Sum(CAST((N.T_QTDE * D.PERCENTUAL) / 100 AS ...)) END QTDE_COMPRA,
 * CASE P.DECOMPOSICAO WHEN 'N' THEN Sum(N.T_VRCUSTO)
 *                     ELSE Sum(CAST((VRCUSTO * D.PERCENTUAL)       AS ...)) END CUSTO_COMPRA
 * ```
 *
 * A quantidade divide o percentual por **100**; o custo **não divide**. E ainda usa `VRCUSTO`, o valor
 * **unitário**, onde deveria usar `T_VRCUSTO`, o total da linha. Medido nas compras de peça desde 2024:
 * **R$ 7.047,00** contra **R$ 2.956,85** — **138,3% a mais**. É o custo sobre o qual a casa de carne calcula
 * a margem de cada corte.
 *
 * ── ⚠️ A tabela de trabalho é criada por DDL em runtime ───────────────────────────────────────────────
 * O legado faz `CREATE TABLE <temp do usuário> AS ...` a cada consulta (`CriaTabelaTemporaria`, `:272`) e a
 * consulta seguinte lê dela. Aqui é uma CTE — sem DDL, sem tabela órfã, sem corrida entre operadores. Mesma
 * decisão da intersecção de produtos (migration 221).
 *
 * ⚠️ o legado trunca o total da venda **exceto** quando `IAT = 'A'`, aí arredonda (`:308`). Copiado.
 */
@Injectable()
export class AnaliseCasaCarneService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: AnaliseCasaCarneDto): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { qtdeCompra: number; custoCompra: number; qtdeVenda: number; valorVenda: number; margem: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const produto = f.produto ? `%${f.produto.toUpperCase()}%` : null;

    const linhas = (await sql<Record<string, unknown>>`
      WITH compras AS (
        -- a entrada: quantidade na unidade de estoque (QUANTIDADE × FATOREMBAL) e o custo TOTAL da linha
        SELECT np.codproduto,
               sum(np.quantidade)                            AS qtde,
               sum(np.quantidade * coalesce(np.fatorembal, 1)) AS qtde_convertida,
               sum(round((np.quantidade * np.vrcusto)::numeric, 2)) AS custo_total
          FROM nf n
          JOIN nf_prod np ON np.codnf = n.codnf
         WHERE n.idempresa = ${emp}
           AND n.tipo = 'E'
           AND coalesce(n.cancelada, 'N') = 'N'
           AND n.dtemissao::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         GROUP BY np.codproduto
      ), vendas_ AS (
        -- a saída: o legado trunca o total, exceto quando IAT='A', aí arredonda
        SELECT v.codproduto,
               sum(v.qtde) AS qtde,
               sum(CASE WHEN v.iat = 'A' THEN round((v.qtde * v.vrvenda)::numeric, 2)
                        ELSE trunc((v.qtde * v.vrvenda)::numeric * 100) / 100 END
                   + greatest(coalesce(v.desc_acre_medio, 0), 0) + greatest(coalesce(v.desc_acre_item, 0), 0)
                   - (coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
                      + abs(least(coalesce(v.desc_acre_medio, 0), 0))
                      + abs(least(coalesce(v.desc_acre_item, 0), 0)))) AS valor_liq
          FROM vendas v
         WHERE v.idempresa = ${emp}
           AND coalesce(v.cancelado, 'N') = 'N'
           AND v.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         GROUP BY v.codproduto
      ), rateio AS (
        -- ⚠️ a peça decomposta distribui a compra entre os cortes pelo percentual. A quantidade E o custo
        -- dividem por 100 — no legado só a quantidade divide, e o custo ainda usa o unitário (138,3% a mais)
        SELECT d.idproduto_01 AS codproduto,
               sum(c.qtde_convertida * d.percentual / 100)  AS qtde_compra,
               sum(c.custo_total    * d.percentual / 100)   AS custo_compra,
               min(d.idproduto)                              AS peca
          FROM decomposicao d
          JOIN compras c ON c.codproduto = d.idproduto
         GROUP BY d.idproduto_01
      )
      SELECT p.idproduto AS codproduto, p.descricao, p.codbarra, p.unidade, p.decomposicao,
             pe.descricao AS peca_descricao, r.peca,
             coalesce(CASE WHEN coalesce(p.decomposicao, 'N') = 'S' THEN NULL ELSE c.qtde END, r.qtde_compra, 0) AS qtde_compra,
             coalesce(CASE WHEN coalesce(p.decomposicao, 'N') = 'S' THEN NULL ELSE c.custo_total END, r.custo_compra, 0) AS custo_compra,
             coalesce(v.qtde, 0)      AS qtde_venda,
             coalesce(v.valor_liq, 0) AS valor_venda
        FROM produtos p
        LEFT JOIN compras c  ON c.codproduto = p.idproduto
        LEFT JOIN vendas_ v  ON v.codproduto = p.idproduto
        LEFT JOIN rateio r   ON r.codproduto = p.idproduto
        LEFT JOIN produtos pe ON pe.idproduto = r.peca
       WHERE (c.codproduto IS NOT NULL OR v.codproduto IS NOT NULL OR r.codproduto IS NOT NULL)
         AND (${f.somenteDecomposicao} = 'N'
              OR coalesce(p.decomposicao, 'N') = 'S' OR r.codproduto IS NOT NULL)
         AND (${f.coddpto ?? null}::int     IS NULL OR p.coddpto     = ${f.coddpto ?? null}::int)
         AND (${f.codgrupo ?? null}::int    IS NULL OR p.codgrupo    = ${f.codgrupo ?? null}::int)
         AND (${f.codsubgrupo ?? null}::int IS NULL OR p.codsubgrupo = ${f.codsubgrupo ?? null}::int)
         AND (${f.aliquota ?? null}::text   IS NULL OR p.aliquota    = ${f.aliquota ?? null}::text)
         AND (${produto}::text IS NULL
              OR upper(coalesce(p.descricao, '')) LIKE ${produto}::text
              OR coalesce(p.codbarra, '') LIKE ${produto}::text)
       ORDER BY coalesce(pe.descricao, p.descricao), p.descricao
       LIMIT ${f.limite}
    `.execute(db)).rows;

    const t = { qtdeCompra: 0, custoCompra: 0, qtdeVenda: 0, valorVenda: 0, margem: 0 };
    const saida = linhas.map((l) => {
      const custo = num(l.custo_compra);
      const venda = num(l.valor_venda);
      t.qtdeCompra += num(l.qtde_compra); t.custoCompra += custo;
      t.qtdeVenda += num(l.qtde_venda); t.valorVenda += venda;
      return { ...l, margem: r2(venda - custo), margem_perc: custo > 0 ? r2((venda / custo - 1) * 100) : 0 };
    });
    t.qtdeCompra = r2(t.qtdeCompra); t.custoCompra = r2(t.custoCompra);
    t.qtdeVenda = r2(t.qtdeVenda); t.valorVenda = r2(t.valorVenda);
    t.margem = r2(t.valorVenda - t.custoCompra);
    return { linhas: saida, totais: t };
  }
}
