-- 123 — EFD-Contribuições: receita NÃO-TRIBUTADA (registros M400/M410 PIS + M800/M810 COFINS). Alarga
-- apuracao_pc_det com CST_COFINS: as linhas de RECEITA ISENTA/ALÍQUOTA-ZERO/MONOFÁSICA (tipo='I') precisam do CST
-- de PIS (→ M400, agrupado por CST_PIS) E do CST de COFINS (→ M800, agrupado por CST_COFINS) — que podem diferir.
-- As linhas de crédito/débito (tipo C/D) deixam CST_COFINS nulo (usam só cst_pis). Fiel a GeraRegistroM400/M800
-- (UspedPisCofins.pas:1652/1892): emite a receita sem débito por CST 04/06/07/08/09, guardado por total>0.
ALTER TABLE apuracao_pc_det ADD COLUMN IF NOT EXISTS cst_cofins integer; -- espelha cst_pis (integer; formata 2-díg no SPED)
