-- 156 — BOLETO: o percentual de MULTA da empresa, usado pelas INSTRUÇÕES do boleto
-- (`GerarInstrucao`, uConfBoleto.pas:1100-1195: multa = VALOR × EMPRESAS.PERCENT_MULTA / 100).
-- No Oracle: `EMPRESAS.PERCENT_MULTA` = 5,0 na empresa 1 e NULL na 50 (a coluna TXJUROPADRAO, que já existe
-- aqui, é a taxa de juros; a multa é outra coisa e faltava).
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS percent_multa numeric(13,4);
UPDATE empresas SET percent_multa = 5.0 WHERE idempresa = 1 AND percent_multa IS NULL;
