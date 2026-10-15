-- 427 — RELATÓRIO DE CAIXA: COMPETÊNCIA (FRMRELATORIOCAIXA, `TRelCompetencia`, uRelatorioCaixa.pas). Dossiê: uRelatorioCaixa.md.
-- O Imprimir da tela é Tag 1 — controlado pela opção BTNIMPRIMIR (65 concessões na produção, as mesmas 65 do acesso à tela).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES ('FRMRELATORIOCAIXA', 'BTNIMPRIMIR', 7, 1), ('FRMRELATORIOCAIXA', 'BTNIMPRIMIR', 7, 2)
ON CONFLICT DO NOTHING;
