-- DEVOLUÇÃO DE COMPRAS: o STATUS com os valores do legado (auditoria de esqueletos §4.8, lacuna 2).
-- A produção grava STATUS_PEDIDO = 'EM DIGITACAO' / 'NOTA FISCAL EMITIDA' (com espaço; uCadPedidoDevolucaoCompras.pas:825) —
-- 64 e 34 linhas — e o Apollo tinha inventado 'EM_DIGITACAO' / 'NOTA_FISCAL_EMITIDA'. A carga só renomeia a coluna, então a
-- devolução aberta migrada não podia ser editada, finalizada nem cancelada (17 abertas em 2025-26). Agora o app usa os do legado.
UPDATE pedido_devolucao_compra SET status = 'EM DIGITACAO' WHERE status = 'EM_DIGITACAO';
UPDATE pedido_devolucao_compra SET status = 'NOTA FISCAL EMITIDA' WHERE status = 'NOTA_FISCAL_EMITIDA';
ALTER TABLE pedido_devolucao_compra ALTER COLUMN status SET DEFAULT 'EM DIGITACAO';
