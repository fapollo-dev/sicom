-- 305 — SITUAÇÃO DA NF POR ITEM do pedido de compra (`PEDIDOCOMPRA_I.IDSITUACAO_NF`).
--
-- O legado deixa escolher a situação da nota por item (uPedidoCompra.pas:5183) ou no cabeçalho, que a repassa aos itens
-- sem situação (:5161) e aos itens novos (:7349); a impressão do pedido a mostra debaixo de cada item
-- (`ped_compra.fr3`, DESCRICAO_SITUACAO). Coluna esparsa na produção — 769 de 211.035 itens, 17 em 2025 — e por isso
-- fora da conta do conferidor (só olha colunas ≥ 50%). A carga traz pelo nome.
ALTER TABLE pedidocompra_i ADD COLUMN IF NOT EXISTS idsituacao_nf integer;
