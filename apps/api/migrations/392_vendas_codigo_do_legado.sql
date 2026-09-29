-- 392 — o CÓDIGO DA VENDA nas views de venda é o do legado.
--
-- No Oracle `VENDAS.CODVENDAS` identifica a VENDA (o cupom): ontem, 6.248 linhas para 1.572 códigos. Aqui `vendas.codvendas` é a
-- PK da LINHA (mig 105) e o código do legado vai para `codvendas_legado` (mig 175, extrair.py RENOMEIA); o mesmo com
-- `cx_vendas.codcxvendas` → `codcxvendas_legado`. As views da mig 391 usavam a PK da linha: GET_VENDAS saía uma linha por ITEM (e o
-- cabeçalho da 391 dizia isso como se fosse do legado — estava errado) e o CODVENDAS/CODIGO_CAIXA_VENDAS não era o número que o
-- cliente conhece.
--
-- E a GET_HIST_VENDAS (a pesquisa da consulta de histórico de vendas, mig 161) foi feita sobre uma versão antiga da view: 17
-- colunas, com o PIS na chave e o CODVENDAS como o menor ID de linha. A da produção hoje (ALL_VIEWS, 29/09/2026, VALID) tem 14
-- colunas e agrupa pelo CODVENDAS — uma linha por VENDA, sem o PIS. O dia continua na expressão do índice ix_vendas_emp_dia_local
-- (o TRUNC do legado no fuso da loja), para o filtro de período usar o índice.
--
-- Venda sem código do legado (lançada depois da carga — o Apollo não tem PDV, então só testes) agrupa pelo pedido; na pesquisa o
-- CODVENDAS dela é o menor ID de linha, para a lista ter chave.

-- ───────────────────────────────── GET_HIST_VENDAS (HISTÓRICO DE VENDA(S)/PEDIDO(S) REALIZADO(S)) ────────────────────────
DROP VIEW IF EXISTS get_hist_vendas;
CREATE VIEW get_hist_vendas AS
SELECT v.nropedido,
       c.razao                                                              AS cliente,
       v.nrocupom                                                           AS nro_cupom,
       o.nome                                                               AS operador,
       cast(sum(v.total_venda + v.acrescimo - v.desc_promocao) AS numeric(18,2)) AS total,
       ve.razao                                                             AS vendedor,
       v.idempresa,
       coalesce(v.codvendas_legado, min(v.codvendas_linha))                 AS codvendas,
       v.dtvenda                                                            AS data,
       v.codparceiro                                                        AS codcliente,
       sum(v.desc_promocao)                                                 AS desconto,
       sum(v.acrescimo)                                                     AS acrescimo,
       v.importado,
       v.tipocanc                                                           AS cancelado
  FROM (SELECT a.nropedido, a.codvendas_legado, min(a.codvendas) AS codvendas_linha, a.codproduto,
               (a.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date AS dtvenda,
               a.operador, a.codvendedor, a.codparceiro, a.idempresa, a.nrocupom,
               coalesce(a.tipocanc, 'N') AS tipocanc, a.importado,
               sum(CASE WHEN a.iat = 'A' THEN cast(a.qtde * a.vrvenda AS numeric(18,2))
                        ELSE cast(trunc(a.qtde * a.vrvenda * 100) AS numeric(18,2)) / 100 END) AS total_venda,
               sum((CASE WHEN coalesce(a.desc_acre_medio, 0) > 0 THEN coalesce(a.desc_acre_medio, 0) ELSE 0 END)
                 + (CASE WHEN coalesce(a.desc_acre_item, 0) > 0 THEN coalesce(a.desc_acre_item, 0) ELSE 0 END)) AS acrescimo,
               sum(coalesce(a.desc_promocao, 0) + coalesce(a.desc_departamento, 0)
                 + (CASE WHEN coalesce(a.desc_acre_medio, 0) < 0 THEN coalesce(a.desc_acre_medio, 0) * -1 ELSE 0 END)
                 + (CASE WHEN coalesce(a.desc_acre_item, 0) < 0 THEN coalesce(a.desc_acre_item, 0) * -1 ELSE 0 END)) AS desc_promocao
          FROM vendas a
         GROUP BY a.nropedido, a.codvendas_legado, a.codproduto, (a.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date, a.operador,
                  a.codvendedor, a.codparceiro, a.tipocanc, a.importado, a.idempresa, a.nrocupom) v
  LEFT JOIN parceiros c   ON c.codparceiro = v.codparceiro
  LEFT JOIN parceiros ve  ON ve.codparceiro = v.codvendedor
  LEFT JOIN operadores o  ON o.codoperador = v.operador
 GROUP BY v.nropedido, c.razao, v.nrocupom, o.nome, ve.razao, v.idempresa, v.codvendas_legado, v.dtvenda, v.codparceiro,
          v.importado, v.tipocanc;
COMMENT ON VIEW get_hist_vendas IS 'HISTÓRICO DE VENDA(S)/PEDIDO(S) REALIZADO(S)';

-- ──────────────────────────────────────────────────── GET_VENDAS (VENDAS) ──────────────────────────────────────────────────
DROP VIEW IF EXISTS get_vendas;
CREATE VIEW get_vendas AS
SELECT v.nropedido,
       c.razao                                                              AS cliente,
       v.nrocupom                                                           AS nro_cupom,
       o.nome                                                               AS operador,
       sum(CASE WHEN v.iat = 'A' THEN round(v.qtde * v.vrvenda, 2) ELSE trunc(v.qtde * v.vrvenda * 100) / 100 END) AS total,
       v.idempresa,
       v.codvendas_legado                                                   AS codvendas,
       (v.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date                   AS data,
       c.codparceiro                                                        AS codcliente,
       sum(coalesce(v.desc_acre_medio, 0) + coalesce(v.desc_acre_item, 0) + coalesce(v.desc_departamento, 0) * -1
           + coalesce(v.desc_promocao, 0) * -1)::numeric(15,4)              AS desc_acre,
       coalesce(v.importado, 'N')                                           AS importado,
       v.cancelado,
       v.venda_nfc                                                          AS nfc
  FROM vendas v
  LEFT JOIN parceiros c  ON c.codparceiro = v.codparceiro
  LEFT JOIN operadores o ON o.codoperador = v.operador
 GROUP BY v.nropedido, c.razao, v.nrocupom, o.nome, v.idempresa, v.codvendas_legado, (v.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date,
          c.codparceiro, v.importado, v.cancelado, v.venda_nfc;
COMMENT ON VIEW get_vendas IS 'VENDAS';

-- ───────────────────────────────────────────────── GET_VENDASRELAT (VENDAS;) ───────────────────────────────────────────────
DROP VIEW IF EXISTS get_vendasrelat;
CREATE VIEW get_vendasrelat AS
SELECT v.nropedido,
       c.codparceiro                                                        AS codigo_parceiro,
       c.razao                                                              AS cliente,
       v.nrocupom                                                           AS nro_cupom,
       p.codbarra                                                           AS cod_barra,
       v.vrcusto                                                            AS vr_custo,
       v.vrvenda                                                            AS vr_venda,
       v.qtde                                                               AS quantidade,
       v.promocao,
       v.descricao,
       v.unidade,
       v.aliquota,
       o.codoperador                                                        AS codigo_operador,
       o.nome                                                               AS operador,
       v.nroitem                                                            AS iditem,
       d.descricao                                                          AS departamento,
       g.descricao                                                          AS grupo,
       sg.descricao                                                         AS sub_grupo,
       v.comissao,
       ve.razao                                                             AS vendedor,
       v.desc_acre,
       v.pis,
       v.idempresa,
       v.codvendas_legado                                                   AS codvendas,
       v.dtvenda                                                            AS data_hora,
       (v.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date                   AS data,
       to_char(v.dtvenda AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS')::varchar(20) AS hora,
       0.00::numeric(13,2)                                                  AS desc_item,
       NULL::varchar(3)                                                     AS tipo,
       v.codvendedor                                                        AS codigo_vendedor,
       v.cancelado,
       p.idproduto                                                          AS codigo_produto,
       f.codparceiro                                                        AS codigo_fornecedor,
       f.razao                                                              AS razao_fornecedor,
       p.tipopis,
       (sum(v.qtde * v.vrvenda) + avg(v.desc_acre))::numeric(13,2)          AS total
  FROM vendas v
  LEFT JOIN parceiros c      ON c.codparceiro = v.codparceiro
  LEFT JOIN parceiros ve     ON ve.codparceiro = v.codvendedor
  LEFT JOIN operadores o     ON o.codoperador = v.operador
  LEFT JOIN produtos p       ON p.idproduto = v.codproduto
  LEFT JOIN parceiros f      ON f.codparceiro = p.codfor
  LEFT JOIN familias_prod d  ON d.codfamilia = v.coddpto
  LEFT JOIN familias_prod g  ON g.codfamilia = v.codgrupo
  LEFT JOIN familias_prod sg ON sg.codfamilia = v.codsubgrupo
 GROUP BY v.nropedido, c.codparceiro, c.razao, v.nrocupom, p.codbarra, v.vrcusto, v.vrvenda, v.qtde, v.promocao, v.descricao,
          v.unidade, v.aliquota, o.codoperador, o.nome, v.nroitem, d.descricao, g.descricao, sg.descricao, v.comissao, ve.razao,
          v.desc_acre, v.pis, v.idempresa, v.codvendas_legado, v.dtvenda, v.codvendedor, v.cancelado, p.idproduto, f.codparceiro,
          f.razao, p.tipopis;
COMMENT ON VIEW get_vendasrelat IS 'VENDAS;';

-- ──────────────────────────────────────────────────── GET_CX (CAIXAS) ──────────────────────────────────────────────────────
DROP VIEW IF EXISTS get_cx;
CREATE VIEW get_cx AS
SELECT cv.nropdv                                                            AS nro_caixa,
       o.nome                                                               AS operador,
       cv.operacao,
       cv.valor,
       cv.debito_credito,
       cv.nropedido,
       cv.codoperadora                                                      AS codigo_operadora,
       cv.codcxvendas_legado                                                AS codigo_caixa_vendas,
       cv.idempresa
  FROM cx_vendas cv
  JOIN operadores o ON o.codoperador = cv.codoperadora;
COMMENT ON VIEW get_cx IS 'CAIXAS';
