-- 135 — VALOR DO TICKET MÉDIO (FRMVALORTICKETMEDIO) — 4º relatório. 612 acessos / 9 operadores.
-- Nenhuma coluna nova: lê só VENDAS (mig 105) e EMPRESAS (mig 032). Este arquivo é só o RBAC.
-- RBAC: 1 opção real no Oracle (a própria tela, 34 grants) — nenhum gate de botão.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMVALORTICKETMEDIO', 'FRMVALORTICKETMEDIO', 7, 1),
  ('FRMVALORTICKETMEDIO', 'FRMVALORTICKETMEDIO', 7, 2)
ON CONFLICT DO NOTHING;
