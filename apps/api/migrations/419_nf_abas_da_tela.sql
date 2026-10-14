-- 419 — a permissão de controle "Observação NF" (DBMOBS) da tela da NF: o memo de observações só é editável por quem a tem
-- (36 dos 67 operadores da produção em 14/10/2026; a opção é do binário novo — o dbmObs do .dfm de 2020 não tem Tag). Fixture de RBAC
-- do seed (operador 7, lojas 1 e 2), como a 403: a carga traz as PERMISSOES reais.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT 'FRMNF', 'DBMOBS', 7, e.emp FROM (VALUES (1), (2)) AS e(emp)
ON CONFLICT DO NOTHING;
