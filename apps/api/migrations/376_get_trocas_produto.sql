-- GET_TROCAS_PRODUTO (a view do legado, lida da produção — 2025-10): a quantidade que está "em troca" por produto × loja — os itens de
-- troca ainda não fechados (no legado ITENS_TROCA_QTDE com STATUS ≠ 'F', cópia 1:1 de ITENS_TROCA: aqui `fechado` ≠ 'S') e os itens dos
-- pedidos de devolução ao fornecedor de PRODUTO_TROCA 'S' ainda sem nota nem cancelados. O Dias de Estoque (uDDE.pas:196-203) a desconta
-- do estoque dos produtos SEM venda no período (e só deles — é o fonte). Colunas com os nomes do legado (CODIGO, EMPRESA, QUANTIDADE,
-- ESTOQUE_RETIRADA). Produção: 102 produtos × loja, 515 unidades, todas da loja.
CREATE OR REPLACE VIEW get_trocas_produto (codigo, empresa, quantidade, estoque_retirada) AS
SELECT i.idproduto, coalesce(i.idempresa, t.idempresa), sum(i.qtde),
       CASE WHEN i.estoqueretirada = 'LOJA' THEN 'E' ELSE i.estoqueretirada END
  FROM itens_troca i
  JOIN troca t ON t.codtroca = i.codtroca
 WHERE coalesce(i.fechado, 'N') <> 'S'
 GROUP BY i.idproduto, coalesce(i.idempresa, t.idempresa), CASE WHEN i.estoqueretirada = 'LOJA' THEN 'E' ELSE i.estoqueretirada END
UNION ALL
SELECT pi.idproduto, pd.idempresa, sum(pi.qtd_devolvida), NULL
  FROM pedido_devolucao_compra_i pi
  JOIN pedido_devolucao_compra pd ON pd.codpeddevcompra = pi.codpeddevcompra
 WHERE pd.status NOT IN ('NOTA FISCAL EMITIDA', 'NOTA_FISCAL_EMITIDA', 'CANCELADO')
   AND coalesce(pd.produto_troca, 'N') = 'S'
   AND coalesce(pd.indr, 'I') <> 'E'
 GROUP BY pi.idproduto, pd.idempresa;
