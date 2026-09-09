-- 208 — TOTAL POR CARTÃO (`FRMRELCARTOES`, `uRelCartoes.pas`). Dossiê: `uRelCartoes.md`.
-- 382 acessos, 7 operadores, o último em 02/09/2026.
--
-- Nada de schema: `cartao`, `operadoras` (com `tipo`, `codadm`, `txadm`, `diascomp`) e `parceiros` já têm
-- tudo o que a consulta usa. Só o gate de acesso.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES ('FRMRELCARTOES', 'FRMRELCARTOES', 7, 1)
ON CONFLICT DO NOTHING;
