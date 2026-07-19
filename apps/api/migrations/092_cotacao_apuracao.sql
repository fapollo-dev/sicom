-- COTAÇÃO DE COMPRA — corte-2 (apuração + gerar-pedido). Não precisa de tabelas/colunas novas: a apuração usa
-- COTACAO_FORN_ITENS.GANHADOR/DEFINIDO/VERIFICADO (já na 091) e o gerar-pedido reusa o agregado do pedido-compra
-- (grava COTACAO.PEDIDOS). Só falta o grant RBAC da ação de processar (apurar/definir-ganhador/gerar-pedido).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADCOTACAO', 'BTNPROCESSAR', 7, 1), ('FRMCADCOTACAO', 'BTNPROCESSAR', 7, 2)
ON CONFLICT DO NOTHING;
