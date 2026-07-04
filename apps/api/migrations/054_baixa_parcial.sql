-- 054 — AR/AP corte-3a: BAIXA PARCIAL. Quando o valor pago é MENOR que o total devido, o legado
-- (UBaixaAreceber.pas:1403-1490) baixa o título original por inteiro E gera um NOVO título com o SALDO
-- (ORIGEM='B', GERADO='SISTEMA', QUITADA='N'). Para permitir o ESTORNO limpo da baixa parcial (remover
-- o título-saldo ao reabrir), a linha da baixa passa a APONTAR para o título-saldo que gerou.
-- Aditivo: só 2 colunas de vínculo (nenhuma tabela nova; ORIGEM='B' já existe no schema).
ALTER TABLE areceber_bx ADD COLUMN IF NOT EXISTS codrcb_gerado integer;  -- → areceber.codrcb do título-saldo (baixa parcial)
ALTER TABLE apagar_bx   ADD COLUMN IF NOT EXISTS codapg_gerado integer;  -- → apagar.codapg do título-saldo (pagamento parcial)
