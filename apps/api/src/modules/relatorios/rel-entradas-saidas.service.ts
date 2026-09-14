import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type TipoEntradasSaidas = 'LISTAGEM' | 'COMPARATIVO';

export interface FiltroEntradasSaidas {
  tipo: TipoEntradasSaidas;
  dataIni: string;
  dataFim: string;
  coddpto?: number | null;
  codgrupo?: number | null;
  codsubgrupo?: number | null;
  codfor?: number | null;
  produto?: string | null;
}

/**
 * ENTRADAS E SAÍDAS (`FRMRELENTRADASSAIDAS`, `uRelEntradasSaidas.pas` 635 linhas + `.dfm` 3.644).
 * Dossiê: `uRelEntradasSaidas.md`. **148 acessos, 20 operadores.**
 *
 * Dois relatórios:
 *  1. **Listagem** — as notas de entrada e de saída do período, item a item;
 *  2. **Comparativo** — por produto: quanto entrou, quanto saiu, o custo médio de entrada, o preço médio de
 *     saída, a diferença, e a posição de estoque ao lado.
 *
 * ── ⚠️ O BUG DO DESCONTO, e ele custa 179 mil reais por ano ───────────────────────────────────────────
 * O legado calcula o valor do item como `(QUANTIDADE × VRCUSTO) − NP.DESCONTO` (`aqqRelE`, `.dfm:896`).
 * **`NF_PROD.DESCONTO` é PERCENTUAL, não valor** — e o dado prova de três formas (produção, 14/09/2026):
 *  · o máximo é exatamente **100** e a mediana **13,36**, em 17.014 itens com desconto;
 *  · `QUANTIDADE × VRCUSTO × DESCONTO/100` bate **casa a casa** com `VRDESCPROD`, que é o valor em reais;
 *  · a própria tela de Relatórios de Compras usa a mesma coluna como percentual.
 *
 * Numa nota de 12.874,40 com 24,31% de desconto, o legado subtrai **24,31** em vez de **3.130,40**. Somando
 * só as entradas de 2026 (59.929 itens): o legado devolve **19.389.175,03** onde o certo é **19.210.180,10**
 * — **178.994,93 a mais**. Aqui usamos `VRDESCPROD`, o valor em reais, e a tela avisa que o número vai
 * diferir do sistema antigo.
 *
 * ── ⚠️ A NOTA NÃO PROCESSADA ficava contada duas vezes ────────────────────────────────────────────────
 * O `WHERE` do legado é só `TIPO = 'E' AND DTCONTABIL BETWEEN` — **não filtra `PROC` nem `CANCELADA`**. Só
 * que o próprio comparativo tem a coluna `VABERTO`, que soma exatamente as notas com `PROC = 'N'`: a mesma
 * mercadoria aparecia como **entrada do período** e como **"a entrar"**, e viraria entrada de novo no dia em
 * que a nota fosse processada. Nota não processada **não movimentou estoque**. Aqui o movimento exige
 * `PROC = 'S'` e o "a entrar" continua mostrando o que está a caminho — cada coisa contada uma vez só.
 */
@Injectable()
export class RelEntradasSaidasService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: FiltroEntradasSaidas): Promise<{
    tipo: TipoEntradasSaidas;
    linhas: Array<Record<string, unknown>>;
    totais: { entrada: number; saida: number; diferenca: number; itens: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (f.dataIni > f.dataFim) throw new BusinessRuleError('DATA_INICIAL_MAIOR', { dataIni: f.dataIni, dataFim: f.dataFim });

    const filtrosProduto = [] as ReturnType<typeof sql>[];
    if (f.coddpto) filtrosProduto.push(sql`p.coddpto = ${f.coddpto}`);
    if (f.codgrupo) filtrosProduto.push(sql`p.codgrupo = ${f.codgrupo}`);
    if (f.codsubgrupo) filtrosProduto.push(sql`p.codsubgrupo = ${f.codsubgrupo}`);
    if (f.codfor) filtrosProduto.push(sql`p.codfor = ${f.codfor}`);
    if (f.produto) filtrosProduto.push(sql`(p.descricao ILIKE ${`%${f.produto}%`} OR p.codbarra = ${f.produto})`);
    const prodFiltro = filtrosProduto.length ? sql`AND ${sql.join(filtrosProduto, sql` AND `)}` : sql``;

    // ⚠️ o valor LÍQUIDO do item usa VRDESCPROD (reais), não DESCONTO (percentual) — ver o cabeçalho
    const valorEntrada = sql`((np.quantidade * np.vrcusto) - coalesce(np.vrdescprod, 0))`;

    if (f.tipo === 'LISTAGEM') {
      const linhas = (await sql<Record<string, unknown>>`
        SELECT nf.tipo, nf.codnf, nf.nronf, nf.dtcontabil::date AS dtcontabil,
               g.descricao AS grupo, p.descricao, np.codproduto,
               np.quantidade,
               round((${valorEntrada})::numeric, 2) AS valor,
               -- o que o sistema antigo mostraria: percentual subtraído como se fosse reais
               round(((np.quantidade * np.vrcusto) - coalesce(np.desconto, 0))::numeric, 2) AS valor_legado,
               pa.razao AS parceiro
          FROM nf
          JOIN nf_prod np       ON np.codnf = nf.codnf
          LEFT JOIN produtos p  ON p.idproduto = np.codproduto
          LEFT JOIN familias_prod g ON g.codfamilia = p.codgrupo AND g.tipo = 'G'
          LEFT JOIN parceiros pa ON pa.codparceiro = nf.codparceiro
         WHERE nf.idempresa = ${emp}
           AND nf.tipo IN ('E', 'S')
           AND coalesce(nf.cancelada, 'N') = 'N'
           -- movimento é o que JÁ ENTROU: a não processada aparece no "a entrar" do comparativo
           AND coalesce(nf.proc, 'N') = 'S'
           AND nf.dtcontabil::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${prodFiltro}
         ORDER BY nf.tipo, nf.dtcontabil, nf.nronf, p.descricao
         LIMIT 20001
      `.execute(db)).rows;

      const soma = (t: string) => r2(linhas.filter((l) => l.tipo === t).reduce((s, l) => s + num(l.valor), 0));
      const entrada = soma('E');
      const saida = soma('S');
      return { tipo: f.tipo, linhas, totais: { entrada, saida, diferenca: r2(saida - entrada), itens: linhas.length } };
    }

    // ── COMPARATIVO: por produto, quanto entrou e quanto saiu ────────────────────────────────────────
    // A quantidade do legado é `QUANTIDADE × FATOREMBAL` nos dois lados: a nota vem em caixa e o
    // comparativo precisa das duas pontas na mesma unidade, senão entrada e saída não se comparam.
    const linhas = (await sql<Record<string, unknown>>`
      WITH mov AS (
        SELECT np.codproduto, p.codbarra, p.descricao,
               CASE WHEN nf.tipo = 'E' THEN (np.quantidade * coalesce(nullif(np.fatorembal, 0), 1)) ELSE 0 END AS qtde_entrada,
               CASE WHEN nf.tipo = 'E' THEN (${valorEntrada}) ELSE 0 END AS valor_entrada,
               CASE WHEN nf.tipo = 'S' THEN (np.quantidade * coalesce(nullif(np.fatorembal, 0), 1)) ELSE 0 END AS qtde_saida,
               CASE WHEN nf.tipo = 'S'
                    THEN ((np.quantidade * coalesce(nullif(np.fatorembal, 0), 1)) * np.vrvenda) ELSE 0 END AS valor_saida
          FROM nf
          JOIN nf_prod np      ON np.codnf = nf.codnf
          LEFT JOIN produtos p ON p.idproduto = np.codproduto
         WHERE nf.idempresa = ${emp}
           AND nf.tipo IN ('E', 'S')
           AND coalesce(nf.cancelada, 'N') = 'N'
           AND coalesce(nf.proc, 'N') = 'S'
           AND nf.dtcontabil::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${prodFiltro}
      )
      SELECT m.codproduto, m.codbarra, m.descricao,
             sum(m.qtde_entrada)  AS qtde_entrada,
             round(sum(m.valor_entrada)::numeric, 2) AS valor_entrada,
             sum(m.qtde_saida)    AS qtde_saida,
             round(sum(m.valor_saida)::numeric, 2)   AS valor_saida,
             -- as médias do legado: valor ÷ quantidade, e zero quando não há movimento
             CASE WHEN sum(m.valor_entrada) > 0 AND sum(m.qtde_entrada) > 0
                  THEN round((sum(m.valor_entrada) / sum(m.qtde_entrada))::numeric, 3) ELSE 0 END AS media_custo,
             CASE WHEN sum(m.valor_saida) > 0 AND sum(m.qtde_saida) > 0
                  THEN round((sum(m.valor_saida) / sum(m.qtde_saida))::numeric, 3) ELSE 0 END AS media_venda,
             (sum(m.qtde_saida) - sum(m.qtde_entrada))   AS qtde_dif,
             round((sum(m.valor_saida) - sum(m.valor_entrada))::numeric, 2) AS valor_dif,
             coalesce(e.qtde, 0)  AS qtde_estoque_loja,
             coalesce(ed.qtde, 0) AS qtde_estoque_deposito,
             (coalesce(e.qtde, 0) + coalesce(ed.qtde, 0)) AS qtde_estoque_total,
             coalesce(mp.vrcustorep, 0) AS vrcustorep,
             coalesce(mp.vrvenda, 0)    AS vrvenda,
             -- VABERTO: o que já foi comprado e ainda não entrou — nota lançada com PROC = 'N'
             coalesce((SELECT sum(n2.quantidade * coalesce(nullif(n2.fatorembal, 0), 1))
                         FROM nf_prod n2 JOIN nf nf2 ON nf2.codnf = n2.codnf
                        WHERE n2.codproduto = m.codproduto
                          AND nf2.idempresa = ${emp}
                          AND nf2.tipo = 'E'
                          AND coalesce(nf2.proc, 'N') = 'N'
                          AND coalesce(nf2.cancelada, 'N') = 'N'), 0) AS vaberto
        FROM mov m
        LEFT JOIN estoque e      ON e.idproduto  = m.codproduto AND e.idempresa  = ${emp}
        LEFT JOIN estoque_dep ed ON ed.idproduto = m.codproduto AND ed.idempresa = ${emp}
        LEFT JOIN multi_preco mp ON mp.idproduto = m.codproduto AND mp.idempresa = ${emp}
       GROUP BY m.codproduto, m.codbarra, m.descricao, e.qtde, ed.qtde, mp.vrcustorep, mp.vrvenda
       ORDER BY m.descricao
       LIMIT 20001
    `.execute(db)).rows;

    const entrada = r2(linhas.reduce((s, l) => s + num(l.valor_entrada), 0));
    const saida = r2(linhas.reduce((s, l) => s + num(l.valor_saida), 0));
    return { tipo: f.tipo, linhas, totais: { entrada, saida, diferenca: r2(saida - entrada), itens: linhas.length } };
  }
}
