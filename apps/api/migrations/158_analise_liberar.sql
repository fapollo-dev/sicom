-- 158 — PENDÊNCIAS/ANÁLISE corte-2c: LIBERAR a análise (que fecha o pedido) e REFAZER (fluxo RPN).
-- `FechaPedidoCompra` (UAnalisePedidosNF.pas) marca no cabeçalho `IMPORTADO='S'`, `FECHADO='S'` e
-- `PC_NRONF_CRUZAMENTO` = as notas da análise; e nos itens (PEDIDO_COMPRA_QTDE no legado, `pedidocompra_i`
-- aqui pela projeção single-empresa da mig 078) `FECHADO='S'`, `DATA_FECHAMENTO` e o operador que fechou.
-- `fechado` e `pc_nronf_cruzamento` do cabeçalho já existem (mig 060); faltavam estes:
ALTER TABLE pedidocompra   ADD COLUMN IF NOT EXISTS importado char(1);
ALTER TABLE pedidocompra_i
  ADD COLUMN IF NOT EXISTS fechado                char(1),
  ADD COLUMN IF NOT EXISTS data_fechamento        date,
  ADD COLUMN IF NOT EXISTS codoperador_fechamento integer;
