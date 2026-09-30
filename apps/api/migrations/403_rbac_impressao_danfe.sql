-- 403 — as permissões de controle da impressão do DANFE na NF: o item "Imprimir DANFE" do menu "NF-e" (IMPRIMIRDANFE1, Tag 1, submenu
-- de GERARNFE1) e o botão "Imprimir" do rodapé NF-e (BTNIMPRIMIRNFE, Tag 1) — ambas vivas na produção (169 concessões de
-- IMPRIMIRDANFE1 em 30/09/2026). Fixture de RBAC do seed (operador 7, lojas 1 e 2), como as demais: a carga traz as PERMISSOES reais.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT 'FRMNF', x.opcao, 7, e.emp
  FROM (VALUES ('IMPRIMIRDANFE1'), ('BTNIMPRIMIRNFE')) AS x(opcao)
 CROSS JOIN (VALUES (1), (2)) AS e(emp)
ON CONFLICT DO NOTHING;
