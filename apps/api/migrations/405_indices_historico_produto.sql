-- 405 — os índices do HISTÓRICO DAS MOVIMENTAÇÕES do produto (aba do UCadProduto).
--  · A sub-aba Vendas casa o produto também pelo FILHO (`V.CODPRODUTO = :id OR V.IDPRODUTO_FILHO = :id`): o (codproduto, dtvenda) já
--    existe; sem o do filho o OR varre as 18,9 milhões de linhas. Parcial: o filho só está em ~3% das vendas.
--  · O pedido de compra liga a nota pelo PEDIDO_NF (`N.CODPEDIDO = P.CODPEDCOMP AND N.TIPO = 'P'`), que não tinha índice pelo pedido.
CREATE INDEX IF NOT EXISTS ix_vendas_filho_data ON vendas (idproduto_filho, dtvenda) WHERE idproduto_filho IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_pedido_nf_pedido ON pedido_nf (codpedido, tipo);
