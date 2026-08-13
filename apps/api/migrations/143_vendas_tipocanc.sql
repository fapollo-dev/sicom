-- 143 — CANCELADOS (rel 28 ×3 variações e rel 30) e DESCONTOS (rel 32 ×2) do hub FRMRELVENDAS.
-- VENDAS.TIPOCANC: o TIPO do cancelamento — 'C' = cupom inteiro, 'I' = item. Golden (all-time, canceladas):
-- C = 35.677 · I = 74.879 · N = 24. A rel 30 filtra TIPOCANC='C' (só cancelamento de cupom fiscal).
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS tipocanc char(1);
