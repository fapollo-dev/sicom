import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroEntSai {
  dataIni: string;
  dataFim: string;
  coddpto?: number | null;
  codgrupo?: number | null;
  codsubgrupo?: number | null;
  idproduto?: number | null;
  codfor?: number | null;
  /** o `chkAgruparProdutos`: junta as empresas numa linha só por produto. */
  agruparProdutos?: boolean;
}

/**
 * ANÁLISE DE COMPRA × VENDA (`FRMRELENTSAI`, `uRelEntSai.pas` 586 linhas).
 * Dossiê: `uRelEntSai.md`. **84 acessos, 10 operadores.**
 *
 * Por **produto**: quanto entrou e quanto saiu no período, em quantidade e em dinheiro, lado a lado. É a
 * conta que mostra o que se comprou demais e o que se vendeu sem repor.
 *
 * Não confundir com **Entradas e Saídas** (`FRMRELENTRADASSAIDAS`, §109): aquela lista notas e compara
 * totais; esta cruza a **venda do PDV** com a **compra por nota**, produto a produto.
 *
 * ── As duas pernas ──────────────────────────────────────────────────────────────────────────────────────
 * **Saídas** vêm de `vendas`, com a venda líquida de sempre: truncamento por `IAT` ('A' arredonda, o resto
 * trunca), mais acréscimos, menos descontos (promoção, departamento e os acréscimos negativos).
 *
 * **Entradas** vêm de `nf_prod` das notas de entrada processadas, com `QUANTIDADE × FATOREMBAL` — a nota vem
 * em caixa e a venda é em unidade; sem o fator os dois lados não se comparam.
 *
 * ── ⚠️ A MESMA COLUNA, TRÊS TELAS, E UMA DELAS ERRA ────────────────────────────────────────────────────
 * O custo de entrada aqui é `VRCUSTO − VRCUSTO × DESCONTO/100`, tratando `NF_PROD.DESCONTO` como
 * **percentual** — que é o que ele é (máximo 100, mediana 13,36, e a conta fecha com `VRDESCPROD`).
 *
 * Esta tela acerta, o Relatório de Compras (§105) acerta, e o **Entradas e Saídas (§109) erra**: lá o
 * legado faz `(QUANTIDADE × VRCUSTO) − DESCONTO`, subtraindo o percentual como se fosse reais — R$ 178.994,93
 * a mais por ano. Três telas, a mesma coluna, dois entendimentos. Vale registrar qual é o certo.
 *
 * ⚠️ o legado repete aqui o `NP.DESCONTO` **sem `coalesce`** no frete e no seguro (`:513`), o mesmo descuido
 * do §105: com desconto nulo a parcela vira NULL e a linha some da soma. Protegido.
 */
@Injectable()
export class RelEntSaiService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: FiltroEntSai): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { entradas: number; saidas: number; totalCompras: number; totalVenda: number; itens: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (f.dataIni > f.dataFim) throw new BusinessRuleError('DATA_INICIAL_MAIOR', { dataIni: f.dataIni, dataFim: f.dataFim });

    const fp = [] as ReturnType<typeof sql>[];
    if (f.coddpto) fp.push(sql`p.coddpto = ${f.coddpto}`);
    if (f.codgrupo) fp.push(sql`p.codgrupo = ${f.codgrupo}`);
    if (f.codsubgrupo) fp.push(sql`p.codsubgrupo = ${f.codsubgrupo}`);
    if (f.idproduto) fp.push(sql`p.idproduto = ${f.idproduto}`);
    if (f.codfor) fp.push(sql`p.codfor = ${f.codfor}`);
    const prod = fp.length ? sql`AND ${sql.join(fp, sql` AND `)}` : sql``;

    // a base do custo de entrada: desconto em PERCENTUAL, com coalesce em todas as parcelas
    const baseNf = sql`((np.vrcusto - ((np.vrcusto * coalesce(np.desconto, 0)) / 100)) * np.quantidade)`;
    const baseArred = sql`(${baseNf})::numeric(13,2)`;

    const linhas = (await sql<Record<string, unknown>>`
      WITH mov AS (
        -- SAÍDAS: a venda do PDV, líquida
        SELECT d.descricao AS dpto, v.idempresa, p.idproduto AS codproduto, p.descricao,
               0::numeric AS entradas, sum(v.qtde) AS saidas,
               sum(CASE WHEN v.iat = 'A' THEN round((v.qtde * v.vrvenda)::numeric, 2)
                        ELSE trunc((v.qtde * v.vrvenda)::numeric * 100) / 100 END)
               + sum(GREATEST(coalesce(v.desc_acre_medio, 0), 0) + GREATEST(coalesce(v.desc_acre_item, 0), 0))
               - sum(coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
                     + GREATEST(-coalesce(v.desc_acre_medio, 0), 0)
                     + GREATEST(-coalesce(v.desc_acre_item, 0), 0)) AS total_venda,
               0::numeric AS total_compras
          FROM vendas v
          JOIN produtos p           ON p.idproduto = v.codproduto
          LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto AND d.tipo = 'D'
         WHERE v.idempresa = ${emp}
           AND coalesce(v.cancelado, 'N') = 'N'
           AND v.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${prod}
         GROUP BY d.descricao, v.idempresa, p.idproduto, p.descricao
        UNION ALL
        -- ENTRADAS: a compra por nota, em unidade de venda (quantidade × fator de embalagem)
        SELECT d.descricao, nf.idempresa, np.codproduto, p.descricao,
               sum(np.quantidade * coalesce(nullif(np.fatorembal, 0), 1)), 0, 0,
               (sum(${baseNf})
                + sum(coalesce(np.vricmst, 0))
                + sum((coalesce(np.ipi, 0)    * ${baseArred}) / 100)
                + sum(coalesce(np.depsacess, 0))
                + sum((coalesce(np.frete, 0)  * ${baseArred}) / 100)
                + sum((coalesce(np.seguro, 0) * ${baseArred}) / 100))::numeric(15,2)
          FROM nf_prod np
          JOIN nf                   ON nf.codnf = np.codnf
          JOIN produtos p           ON p.idproduto = np.codproduto
          LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto AND d.tipo = 'D'
         WHERE nf.idempresa = ${emp}
           AND nf.tipo = 'E' AND coalesce(nf.proc, 'N') = 'S'
           AND coalesce(nf.cancelada, 'N') = 'N'
           AND nf.dtcontabil::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${prod}
         GROUP BY d.descricao, nf.idempresa, np.codproduto, p.descricao
      )
      SELECT m.dpto,
             ${f.agruparProdutos ? sql`0` : sql`m.idempresa`} AS idempresa,
             m.codproduto, trim(m.descricao) AS descricao,
             sum(m.entradas) AS entradas,
             sum(m.saidas)   AS saidas,
             round(sum(m.total_venda)::numeric, 2)   AS total_venda,
             round(sum(m.total_compras)::numeric, 2) AS total_compras,
             -- o que interessa ao comprador: a diferença entre o que saiu e o que entrou
             (sum(m.saidas) - sum(m.entradas)) AS dif_qtde,
             round((sum(m.total_venda) - sum(m.total_compras))::numeric, 2) AS dif_valor
        FROM mov m
       GROUP BY m.dpto, ${f.agruparProdutos ? sql`0` : sql`m.idempresa`}, m.codproduto, trim(m.descricao)
       ORDER BY 4${f.agruparProdutos ? sql`` : sql`, 2`}
       LIMIT 20001
    `.execute(db)).rows;

    return {
      linhas,
      totais: {
        entradas: r2(linhas.reduce((s, l) => s + num(l.entradas), 0)),
        saidas: r2(linhas.reduce((s, l) => s + num(l.saidas), 0)),
        totalCompras: r2(linhas.reduce((s, l) => s + num(l.total_compras), 0)),
        totalVenda: r2(linhas.reduce((s, l) => s + num(l.total_venda), 0)),
        itens: linhas.length,
      },
    };
  }
}
