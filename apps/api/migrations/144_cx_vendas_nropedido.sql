-- 144 — rel 29 (Vendas por Cliente e Vendedor): o vínculo pagamento→pedido.
-- CX_VENDAS.NROPEDIDO existe no Oracle (é como a rel 29 descobre a FORMA DE PAGAMENTO do pedido:
-- MIN(OPERACAO) dos lançamentos DEBITO_CREDITO='C' do pedido). A mig 106 trouxe o subset fiscal e não
-- precisou dela; a 140 trouxe a CHAVE; agora falta esta.
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS nropedido varchar(20);
CREATE INDEX IF NOT EXISTS ix_cx_vendas_pedido ON cx_vendas (nropedido);
