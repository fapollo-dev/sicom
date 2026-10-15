-- 428 — CADASTRO DO CENTRO DE CUSTOS (FRMCADPLC, uCadPLC.pas): a rota `cadastro/plc-tela` (o que o FormShow decide — a config
-- LANCAMENTO_CONTABIL_NO_CENTRO_CUSTO e se o operador é PRO) pede o acesso à tela; o operador de desenvolvimento ganha o grant da tela
-- (na produção são os 218 grants que vieram de FRMCADCENTROCUSTO, mig 194).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES ('FRMCADPLC', 'FRMCADPLC', 7, 1), ('FRMCADPLC', 'FRMCADPLC', 7, 2)
ON CONFLICT DO NOTHING;
