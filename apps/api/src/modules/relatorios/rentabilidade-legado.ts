import { sql, type RawBuilder } from 'kysely';

/**
 * O `sqqRel`, o `sqqAux` e a consulta do `RankingFamilias` da Rentabilidade por categorias (uRentabilidadeCategorias.dfm/.pas), em
 * PostgreSQL — a transcrição do SQL do DFM, expressão a expressão (`NUMBER(13,2)` → `numeric(13,2)`, `TRUNC(data)` → `::date`). Os
 * marcadores do legado viram parâmetros: `/*EMPRESAS*\/` (as lojas), `/*WHERE*\/` (os filtros de família/fornecedor),
 * `/*DESPESAOPERACIONAL*\/` (a informada, ou `AVG(COALESCE(E.DESPOPERACIONAL, 0))`), `/*FILTROSCRAP*\/` (só os scraps importados) e
 * `/*SQLNF*\/` (o "considerar notas de saída": o `GetSQLNf`).
 */
export interface ParametrosRentabilidade {
  dataIni: string;
  dataFim: string;
  uf: string;
  empresas: number[];
  /** o `edtDespOperacional`: > 0 vale o número; senão o da empresa (AVG) */
  despesaOperacional: number | null;
  /** o `chkFiltroSCRAP` */
  somenteScrapImportado: boolean;
  /** o `rdgPesquisa` = 1: as notas de saída com os CFOPs de venda entram como venda */
  considerarNf: boolean;
  /** o `/*WHERE*\/` (já com o prefixo AND) */
  where: RawBuilder<unknown>;
}

// as expressões que o SQL do legado repete (escritas uma vez aqui, com o MESMO texto em cada uso)
const CREDITO_ICMS = sql`(CASE WHEN avg(coalesce(m.icme, 0)) > 0 THEN (sum(v.t_total_custo) * CASE WHEN substr(p.aliquota, 1, 1) = 'T' THEN avg(coalesce(m.icme, 0)) ELSE 0 END) / 100 ELSE 0 END)`;
const CREDITO_PISCOFINS = sql`(CASE WHEN (e.classfiscal IN ('SN', 'ME', 'LP')) THEN 0 WHEN (max(coalesce(ps.aliq_pis_ent, 0)) = 0) THEN 0
  ELSE (((max(coalesce(ps.aliq_pis_ent, 0)) + max(coalesce(ps.aliq_cofins_ent, 0))) * sum(v.t_total_custo)) / 100) END)`;
const DEBITO_ICMS = sql`(CASE WHEN avg(coalesce(al.icm_efetivo, 0)) > 0 THEN (sum(v.t_total_venda) * avg(coalesce(al.icm_efetivo, 0)) / 100) ELSE 0 END)`;
const DEBITO_PISCOFINS = sql`(CASE WHEN (e.classfiscal = 'SN') THEN 0 WHEN max(coalesce(ps.aliq_pis_sai, 0)) = 0 THEN 0
  ELSE (((max(coalesce(ps.aliq_pis_sai, 0)) + max(coalesce(ps.aliq_cofins_sai, 0))) * sum(v.t_total_venda)) / 100) END)`;
const ENCARGOS = sql`( sum(v.qtde) * avg(coalesce(m.icmst, 0))) + ( sum(v.qtde) * avg(coalesce(m.vrfcpst, 0))) + ( sum(v.qtde) * avg(coalesce(m.despacessorio, 0)))
  - ( sum(v.qtde) * avg(coalesce(m.bonificacao, 0))) + ((sum(v.t_total_custo) * avg(coalesce(m.frete, 0))) / 100)
  + ((sum(v.t_total_custo) * avg(coalesce(m.frete2, 0))) / 100) + ((sum(v.t_total_custo) * avg(coalesce(m.seguro, 0))) / 100)
  + ((sum(v.t_total_custo) * avg(coalesce(m.ipi, 0))) / 100)`;
const CUSTO_REAL = sql`CAST((sum(v.t_total_custo) - ${CREDITO_ICMS} - (${CREDITO_PISCOFINS}) + ${ENCARGOS}) AS numeric(13,2))`;
// a venda líquida SEM o arredondamento final: o LUCRO e o LUCROLIQ do legado partem dela (só a coluna VENDALIQUIDA é arredondada)
const VENDA_LIQ_BRUTA = sql`(sum(v.t_total_venda) - ${DEBITO_ICMS} - (CAST(${DEBITO_PISCOFINS} AS numeric(13,2))))`;
const VENDA_LIQUIDA = sql`CAST(${VENDA_LIQ_BRUTA} AS numeric(13,2))`;

const despesa = (p: ParametrosRentabilidade) =>
  (p.despesaOperacional != null && p.despesaOperacional > 0 ? sql`${p.despesaOperacional}::numeric` : sql`avg(coalesce(e.despoperacional, 0))`);

/** a venda que entra (o "V" do legado): o cupom do PDV agrupado por loja × dia × produto × promoção × IAT, e as notas se pedido */
function vendasBase(p: ParametrosRentabilidade): RawBuilder<unknown> {
  const venda = sql`(CASE WHEN v.iat = 'A' THEN CAST((v.qtde * v.vrvenda) AS numeric(18,2)) ELSE (CAST(trunc((v.qtde * v.vrvenda) * 100) AS numeric(18,2)) / 100) END)`;
  const desconto = sql`(coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
    + (CASE WHEN coalesce(v.desc_acre_medio, 0) < 0 THEN (coalesce(v.desc_acre_medio, 0) * -1) ELSE 0 END)
    + (CASE WHEN coalesce(v.desc_acre_item, 0) < 0 THEN (coalesce(v.desc_acre_item, 0) * -1) ELSE 0 END))`;
  const nf = !p.considerarNf ? sql`` : sql`
      UNION ALL
      SELECT nf.idempresa, nf.dtcontabil::date AS dtvenda,
             CASE WHEN coalesce(x.vrvenda, 0) = 0 THEN coalesce(x.vrcusto, 0) ELSE coalesce(x.vrvenda, 0) END AS vrvenda,
             x.quantidade AS qtde, x.vrcusto, CAST('N' AS char(1)) AS promocao, coalesce(x.vrdescprod, 0) AS desc_acre, x.codproduto,
             CAST((((x.vrcusto * x.frete) / 100) + x.vroutrasdesp + x.depsacess + ((x.vrcusto * x.frete2) / 100)) AS numeric(18,2)) AS t_acrescimo,
             coalesce(x.vrdescprod, 0) AS t_desconto,
             CAST((x.quantidade * CASE WHEN coalesce(x.vrvenda, 0) = 0 THEN coalesce(x.vrcusto, 0) ELSE coalesce(x.vrvenda, 0) END) AS numeric(13,2)) AS t_total_venda,
             CAST((x.quantidade * x.vrcusto) AS numeric(13,2)) AS t_total_custo
        FROM nf_prod x
        JOIN nf ON nf.codnf = x.codnf
       WHERE nf.dtcontabil::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
         AND coalesce(nf.cancelada, 'N') = 'N' AND nf.tipo = 'S'
         AND nf.cfop::text IN ('5405','6405','5402','6402','5102','6102','5403','6403')
         AND nf.idempresa = ANY(${p.empresas})`;
  return sql`
      SELECT v.idempresa, v.dtvenda::date AS dtvenda, avg(v.vrvenda) AS vrvenda, sum(v.qtde) AS qtde, avg(v.vrcusto) AS vrcusto, v.promocao,
             sum(v.desc_acre) AS desc_acre, v.codproduto,
             sum((CASE WHEN coalesce(v.desc_acre_medio, 0) > 0 THEN coalesce(v.desc_acre_medio, 0) ELSE 0 END
                + CASE WHEN coalesce(v.desc_acre_item, 0) > 0 THEN coalesce(v.desc_acre_item, 0) ELSE 0 END)) AS t_acrescimo,
             sum(${desconto}) AS t_desconto,
             sum(${venda} - ${desconto}) AS t_total_venda,
             sum(CAST(v.qtde * v.vrcusto AS numeric(18,2))) AS t_total_custo
        FROM vendas v
       WHERE v.dtvenda::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
         AND coalesce(v.cancelado, 'N') = 'N'
         AND v.idempresa = ANY(${p.empresas})
       GROUP BY v.idempresa, v.dtvenda::date, v.codproduto, v.promocao, v.iat
      ${nf}`;
}

/** o `sqqRel`: uma linha por subgrupo × produto × promoção, ORDER BY 1, 24 DESC (SUBGRUPO, FRETE desc — a 24ª coluna) */
export function sqlRelatorio(p: ParametrosRentabilidade): RawBuilder<Record<string, unknown>> {
  const desp = despesa(p);
  const scrap = p.somenteScrapImportado ? sql`coalesce(r.importado, 'N') = 'S' AND` : sql``;
  return sql<Record<string, unknown>>`
    WITH temp AS (
      SELECT coalesce(s.descricao, 'SEM GRUPO') AS subgrupo, p.idproduto, p.codbarra, p.descricao,
             CAST(sum(v.t_total_custo) AS numeric(13,2)) AS totcusto,
             CAST(sum(v.t_total_venda) AS numeric(13,2)) AS totvenda,
             CAST((sum(v.t_total_venda) / nullif(sum(v.qtde), 0)) AS numeric(13,2)) AS vrunit,
             sum(v.qtde) AS totqtde,
             CAST((sum(v.t_total_custo) / nullif(sum(v.qtde), 0)) AS numeric(13,2)) AS vrcusto,
             sum(v.t_desconto) AS dctor,
             v.promocao,
             ${CUSTO_REAL} AS vrcustoreal,
             ${CREDITO_ICMS} AS creditoicms,
             ${DEBITO_ICMS} AS debitoicms,
             CAST(${CREDITO_PISCOFINS} AS numeric(13,2)) AS creditopiscofins,
             CAST(${DEBITO_PISCOFINS} AS numeric(13,2)) AS debitopiscofins,
             ${VENDA_LIQUIDA} AS vendaliquida,
             CAST(${VENDA_LIQ_BRUTA} - ${CUSTO_REAL} AS numeric(13,2)) AS lucro,
             CASE WHEN substr(p.aliquota, 1, 1) = 'T' THEN avg(coalesce(m.icme, 0)) ELSE 0 END AS icme,
             CASE WHEN substr(p.aliquota, 1, 1) = 'T' THEN avg(coalesce(al.icm_efetivo, 0)) ELSE 0 END AS icms,
             CAST(CASE WHEN avg(coalesce(al.icm_efetivo, 0)) > 0 THEN (sum(v.t_total_venda)) * avg(coalesce(al.icm_efetivo, 0)) / 100 ELSE 0 END AS numeric(13,2))
               - CAST(CASE WHEN avg(coalesce(m.icme, 0)) > 0 THEN (sum(v.t_total_custo)) * CASE WHEN substr(p.aliquota, 1, 1) = 'T' THEN avg(coalesce(m.icme, 0)) ELSE 0 END / 100 ELSE 0 END AS numeric(13,2)) AS icm,
             CAST((sum(v.qtde) * avg(coalesce(m.icmst, 0))) AS numeric(13,2)) AS st,
             CAST((sum(v.qtde) * avg(coalesce(m.vrfcpst, 0))) AS numeric(13,2)) AS vrfcpst,
             CAST(((sum(v.t_total_custo) * avg(coalesce(m.frete, 0))) / 100) AS numeric(13,2)) AS frete,
             CAST(((sum(v.t_total_custo) * avg(coalesce(m.frete2, 0))) / 100) AS numeric(13,2)) AS frete2,
             CAST((sum(v.qtde) * avg(coalesce(m.despacessorio, 0))) AS numeric(13,2)) AS despacess,
             CAST((sum(v.t_total_custo) * avg(coalesce(m.ipi, 0))) / 100 AS numeric(13,2)) AS ipi,
             CAST((sum(v.qtde) * avg(coalesce(m.bonificacao, 0))) AS numeric(13,2)) AS bonificacao,
             e.imprenda, e.contsocial,
             CAST((CAST(${DEBITO_PISCOFINS} AS numeric(13,2)) - CAST(${CREDITO_PISCOFINS} AS numeric(13,2))) AS numeric(13,2)) AS piscofins,
             CAST((${VENDA_LIQ_BRUTA} - ${CUSTO_REAL}) - CAST(((sum(v.t_total_venda) * ${desp}) / 100) AS numeric(13,2)) AS numeric(13,2)) AS lucroliq,
             CAST(CAST((sum(v.qtde) * avg(coalesce(m.icmst, 0))) AS numeric(13,2)) + CAST((sum(v.qtde) * avg(coalesce(m.vrfcpst, 0))) AS numeric(13,2))
               + CAST((sum(v.qtde) * avg(coalesce(m.despacessorio, 0))) AS numeric(13,2)) - CAST((sum(v.qtde) * avg(coalesce(m.bonificacao, 0))) AS numeric(13,2))
               + CAST(((sum(v.t_total_custo) * avg(coalesce(m.frete, 0))) / 100) AS numeric(13,2)) + CAST(((sum(v.t_total_custo) * avg(coalesce(m.frete2, 0))) / 100) AS numeric(13,2))
               + CAST(((sum(v.t_total_custo) * avg(coalesce(m.seguro, 0))) / 100) AS numeric(13,2)) + CAST(((sum(v.t_total_custo) * avg(coalesce(m.ipi, 0))) / 100) AS numeric(13,2))
               AS numeric(13,2)) AS adicionaiscusto,
             CAST(((sum(v.t_total_venda) * ${desp}) / 100) AS numeric(13,2)) AS despoperacional,
             CAST(((sum(v.t_total_custo) * avg(coalesce(m.seguro, 0))) / 100) AS numeric(13,2)) AS seguro,
             d.descricao AS dpto, g.descricao AS grupo,
             sum(v.t_acrescimo) AS acrescimo, sum(v.t_desconto) AS desc_promocao,
             coalesce((SELECT sum(i.qtde) FROM scrap_item i LEFT JOIN scrap r ON r.codscrap = i.codscrap
                        WHERE i.idproduto = v.codproduto AND r.dt_cadastro::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
                          AND ((i.motivo = 'LIXO/PERDA') OR (i.motivo = 'ROUBO')) AND ${scrap} r.idempresa = ANY(${p.empresas})), 0) AS qtdperda
        FROM (${vendasBase(p)}) v
        LEFT JOIN produtos p       ON p.idproduto = v.codproduto
        LEFT JOIN multi_preco m    ON m.idproduto = v.codproduto AND m.idempresa = v.idempresa
        LEFT JOIN familias_prod d  ON d.codfamilia = p.coddpto
        LEFT JOIN familias_prod g  ON g.codfamilia = p.codgrupo
        LEFT JOIN familias_prod s  ON s.codfamilia = p.codsubgrupo
        LEFT JOIN det_aliquota al  ON p.aliquota = al.aliquota AND al.uf = ${p.uf}
        LEFT JOIN empresas e       ON e.idempresa = v.idempresa
        LEFT JOIN piscofins ps     ON p.idpiscofins = ps.idpiscofins
       WHERE 0 = 0 ${p.where}
       GROUP BY s.descricao, p.idproduto, p.codbarra, p.descricao, v.promocao, p.codsubgrupo, d.descricao, g.descricao, v.codproduto,
                substr(p.aliquota, 1, 1), e.imprenda, e.contsocial, e.classfiscal
    )
    SELECT subgrupo, idproduto, codbarra, descricao, totcusto, totvenda, vrunit, totqtde, vrcusto, dctor, promocao, vrcustoreal,
           creditoicms, debitoicms, creditopiscofins, debitopiscofins, vendaliquida,
           lucro AS lucrobruto,
           lucro - (qtdperda * vrcusto) AS lucro,
           CASE WHEN (lucro - (qtdperda * vrcusto)) < 0 THEN 0 ELSE CAST((((lucro - (qtdperda * vrcusto)) / nullif(vendaliquida, 0)) * 100) AS numeric(13,2)) END AS margembruta,
           icme, icms, icm, st, vrfcpst, frete, frete2, despacess, ipi, piscofins, despoperacional, bonificacao, seguro, acrescimo, desc_promocao,
           (qtdperda * vrcusto) AS vrperda, adicionaiscusto,
           (lucroliq - (qtdperda * vrcusto)) AS lucroliq,
           CAST((CASE WHEN (lucroliq - (qtdperda * vrcusto)) > 0 THEN (((lucroliq - (qtdperda * vrcusto)) * coalesce(imprenda, 0)) / 100) ELSE 0 END) AS numeric(13,2)) AS imprenda,
           CAST((CASE WHEN (lucroliq - (qtdperda * vrcusto)) > 0 THEN (((lucroliq - (qtdperda * vrcusto)) * coalesce(contsocial, 0)) / 100) ELSE 0 END) AS numeric(13,2)) AS contsocial,
           CAST(((lucroliq - (qtdperda * vrcusto))
                 - CASE WHEN (lucroliq - (qtdperda * vrcusto)) < 0 THEN 0 ELSE (((lucroliq - (qtdperda * vrcusto)) * coalesce(imprenda, 0)) / 100) END
                 - CASE WHEN (lucroliq - (qtdperda * vrcusto)) < 0 THEN 0 ELSE (((lucroliq - (qtdperda * vrcusto)) * coalesce(contsocial, 0)) / 100) END) AS numeric(13,2)) AS lucrofinal,
           CASE WHEN (lucro - (qtdperda * vrcusto)) < 0 THEN 0
                ELSE CAST(((((lucroliq - (qtdperda * vrcusto))
                     - CASE WHEN (lucroliq - (qtdperda * vrcusto)) < 0 THEN 0 ELSE (((lucroliq - (qtdperda * vrcusto)) * coalesce(imprenda, 0)) / 100) END
                     - CASE WHEN (lucroliq - (qtdperda * vrcusto)) < 0 THEN 0 ELSE (((lucroliq - (qtdperda * vrcusto)) * coalesce(contsocial, 0)) / 100) END) / nullif(totvenda, 0)) * 100) AS numeric(13,2)) END AS margemfinal,
           dpto, grupo, qtdperda AS qtde_perda, coalesce(imprenda, 0) AS perc_imprenda, coalesce(contsocial, 0) AS perc_contsocial
      FROM temp
     ORDER BY subgrupo, frete DESC`;
}

/** o `sqqAux`: o lucro líquido (depois de IR e CSLL) de cada SUBGRUPO — o denominador da PARTICIPACAO */
export function sqlAuxiliar(p: ParametrosRentabilidade): RawBuilder<Record<string, unknown>> {
  const desp = despesa(p);
  const nf = !p.considerarNf ? sql`` : sql`
         UNION ALL
         SELECT x.codproduto, x.quantidade AS qtde,
                CASE WHEN coalesce(x.vrvenda, 0) = 0 THEN coalesce(x.vrcusto, 0) ELSE coalesce(x.vrvenda, 0) END AS vrvenda, x.vrcusto, nf.idempresa,
                CAST((x.quantidade * CASE WHEN coalesce(x.vrvenda, 0) = 0 THEN coalesce(x.vrcusto, 0) ELSE coalesce(x.vrvenda, 0) END) AS numeric(13,2)) AS t_total_venda,
                CAST((x.quantidade * x.vrcusto) AS numeric(13,2)) AS t_total_custo
           FROM nf_prod x JOIN nf ON nf.codnf = x.codnf
          WHERE nf.dtcontabil::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
            AND coalesce(nf.cancelada, 'N') = 'N' AND nf.tipo = 'S'
            AND nf.cfop::text IN ('5405','6405','5402','6402','5102','6102','5403','6403')
            AND nf.idempresa = ANY(${p.empresas})`;
  return sql<Record<string, unknown>>`
    SELECT subgrupo,
           sum(lucroliq
               - CASE WHEN ((lucroliq * imprenda) / 100) < 0 THEN 0 ELSE ((lucroliq * imprenda) / 100) END
               - CASE WHEN ((lucroliq * contsocial) / 100) < 0 THEN 0 ELSE ((lucroliq * contsocial) / 100) END) AS lucroliq
      FROM (
        SELECT s.descricao AS subgrupo, e.imprenda, e.contsocial,
               CAST(((${VENDA_LIQ_BRUTA} - ${CUSTO_REAL})
                     - CAST(((sum(v.t_total_venda) * ${desp}) / 100) AS numeric(13,2))) AS numeric(13,2)) AS lucroliq,
               v.codproduto
          FROM (
            SELECT v.codproduto, sum(v.qtde) AS qtde, avg(v.vrvenda) AS vrvenda, avg(v.vrcusto) AS vrcusto, v.idempresa,
                   sum(((CASE WHEN v.iat = 'A' THEN CAST((v.qtde * v.vrvenda) AS numeric(18,2)) ELSE (CAST(trunc((v.qtde * v.vrvenda) * 100) AS numeric(18,2)) / 100) END)
                        - (coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
                           + (CASE WHEN coalesce(v.desc_acre_medio, 0) < 0 THEN (coalesce(v.desc_acre_medio, 0) * -1) ELSE 0 END)
                           + (CASE WHEN coalesce(v.desc_acre_item, 0) < 0 THEN (coalesce(v.desc_acre_item, 0) * -1) ELSE 0 END)))) AS t_total_venda,
                   sum(CAST(v.qtde * v.vrcusto AS numeric(18,2))) AS t_total_custo
              FROM vendas v
             WHERE v.dtvenda::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
               AND coalesce(v.cancelado, 'N') = 'N'
               AND v.idempresa = ANY(${p.empresas})
             GROUP BY v.idempresa, v.dtvenda::date, v.codproduto, v.iat
            ${nf}
          ) v
          LEFT JOIN produtos p       ON p.idproduto = v.codproduto
          LEFT JOIN multi_preco m    ON m.idproduto = v.codproduto AND m.idempresa = v.idempresa
          LEFT JOIN familias_prod s  ON s.codfamilia = p.codsubgrupo
          LEFT JOIN det_aliquota al  ON p.aliquota = al.aliquota AND al.uf = ${p.uf}
          LEFT JOIN empresas e       ON e.idempresa = v.idempresa
          LEFT JOIN piscofins ps     ON p.idpiscofins = ps.idpiscofins
         GROUP BY s.descricao, substr(p.aliquota, 1, 1), v.codproduto, e.imprenda, e.contsocial, e.classfiscal
      ) x
     GROUP BY subgrupo
     ORDER BY subgrupo`;
}

/**
 * O `cdsSQL` do `RankingFamilias` (só o que a Rentabilidade usa dele: o LUCROFIN de cada família, que ordena o INDICE): venda, custo,
 * ICMS de entrada/saída (média), ST+FCP-ST, PIS/COFINS, frete, acessórias e IPI por SUBGRUPO (as colunas desnormalizadas da VENDAS).
 */
export function sqlRanking(p: ParametrosRentabilidade): RawBuilder<Record<string, unknown>> {
  const venda = sql`((CASE WHEN v.iat = 'A' THEN CAST((v.qtde * v.vrvenda) AS numeric(18,2)) ELSE (CAST(trunc((v.qtde * v.vrvenda) * 100) AS numeric(18,2)) / 100) END)
    - (coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
       + (CASE WHEN coalesce(v.desc_acre_medio, 0) < 0 THEN (coalesce(v.desc_acre_medio, 0) * -1) ELSE 0 END)
       + (CASE WHEN coalesce(v.desc_acre_item, 0) < 0 THEN (coalesce(v.desc_acre_item, 0) * -1) ELSE 0 END)))`;
  const nf = !p.considerarNf ? sql`` : sql`
      UNION ALL
      SELECT s.codfamilia, s.descricao, m.markup AS margsis, np.quantidade AS qtde, (np.quantidade * np.vrcusto) AS custo,
             (np.quantidade * np.vrvenda) AS venda, ((np.quantidade * np.vrvenda) - (np.quantidade * np.vrcusto)) AS lucro,
             CASE WHEN substr(p.aliquota, 1, 1) = 'T' THEN coalesce(m.icme, 0) ELSE 0 END AS icme, al.icm_efetivo AS icms,
             (np.quantidade * coalesce(m.icmst, 0)) AS st,
             (np.quantidade * (coalesce(m.debitopiscofins, 0) - coalesce(m.creditopiscofins, 0))) AS piscofins,
             (((np.quantidade * np.vrcusto) * coalesce(m.frete, 0)) / 100) AS frete,
             CAST(((np.quantidade * np.vrcusto) * coalesce(m.despacessorio, 0)) / 100 AS numeric(13,2)) AS despacess,
             CAST(((np.quantidade * np.vrcusto) * coalesce(m.ipi, 0)) / 100 AS numeric(13,2)) AS ipi
        FROM nf v
        JOIN nf_prod np ON v.codnf = np.codnf
        LEFT JOIN produtos p       ON p.idproduto = np.codproduto
        LEFT JOIN multi_preco m    ON m.idproduto = np.codproduto AND m.idempresa = v.idempresa
        LEFT JOIN familias_prod s  ON s.codfamilia = p.codsubgrupo
        LEFT JOIN det_aliquota al  ON p.aliquota = al.aliquota AND al.uf = ${p.uf}
       WHERE v.dtemissao::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
         AND v.cancelada = 'N' AND v.idempresa = ANY(${p.empresas})`;
  return sql<Record<string, unknown>>`
    SELECT codfamilia, descricao, sum(custo) AS custo, sum(venda) AS venda, sum(lucro) AS lucro,
           avg(icme) AS icme, avg(icms) AS icms, sum(st) AS st, sum(piscofins) AS piscofins, sum(frete) AS frete,
           sum(despacess) AS despacess, sum(ipi) AS ipi
      FROM (
        SELECT s.codfamilia, s.descricao, m.markup AS margsis, v.qtde, (v.qtde * v.vrcusto) AS custo, ${venda} AS venda,
               (${venda} - (v.qtde * v.vrcusto)) AS lucro,
               CASE WHEN substr(p.aliquota, 1, 1) = 'T' THEN coalesce(m.icme, 0) ELSE 0 END AS icme, al.icm_efetivo AS icms,
               (v.qtde * coalesce(m.icmst, 0)) + (v.qtde * coalesce(m.vrfcpst, 0)) AS st,
               CAST((CAST((CASE WHEN (e.classfiscal = 'SN') THEN 0 WHEN coalesce(ps.aliq_pis_sai, 0) = 0 THEN 0
                                ELSE (((coalesce(ps.aliq_pis_sai, 0) + coalesce(ps.aliq_cofins_sai, 0)) * ${venda}) / 100) END) AS numeric(13,2))
                     - CAST((CASE WHEN (e.classfiscal IN ('SN', 'ME', 'LP')) THEN 0 WHEN (coalesce(ps.aliq_pis_ent, 0) = 0) THEN 0
                                ELSE (((coalesce(ps.aliq_pis_ent, 0) + coalesce(ps.aliq_cofins_ent, 0)) * (v.qtde * v.vrcusto)) / 100) END) AS numeric(13,2))) AS numeric(13,2)) AS piscofins,
               (((v.qtde * v.vrcusto) * coalesce(m.frete, 0)) / 100) AS frete,
               (v.qtde * coalesce(m.despacessorio, 0)) AS despacess,
               CAST(((v.qtde * v.vrcusto) * coalesce(m.ipi, 0)) / 100 AS numeric(13,2)) AS ipi
          FROM vendas v
          LEFT JOIN produtos p       ON p.idproduto = v.codproduto
          LEFT JOIN multi_preco m    ON m.idproduto = v.codproduto AND m.idempresa = v.idempresa
          LEFT JOIN familias_prod s  ON s.codfamilia = v.codsubgrupo
          LEFT JOIN empresas e       ON e.idempresa = v.idempresa
          LEFT JOIN piscofins ps     ON p.idpiscofins = ps.idpiscofins
          LEFT JOIN det_aliquota al  ON p.aliquota = al.aliquota AND al.uf = ${p.uf}
         WHERE v.dtvenda::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
           AND v.cancelado = 'N' AND v.idempresa = ANY(${p.empresas})
        ${nf}
      ) x
     GROUP BY codfamilia, descricao`;
}
