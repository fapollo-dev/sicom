import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** os três relatórios do combo (`URelCompras.dfm`, `CmbTipoRelatorio`). */
export type TipoRelCompras = 'CATEGORIA' | 'CATEGORIA_ANALITICO' | 'COMPRAS_VENDAS';
/** o `rgConsiderar` do relatório 3 — só ele habilita o rádio (`CmbTipoRelatorioChange:203`). */
export type ConsiderarRelCompras = 'COMPRAS' | 'VENDAS' | 'AMBOS';
/** o `CmbData`: qual data da nota filtra o período. */
export type CampoDataCompras = 'CONTABIL' | 'EMISSAO' | 'CHEGADA';

const COLUNA_DATA: Record<CampoDataCompras, string> = {
  CONTABIL: 'dtcontabil', EMISSAO: 'dtemissao', CHEGADA: 'dtchegada',
};

export interface FiltroRelCompras {
  tipo: TipoRelCompras;
  dataIni: string;
  dataFim: string;
  campoData?: CampoDataCompras | null;
  considerar?: ConsiderarRelCompras | null;
  coddpto?: number | null;
  codgrupo?: number | null;
  codsubgrupo?: number | null;
  codsecao?: number | null;
  idproduto?: number | null;
  codparceiro?: number | null;
  cfops?: string[] | null;
  empresas?: number[] | null;
}

/**
 * RELATÓRIOS DE COMPRAS (`FRMRELCOMPRAS`, `URelCompras.pas` + `UCompras.pas`). **204 acessos, 19 operadores.**
 * Dossiê: `uRelCompras.md`.
 *
 * Três relatórios num combo, com a mesma base: **o que a loja comprou**, pela árvore de categorias.
 *  1. **por categoria** — soma por seção/departamento/grupo/subgrupo;
 *  2. **por categoria analítico** — o mesmo, descendo até o produto, e **rateando a decomposição**;
 *  3. **compras × vendas por departamento** — as duas pontas lado a lado.
 *
 * O custo de compra do item (`UCompras.pas:110`) é o que dá o total, e ele não é só custo × quantidade:
 * ```
 * base    = (VRCUSTO − VRCUSTO × DESCONTO/100) × QUANTIDADE
 * total   = base + ICMS-ST + acessórias                (valores)
 *                + IPI% + FRETE% + SEGURO% sobre a base ARREDONDADA a 2 casas
 * ```
 * ⚠️ o `CAST(... AS NUMERIC(13,2))` está **dentro** da conta: o legado arredonda a base antes de aplicar cada
 * percentual. Tirar o arredondamento muda centavos em toda linha com frete ou IPI.
 *
 * Só entram notas de **entrada, processadas e não canceladas** (`TIPO='E' AND PROC='S' AND CANCELADA<>'S'`).
 *
 * ── DOIS DEFEITOS DO LEGADO, corrigidos aqui, com a medida do impacto ─────────────────────────────────────
 *
 * **1. `NP.DESCONTO` sem `COALESCE` no frete e no seguro** (`:115-116`) — nas outras três parcelas o legado
 * protege o nulo, nessas duas não. Com desconto nulo a expressão inteira vira NULL, o `SUM` descarta a linha
 * e o item **some do relatório**. Medido na produção em 14/09/2026: 23 itens com desconto nulo em 496.455, e
 * **1** deles com frete ou seguro — um item invisível. Corrigido com `coalesce`, porque perder linha em
 * relatório de compra é pior que divergir em um item que ninguém conferiu.
 *
 * **2. o relatório 3 no modo "ambos" soma TODAS as vendas de TODOS os tempos** (`VendasCompras:495`): na
 * perna de vendas o legado escreve `LEFT JOIN FAMILIAS_PROD D ON ... AND TRUNC(NP.DTVENDA) BETWEEN ... AND
 * NP.IDEMPRESA IN (...)` — **não há `WHERE`**. Data e empresa viram condição do LEFT JOIN, que por definição
 * não elimina linha: entra a base inteira de vendas, e o que não bate o período cai em "SEM DEPARTAMENTO".
 * Na produção isso é **18.965.108** linhas em vez das **115.078** de um mês numa loja — o relatório é
 * inutilizável nesse modo. Aqui o filtro é `WHERE`, como nas outras duas pernas.
 *
 * ⚠️ **a coluna de data exibida é sempre `DTCONTABIL`**, mesmo quando o filtro é por emissão ou chegada
 * (`TComprasPorCategoria.GetSQL:166`). Mantido: é o que o cliente lê há anos, e o agrupamento depende disso.
 */
@Injectable()
export class RelComprasService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: FiltroRelCompras): Promise<{
    tipo: TipoRelCompras;
    considerar: ConsiderarRelCompras | null;
    campoData: CampoDataCompras;
    linhas: Array<Record<string, unknown>>;
    totais: { compra: number; venda: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (f.dataIni > f.dataFim) throw new BusinessRuleError('DATA_INICIAL_MAIOR', { dataIni: f.dataIni, dataFim: f.dataFim });
    const campoData: CampoDataCompras = f.campoData ?? 'CONTABIL';
    const colData = COLUNA_DATA[campoData];
    if (!colData) throw new BusinessRuleError('CAMPO_DATA_INVALIDO', { campoData });
    // multi-empresa: `GetMultiEmpresa`; em branco, só a loja da sessão
    const empresas = f.empresas?.length ? f.empresas : [emp];

    const onde = [
      sql`coalesce(n.cancelada, 'N') = 'N'`,
      sql`n.tipo = 'E'`,
      sql`n.proc = 'S'`,
      sql`n.${sql.ref(colData)}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`,
      sql`n.idempresa = ANY(${empresas})`,
    ];
    if (f.codparceiro) onde.push(sql`n.codparceiro = ${f.codparceiro}`);
    if (f.idproduto) onde.push(sql`p.idproduto = ${f.idproduto}`);
    if (f.codsecao) onde.push(sql`p.codsecao = ${f.codsecao}`);
    if (f.coddpto) onde.push(sql`p.coddpto = ${f.coddpto}`);
    if (f.codgrupo) onde.push(sql`p.codgrupo = ${f.codgrupo}`);
    if (f.codsubgrupo) onde.push(sql`p.codsubgrupo = ${f.codsubgrupo}`);
    // o CFOP do relatório é o do ITEM (NP.CFOP), não o da nota
    if (f.cfops?.length) onde.push(sql`np.cfop = ANY(${f.cfops})`);
    const filtro = sql.join(onde, sql` AND `);

    // a base do custo, escrita como o legado a escreve — inclusive o arredondamento no meio da conta
    const baseCusto = sql`((np.vrcusto - ((np.vrcusto * coalesce(np.desconto,0)) / 100)) * np.quantidade)`;
    const baseArred = sql`(${baseCusto})::numeric(13,2)`;
    const totalItem = sql`(
      ${baseCusto}
      + coalesce(np.vricmst, 0)
      + ((coalesce(np.ipi, 0)    * ${baseArred}) / 100)
      + coalesce(np.depsacess, 0)
      + ((coalesce(np.frete, 0)  * ${baseArred}) / 100)
      + ((coalesce(np.seguro, 0) * ${baseArred}) / 100)
    )::numeric(15,2)`;

    const arvore = sql`
      LEFT JOIN familias_prod d  ON d.codfamilia  = p.coddpto     AND d.tipo  = 'D'
      LEFT JOIN familias_prod g  ON g.codfamilia  = p.codgrupo    AND g.tipo  = 'G'
      LEFT JOIN familias_prod sg ON sg.codfamilia = p.codsubgrupo AND sg.tipo = 'S'
      LEFT JOIN familias_prod sc ON sc.codfamilia = p.codsecao    AND sc.tipo = 'O'`;
    // os códigos ausentes viram negativos distintos para o relatório agrupar "sem seção", "sem grupo"…
    const categorias = sql`
      coalesce(sc.codfamilia, -1) AS codsecao,      coalesce(sc.descricao, 'SEM SEÇÃO')       AS desc_secao,
      coalesce(d.codfamilia, -2)  AS coddpto,       coalesce(d.descricao, 'SEM DEPARTAMENTO') AS descricao_departamento,
      coalesce(g.codfamilia, -3)  AS codgrupo,      coalesce(g.descricao, 'SEM GRUPO')        AS desc_grupo,
      coalesce(sg.codfamilia, -4) AS codsubgrupo,   coalesce(sg.descricao, 'SEM SUBGRUPO')    AS desc_subgrupo`;

    if (f.tipo === 'CATEGORIA') {
      const linhas = (await sql<Record<string, unknown>>`
        SELECT n.idempresa, e.fantasia, n.dtcontabil::date AS data, ${categorias},
               sum(${totalItem})::numeric(18,2) AS total_compra
          FROM nf n
          JOIN nf_prod np       ON np.codnf = n.codnf
          LEFT JOIN produtos p  ON p.idproduto = np.codproduto
          LEFT JOIN empresas e  ON e.idempresa = n.idempresa
          ${arvore}
         WHERE ${filtro}
         GROUP BY n.idempresa, e.fantasia, n.dtcontabil::date,
                  sc.codfamilia, sc.descricao, d.codfamilia, d.descricao,
                  g.codfamilia, g.descricao, sg.codfamilia, sg.descricao
         ORDER BY e.fantasia, n.idempresa, 3, 5, 7, 9
         LIMIT 20001
      `.execute(db)).rows;
      return this.comPercentual(f.tipo, null, campoData, linhas);
    }

    if (f.tipo === 'CATEGORIA_ANALITICO') {
      // ⚠️ a DECOMPOSIÇÃO: quando o produto comprado é decomposto (compra a peça, vende os cortes), o
      // custo é atribuído ao produto RESULTANTE, na proporção de `DECOMPOSICAO.PERCENTUAL`. Em produção são
      // 135 vínculos, 13 produtos de origem e 30 de destino, com percentual de 0,7 a 50.
      const linhas = (await sql<Record<string, unknown>>`
        SELECT n.idempresa, e.fantasia, n.dtcontabil::date AS data,
               coalesce(p2.idproduto, p.idproduto) AS idproduto,
               coalesce(p2.descricao, p.descricao) AS descricao,
               ${categorias},
               sum((${totalItem}) * CASE WHEN p2.idproduto IS NOT NULL
                                         THEN coalesce(de.percentual, 0) / 100 ELSE 1 END)::numeric(18,2) AS total_compra
          FROM nf n
          JOIN nf_prod np       ON np.codnf = n.codnf
          LEFT JOIN produtos p  ON p.idproduto = np.codproduto
          LEFT JOIN empresas e  ON e.idempresa = n.idempresa
          ${arvore}
          LEFT JOIN decomposicao de ON de.idproduto = p.idproduto
          LEFT JOIN produtos p2     ON p2.idproduto = de.idproduto_01
         WHERE ${filtro}
         GROUP BY n.idempresa, e.fantasia, n.dtcontabil::date,
                  coalesce(p2.idproduto, p.idproduto), coalesce(p2.descricao, p.descricao),
                  sc.codfamilia, sc.descricao, d.codfamilia, d.descricao,
                  g.codfamilia, g.descricao, sg.codfamilia, sg.descricao
         ORDER BY e.fantasia, n.idempresa, 3, 7, 9, 11, 5
         LIMIT 20001
      `.execute(db)).rows;
      return this.comPercentual(f.tipo, null, campoData, linhas);
    }

    // ── relatório 3: compras × vendas por DEPARTAMENTO ─────────────────────────────────────────────────
    const considerar: ConsiderarRelCompras = f.considerar ?? 'COMPRAS';
    const querCompra = considerar !== 'VENDAS';
    const querVenda = considerar !== 'COMPRAS';

    const compras = querCompra
      ? (await sql<Record<string, unknown>>`
          SELECT coalesce(d.codfamilia, -2) AS coddpto,
                 coalesce(d.descricao, 'SEM DEPARTAMENTO') AS descricao_departamento,
                 sum(${totalItem})::numeric(18,2) AS total_compra
            FROM nf n
            JOIN nf_prod np      ON np.codnf = n.codnf
            LEFT JOIN produtos p ON p.idproduto = np.codproduto
            LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto AND d.tipo = 'D'
           WHERE ${filtro}
           GROUP BY d.codfamilia, d.descricao
        `.execute(db)).rows
      : [];

    // a venda LÍQUIDA do departamento: soma os acréscimos e subtrai os descontos, um a um, como o legado.
    // O truncamento por `IAT` é o mesmo das outras telas de venda: 'A' arredonda, o resto trunca.
    const vendas = querVenda
      ? (await sql<Record<string, unknown>>`
          SELECT coalesce(d.codfamilia, -2) AS coddpto,
                 coalesce(d.descricao, 'SEM DEPARTAMENTO') AS descricao_departamento,
                 sum(
                   CASE WHEN v.iat = 'A' THEN round((v.qtde * v.vrvenda)::numeric, 2)
                        ELSE trunc((v.qtde * v.vrvenda)::numeric * 100) / 100 END
                   + GREATEST(coalesce(v.desc_acre_medio, 0), 0)
                   + GREATEST(coalesce(v.desc_acre_item, 0), 0)
                   - ( coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
                       + GREATEST(-coalesce(v.desc_acre_medio, 0), 0)
                       + GREATEST(-coalesce(v.desc_acre_item, 0), 0) )
                 )::numeric(18,2) AS total_venda
            FROM vendas v
            LEFT JOIN produtos p ON p.idproduto = v.codproduto
            LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto AND d.tipo = 'D'
           -- ⚠️ WHERE de verdade: no legado estas duas condições estão penduradas no LEFT JOIN e não
           -- filtram nada (ver o cabeçalho da classe). Corrigido de propósito.
           WHERE v.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
             AND v.idempresa = ANY(${empresas})
             AND coalesce(v.cancelado, 'N') = 'N'
             ${f.coddpto ? sql`AND p.coddpto = ${f.coddpto}` : sql``}
           GROUP BY d.codfamilia, d.descricao
        `.execute(db)).rows
      : [];

    const mapa = new Map<number, Record<string, unknown>>();
    for (const c of compras) {
      mapa.set(Number(c.coddpto), { ...c, total_compra: num(c.total_compra), total_venda: 0 });
    }
    for (const v of vendas) {
      const k = Number(v.coddpto);
      const atual = mapa.get(k) ?? { coddpto: k, descricao_departamento: v.descricao_departamento, total_compra: 0, total_venda: 0 };
      atual.total_venda = num(v.total_venda);
      mapa.set(k, atual);
    }
    const linhas = [...mapa.values()].sort((a, b) =>
      String(a.descricao_departamento).localeCompare(String(b.descricao_departamento), 'pt-BR'));
    return this.comPercentual(f.tipo, considerar, campoData, linhas);
  }

  /**
   * `TOTAL_PORC` sai zerado da consulta do legado (`:172`) e é o relatório impresso que calcula a
   * participação. Como aqui a grade É o relatório, a participação vem pronta.
   */
  private comPercentual(
    tipo: TipoRelCompras, considerar: ConsiderarRelCompras | null,
    campoData: CampoDataCompras, linhas: Array<Record<string, unknown>>,
  ) {
    const compra = r2(linhas.reduce((s, l) => s + num(l.total_compra), 0));
    const venda = r2(linhas.reduce((s, l) => s + num(l.total_venda), 0));
    return {
      tipo, considerar, campoData,
      linhas: linhas.map((l) => ({
        ...l,
        total_compra: num(l.total_compra),
        total_venda: num(l.total_venda),
        total_porc: compra === 0 ? 0 : r2((num(l.total_compra) / compra) * 100),
      })),
      totais: { compra, venda },
    };
  }
}
