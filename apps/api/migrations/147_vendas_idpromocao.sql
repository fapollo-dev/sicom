-- 147 — rel 42 (Vendas com Desconto): VENDAS.IDPROMOCAO — o vínculo do item com a promoção externa
-- (Scanntech). VIVO no golden: 10.996 linhas all-time. É o que deriva DESC_SCANNTECH na rel 42
-- (CASE WHEN IDPROMOCAO IS NOT NULL THEN DESC_PROMOCAO). Os demais vínculos de desconto da mesma tela
-- (DESCLIBAMBEV, DESC_ACRE_OPERADOR, IDCLUBEDESCONTO_ATACAREJO/_COMBO/_CATEGORIA/_CATEGORIA_MF) são 0 em
-- TODA a história ⇒ ficam como literais 0 no serviço (cópia-fiel-negativa), sem coluna e sem os 4 joins
-- de CLUBE_DESCONTO (no-ops sobre colunas mortas).
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS idpromocao integer;
