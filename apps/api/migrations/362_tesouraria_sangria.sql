-- 362 — FECHAMENTO DE SANGRIAS (FRMFECHAMENTOSANGRIA, a tesouraria do binário novo; dossiê tesouraria-sangria-fechamento.md).
-- As colunas já existem (migs 142/322/311); faltam as sequências do legado e a configuração que exige autenticar para fechar.

-- as sequências (ID_LOTE_AUTENTICADO_SANGRIA 66.197, ID_LOTE_FECHADO_SANGRIA 7.801, ID_CODCONTAGEM_CEDULAS 4.601 na produção em
-- 25/09/2026): continuam do maior valor carregado
CREATE SEQUENCE IF NOT EXISTS seq_lote_autenticado_sangria;
SELECT setval('seq_lote_autenticado_sangria', (coalesce((SELECT max(lote_autenticado) FROM hist_sangria_suprimento), 0) + 1)::bigint, false);
CREATE SEQUENCE IF NOT EXISTS seq_lote_fechado_sangria;
SELECT setval('seq_lote_fechado_sangria', (greatest(coalesce((SELECT max(lote_fechado) FROM hist_sangria_suprimento), 0),
  coalesce((SELECT max(lote_fechado) FROM contagem_cedulas), 0)) + 1)::bigint, false);
CREATE SEQUENCE IF NOT EXISTS seq_contagem_cedulas;
SELECT setval('seq_contagem_cedulas', (coalesce((SELECT max(codcontagem_cedulas) FROM contagem_cedulas), 0) + 1)::bigint, false);
ALTER TABLE contagem_cedulas ALTER COLUMN codcontagem_cedulas SET DEFAULT nextval('seq_contagem_cedulas');
CREATE INDEX IF NOT EXISTS ix_hist_sangria_lote_fechado ON hist_sangria_suprimento (lote_fechado) WHERE lote_fechado IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_contagem_cedulas_lote ON contagem_cedulas (lote_fechado);

-- CONFIGURACOES id 392 (a linha da produção): o global N; na produção, as específicas Empresa 1 e 50 = S
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 392) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 392 END,
       'FECHAMENTOSANGRIA_EXIGE_AUTENTICACAO', 'N', 'String', 'Exige autenticar a sangria para liberar o fechamento', 'S;N|Sim;Não',
       'Empresa;Usuario', 'Vendas', 'Exige autenticar a sangria para liberar o fechamento'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'FECHAMENTOSANGRIA_EXIGE_AUTENTICACAO');
INSERT INTO configuracoes_especificas (id, tipo, chave, valor)
SELECT c.id, 'Empresa', e.chave, 'S' FROM configuracoes c CROSS JOIN (VALUES ('1'), ('50')) AS e(chave)
 WHERE c.codigo = 'FECHAMENTOSANGRIA_EXIGE_AUTENTICACAO'
ON CONFLICT DO NOTHING;

-- as permissões do legado (PERMISSOES: "Acessar formulário" e "Fechar/Reverter") para o operador de teste 7 da base de desenvolvimento
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMFECHAMENTOSANGRIA', 'FRMFECHAMENTOSANGRIA', 7, 1),
  ('FRMFECHAMENTOSANGRIA', 'BTNPROCESSO',          7, 1)
ON CONFLICT DO NOTHING;
