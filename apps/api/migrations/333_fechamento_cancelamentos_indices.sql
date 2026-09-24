-- 333 — os índices que os diálogos de CANCELAMENTOS e DESCONTOS do fechamento de caixa precisam (corte 4.6).
--
-- O legado tem IDX_VENDAS_CHAVE (VENDAS.CHAVE) e IDX_HISTORICO_PDV_DU_01 (HISTORICO_PDV: IDEMPRESA, NROPEDIDO); aqui não
-- existiam. Os diálogos filtram as vendas pela CHAVE do turno (18,9 milhões de linhas na produção) e buscam o motivo e o
-- responsável no HISTORICO_PDV (661 mil) por pedido e item, uma subconsulta por linha.
CREATE INDEX IF NOT EXISTS ix_vendas_chave ON vendas (chave);
-- o cupom cancelado casa pela chave do CANCELAMENTO quando houver (`GetSQLCupomTChaveTurno`): só as linhas canceladas
CREATE INDEX IF NOT EXISTS ix_vendas_chave_cancelada ON vendas ((coalesce(chave_cancelamento, chave))) WHERE cancelado = 'S';
CREATE INDEX IF NOT EXISTS ix_historico_pdv_pedido ON historico_pdv (nropedido, nroitem);
