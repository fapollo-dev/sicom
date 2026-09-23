-- 304 — META DIÁRIA DE COMPRA POR LOJA (`EMPRESAS.META_COMPRA`, uPedidoCompra.pas:2424 `mniFecharPedidoClick`).
--
-- Ao fechar o pedido, o legado soma, para cada loja do pedido, o `TOTALCUSTO` de TODOS os pedidos daquela loja na data
-- do pedido (`sqqTotalDiario`, udmPedidoCompra.dfm:2236) e, se passar da meta da loja, pede liberação com a senha
-- administrativa. Meta nula ou zero = sem meta. No cliente a coluna é nula nas 5 empresas (produção, 23/09/2026) — a
-- regra fica pronta, desligada, como lá. A carga traz a coluna pelo nome.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS meta_compra numeric(15,2);
