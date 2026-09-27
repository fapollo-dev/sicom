-- 383 — RBAC fiel ao legado, parte 2 (docs/05-migration-engineering/permissoes-de-controle.md): telas que o legado abre DE
-- DENTRO de outras (sem gate próprio) passam a aceitar o gate de qualquer tela por onde o operador chega
-- (`@RequerAcessoDeAlgum`); o estorno de movimento de caixa é o excluir do FRMMOVCAIXA; o clube de desconto é detalhe da
-- promoção (FRMCADPROMOCAO). Fixture do seed (operador 7, lojas 1 e 2); a carga traz as PERMISSOES reais.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT x.form, x.opcao, 7, e.emp
  FROM (VALUES ('FRMCADPRODUTO', 'FRMCADPRODUTO'), ('FRMCONSPROD', 'FRMCONSPROD'), ('FRMCONSPROD', 'BTNCADASTRO'),
               ('FRMMANIFESTODFE', 'FRMMANIFESTODFE'), ('FRMMOVCAIXA', 'FRMMOVCAIXA'), ('FRMMOVCAIXA', 'BTNEXCLUIR'),
               ('FRMFECHAMENTOCAIXA', 'FRMFECHAMENTOCAIXA'), ('FRMCADPROMOCAO', 'FRMCADPROMOCAO'),
               ('FRMCADPROMOCAO', 'BTNGRAVAR'), ('FRMCADPROMOCAO', 'BTNEXCLUIR')) AS x(form, opcao)
 CROSS JOIN (VALUES (1), (2)) AS e(emp)
ON CONFLICT DO NOTHING;
