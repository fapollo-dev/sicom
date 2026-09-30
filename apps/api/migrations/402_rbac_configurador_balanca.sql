-- O CONFIGURADOR DA BALANÇA (BtnConfiguraBal, Tag 1 — opção BTNCONFIGURABAL, 124 permissões na produção): o grant do operador de
-- desenvolvimento (7) nas empresas 1 e 2; a carga traz as permissões reais do cliente.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMEXPORTABALANCA', 'BTNCONFIGURABAL', 7, 1),
  ('FRMEXPORTABALANCA', 'BTNCONFIGURABAL', 7, 2)
ON CONFLICT DO NOTHING;
