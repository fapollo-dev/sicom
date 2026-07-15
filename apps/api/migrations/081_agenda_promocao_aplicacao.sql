-- 081 — AGENDA DE PROMOÇÃO corte-2: APLICAÇÃO do preço promocional ao multi_preco.
--
-- Ativar a agenda grava o preço promocional no MULTI_PRECO vigente (UPDATE MULTI_PRECO SET PROMOCAO='S',
-- VRPROMO=VLRPROMOCAO, uCadAgendaPromocao:247) e o encerrar REVERTE (SET PROMOCAO='N' WHERE CODAGENDA=x,
-- uCadAgendaPromocao:750). O `multi_preco` já tem vrpromo+promocao; falta o LINK com a agenda que ligou a
-- promoção — p/ reverter só as linhas desta campanha (reversão precisa, sem tocar promoções de outra agenda).
ALTER TABLE multi_preco ADD COLUMN IF NOT EXISTS codagenda integer; -- agenda que ligou a promoção deste preço
CREATE INDEX IF NOT EXISTS ix_multi_preco_codagenda ON multi_preco (codagenda);

-- RBAC da aplicação (aplicar/reverter o preço promocional).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMAGENDAPROMOCAO', 'BTNAPLICARPRECO', 7, 1), ('FRMAGENDAPROMOCAO', 'BTNAPLICARPRECO', 7, 2)
ON CONFLICT DO NOTHING;
