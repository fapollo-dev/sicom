-- 430 — CADASTRO DE CFOP (FRMCADCFOP, UCadCFOP.pas): a rota `cadastro/cfop-aliquotas` (o combo "Alíquota Saída" = a DET_ALIQUOTA da UF da
-- empresa, com o ICM_EFETIVO do "ICMS Saída") pede o acesso à tela; o operador de desenvolvimento ganha o grant (66 na produção).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES ('FRMCADCFOP', 'FRMCADCFOP', 7, 1), ('FRMCADCFOP', 'FRMCADCFOP', 7, 2)
ON CONFLICT DO NOTHING;
