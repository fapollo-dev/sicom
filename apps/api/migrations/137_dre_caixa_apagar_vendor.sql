-- 137 — CAIXA D.R.E. etapa 2: a coluna que o DIVISOR do rateio exige.
-- O rateio das despesas divide o valor pago pela base do título: quando NÃO há NF vinculada, a base é
-- `SUM(valor) + SUM(COALESCE(vendor,0))` dos títulos do mesmo grupo (aqqCaixaAnualDesp). `vendor` não estava
-- migrada e é VIVA no golden: 26.085 de 26.339 linhas preenchidas, 507 com valor ≠ 0.
-- Sem ela o divisor fica menor e cada centro de custo recebe uma fatia MAIOR do que deveria.
ALTER TABLE apagar
  ADD COLUMN IF NOT EXISTS vendor numeric(13,2);
