-- 404 — o acesso à TELA de scrap (a opção = o nome do form, como o `PossuiAcessoForm` do legado) para o operador de fixture (7, lojas 1
-- e 2): o "Imprimir Scrap" não tem Tag e vale o acesso à tela. A carga traz as PERMISSOES reais.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT 'FRMCADSCRAP', 'FRMCADSCRAP', 7, e.emp FROM (VALUES (1), (2)) AS e(emp)
ON CONFLICT DO NOTHING;
