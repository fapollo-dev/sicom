-- 306 — RELATÓRIO DE PEDIDOS DE COMPRA, previsão de pagamentos (`FRMRELPEDIDOCOMPRA`, uRelPedidosCompra.pas): o gate.
--
-- 63 acessos, 6 operadores. A fila o dava como "sem fonte no repositório" — o fonte existe (`uRelPedidosCompra.pas`,
-- com "s"; a classe é `TfrmRelPedidoCompra`). O legado concede só o gate da tela (12 linhas na PERMISSOES, todas
-- FRMRELPEDIDOCOMPRA/FRMRELPEDIDOCOMPRA).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELPEDIDOCOMPRA', 'FRMRELPEDIDOCOMPRA', 7, 1),
  ('FRMRELPEDIDOCOMPRA', 'FRMRELPEDIDOCOMPRA', 7, 2)
ON CONFLICT DO NOTHING;
