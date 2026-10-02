-- 406 — o acesso à TELA de clientes (a opção = o nome do form, como o `PossuiAcessoForm` do legado) para o operador de fixture (7, lojas
-- 1 e 2): as impressões do cadastro (ficha cadastral, cartão, histórico financeiro) valem o acesso à tela. A carga traz as PERMISSOES reais.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT 'FRMCADCLIENTES', 'FRMCADCLIENTES', 7, e.emp FROM (VALUES (1), (2)) AS e(emp)
ON CONFLICT DO NOTHING;
