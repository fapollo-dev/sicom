-- 381 — permissões de CONTROLE, lote 3 (docs/05-migration-engineering/permissoes-de-controle.md): os botões que disparam rotas —
-- o menu "NF-e" da nota (transmitir e cancelar são submenus dele), "Processar" da multi-atualização, "Consultar" da rentabilidade e do
-- desconto de título, "Novo relatório" e "Excluir modelo" da tela de relatórios.
-- Fixture de RBAC do seed (operador 7, lojas 1 e 2), como as demais migrações: a carga traz as PERMISSOES reais.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT x.form, x.opcao, 7, e.emp
  FROM (VALUES ('FRMNF', 'GERARNFE1'), ('FRMMULTATUALIZACAO', 'BTNPROCESSAR'), ('FRMRENTABILIDADECATEGORIAS', 'BTNCONSULTA'),
               ('FRMDESCONTOTITULO', 'BTNCONSULTA'), ('FRMRELATORIO', 'BTNNOVORELATORIO'), ('FRMRELATORIO', 'BTNEXCLUIMODELO')) AS x(form, opcao)
 CROSS JOIN (VALUES (1), (2)) AS e(emp)
ON CONFLICT DO NOTHING;
