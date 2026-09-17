import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelVendasDinamicoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * ANÁLISE DE VENDAS DE PRODUTOS (`FRMRELATORIOVENDASDINAMICO` + `uGridRelatorio`).
 * **37 acessos, 8 operadores.** Dossiê: `uRelatorioVendasDinamico.md`. Migration 243.
 *
 * Uma linha por produto com o giro do período ao lado do cadastro: quanto vendeu, quanto custou, quando foi a
 * última venda, **quando foi a última compra e por quanto**, e o que tem em estoque. É a visão que responde
 * "este item ainda gira, e a que custo eu o reponho?".
 *
 * ── Quatro defeitos do legado, os quatro medidos ──────────────────────────────────────────────────────
 * ⚠️ **`AND f.ativado = 'S'` no WHERE sobre `LEFT JOIN PARCEIROS`** anula o LEFT JOIN: todo produto **sem
 *    fornecedor** ou com fornecedor inativo desaparece. Medido: **228 produtos** somem de 47.699 com
 *    `ATIVO_COMPRA='S'`. Aqui o produto aparece, rotulado.
 * ⚠️ **a última compra não filtra empresa nem cancelamento**: `WHERE N.TIPO = 'E'` e mais nada. São **3
 *    empresas** nas notas de entrada e **4 notas canceladas** entrando na conta — a "última compra" podia ser
 *    de outra loja, ou de uma nota que não existe mais.
 * ⚠️ **`MAX(N.DTCONTABIL)` e `MAX(N.CODNF)` são independentes**, e o custo sai da nota do maior CÓDIGO, não
 *    da mais recente. Medido: **1.431 de 19.966 produtos (7,2%)** têm as duas coisas diferentes — o "último
 *    custo" deles vem de uma nota que não é a última compra. Aqui as duas vêm da MESMA nota, a mais recente.
 * ⚠️ **uma consulta por linha** (`aqqConsultaCalcFields`, `:90`): para cada produto da grade o legado abre
 *    outra query para buscar o saldo de estoque. Com milhares de produtos são milhares de idas ao banco;
 *    aqui é um `LEFT JOIN`.
 */
@Injectable()
export class RelVendasDinamicoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: RelVendasDinamicoDto): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { produtos: number; qtde: number; venda: number; custo: number; margem: number; estoque: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const produto = f.produto ? `%${f.produto.toUpperCase()}%` : null;
    const ini = `${f.dataIni} ${f.horaIni}`;
    const fim = `${f.dataFim} ${f.horaFim}`;

    const linhas = (await sql<Record<string, unknown>>`
      WITH venda AS (
        SELECT v.codproduto,
               sum(v.qtde) AS qtde,
               max(v.dtvenda)::date AS dtultimavenda,
               -- o legado trunca o total, e isso foi mantido
               sum(trunc((v.qtde * v.vrvenda)::numeric * 100) / 100) AS venda_acumulada,
               sum(trunc((v.qtde * v.vrcusto)::numeric * 100) / 100) AS custo_acumulado,
               max(v.vrcusto) AS vrcusto
          FROM vendas v
         WHERE v.idempresa = ${emp}
           AND v.dtvenda BETWEEN ${ini}::timestamp AND ${fim}::timestamp
           AND coalesce(v.cancelado, 'N') = 'N'
         GROUP BY v.codproduto
      ), compra AS (
        -- ⚠️ a nota mais recente e o custo dela vêm JUNTOS (no legado, MAX(DTCONTABIL) e MAX(CODNF) são
        -- independentes, e em 1.431 de 19.966 produtos apontam para notas diferentes)
        SELECT DISTINCT ON (np.codproduto)
               np.codproduto, n.dtcontabil AS dtultimacompra, n.codnf,
               round((np.vrcusto / nullif(coalesce(np.fatorembal, 1), 0))::numeric, 2) AS ultimocusto
          FROM nf n
          JOIN nf_prod np ON np.codnf = n.codnf
         WHERE n.tipo = 'E'
           -- ⚠️ o legado não filtra nem empresa (3 nas notas de entrada) nem cancelada (4 notas)
           AND n.idempresa = ${emp}
           AND coalesce(n.cancelada, 'N') = 'N'
         ORDER BY np.codproduto, n.dtcontabil DESC, n.codnf DESC
      ), estoque_ AS (
        -- ⚠️ no legado isto é UMA CONSULTA POR LINHA da grade; aqui é um join só
        SELECT e.idproduto,
               sum(coalesce(e.qtde, 0)) AS qtde_estoque,
               sum(coalesce(e.qtde, 0) * coalesce(m.vrcusto, 0)) AS vrcusto_estoque
          FROM estoque e
          LEFT JOIN multi_preco m ON m.idproduto = e.idproduto AND m.idempresa = ${emp}
         WHERE e.idempresa = ${emp}
         GROUP BY e.idproduto
      )
      SELECT p.idproduto AS codproduto, p.codbarra, p.descricao, p.unidade, p.dtcadastro,
             p.codfor, coalesce(f2.razao, '(sem fornecedor)') AS nomefor,
             coalesce(f2.ativado, 'N') AS fornecedor_ativo,
             p.coddpto, d.descricao AS nomedpto,
             p.codgrupo, g.descricao AS nomegrupo,
             p.codsubgrupo, sg.descricao AS nomesubgrupo,
             coalesce(v.qtde, 0) AS qtde, v.dtultimavenda,
             coalesce(v.venda_acumulada, 0) AS venda_acumulada,
             coalesce(v.custo_acumulado, 0) AS custo_acumulado,
             v.vrcusto,
             c.dtultimacompra, c.ultimocusto,
             coalesce(e.qtde_estoque, 0) AS qtde_estoque,
             coalesce(e.vrcusto_estoque, 0) AS vrcusto_estoque
        FROM produtos p
        -- ⚠️ o filtro do fornecedor sai do WHERE: no legado ele anulava o LEFT JOIN e sumia com 228 produtos
        LEFT JOIN parceiros f2      ON f2.codparceiro = p.codfor
        LEFT JOIN familias_prod d   ON d.codfamilia = p.coddpto
        LEFT JOIN familias_prod g   ON g.codfamilia = p.codgrupo
        LEFT JOIN familias_prod sg  ON sg.codfamilia = p.codsubgrupo
        LEFT JOIN venda v           ON v.codproduto = p.idproduto
        LEFT JOIN compra c          ON c.codproduto = p.idproduto
        LEFT JOIN estoque_ e        ON e.idproduto = p.idproduto
       WHERE (${f.somenteAtivoCompra} = 'N' OR coalesce(p.ativo_compra, 'N') = 'S')
         AND (${f.codfor ?? null}::int      IS NULL OR p.codfor      = ${f.codfor ?? null}::int)
         AND (${f.coddpto ?? null}::int     IS NULL OR p.coddpto     = ${f.coddpto ?? null}::int)
         AND (${f.codgrupo ?? null}::int    IS NULL OR p.codgrupo    = ${f.codgrupo ?? null}::int)
         AND (${f.codsubgrupo ?? null}::int IS NULL OR p.codsubgrupo = ${f.codsubgrupo ?? null}::int)
         AND (${produto}::text IS NULL
              OR upper(coalesce(p.descricao, '')) LIKE ${produto}::text
              OR coalesce(p.codbarra, '') LIKE ${produto}::text)
       ORDER BY p.descricao
       LIMIT ${f.limite}
    `.execute(db)).rows;

    const t = { produtos: linhas.length, qtde: 0, venda: 0, custo: 0, margem: 0, estoque: 0 };
    for (const l of linhas) {
      t.qtde += num(l.qtde); t.venda += num(l.venda_acumulada);
      t.custo += num(l.custo_acumulado); t.estoque += num(l.vrcusto_estoque);
    }
    t.qtde = r2(t.qtde); t.venda = r2(t.venda); t.custo = r2(t.custo);
    t.estoque = r2(t.estoque); t.margem = r2(t.venda - t.custo);
    return { linhas, totais: t };
  }
}
