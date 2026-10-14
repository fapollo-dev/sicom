-- 422 — as configurações que o cadastro de parceiros (uCadClientes: FormShow :3848, edtCodigoExit) lê e o destino não tinha: ids, defaults e
-- whitelist = CONFIGURACOES da produção em 14/10/2026; o override é o da produção (o módulo Retaguarda libera a aba Histórico financeiro).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (169, 'PERMITIR_HISTORICO', 'N', 'String', 'Modulo;Empresa;Grupo;Usuario', 'Permitir visualizar aba histórico financeiro (tsSaldoParceiros.TabVisible).'),
  (189, 'PARCEIRO_EXIBIR_DADOS_FINANCEIROS', 'S', 'String', 'Modulo;Empresa;Grupo;Usuario', 'Define se vai exibir aba dados financeiros no cadastro de Parceiros.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO configuracoes_especificas (id, tipo, chave, valor) VALUES
  (169, 'Modulo', 'Retaguarda', 'S')
ON CONFLICT DO NOTHING;
-- o "Visualizar senha dados financeiros" (ppmBotaoOutros, Tag 1 — 159 concessões na produção) para o operador de desenvolvimento/smoke
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT 'FRMCADCLIENTES', 'VISUALIZARSENHADADOSFINANCEIROS1', 7, e.e FROM (VALUES (1), (2)) AS e(e)
 WHERE NOT EXISTS (SELECT 1 FROM permissoes p WHERE p.form = 'FRMCADCLIENTES' AND p.opcao = 'VISUALIZARSENHADADOSFINANCEIROS1' AND p.codoperador = 7 AND p.codempresa = e.e);
