-- 082 — AGENDA DE PROMOÇÃO: folds da auditoria adversarial do corte-1.
--
-- [MÉDIA] anti-sobreposição = GATE por config (não bloqueio duro). O legado só (semi)bloqueia o mesmo produto
-- em agendas sobrepostas quando PERMITE_PRODUTO_MAIS_UMA_AGENDA='N' (uCadAgendaPromocao:935/1425); o default é
-- permissivo (confirm-and-continue → no web = permitir). Seed default 'S' (fiel ao legado permissivo); o operador
-- põe 'N' p/ forçar o bloqueio. Escopo Empresa (override por loja).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (332, 'PERMITE_PRODUTO_MAIS_UMA_AGENDA', 'S', 'texto', 'Modulo;Empresa', 'Permite o mesmo produto em mais de uma agenda de promoção com período sobreposto. ''S'' (default, fiel ao legado) = permite; ''N'' = bloqueia (PROMOCAO_PRODUTO_SOBREPOSTO).')
ON CONFLICT (id) DO NOTHING;
