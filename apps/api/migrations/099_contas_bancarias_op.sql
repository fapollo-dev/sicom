-- Contas Bancárias — aba "Liberação de operadores" (CONTAS_BANCARIAS_OP). Parte DEFERIDA da tela (só construída
-- agora que OPERADORES/PLANO_CONTAS migraram). Ponte conta↔operador: quem pode BAIXAR contas a receber/pagar por
-- essa conta. Chave natural (CODCONTA, CODOPERADOR); PK surrogate p/ o substitute do agregado (delete+insert).
-- Defaults 'S' (fiel ao OnNewRecord do legado, uRDmCadContaBancaria.pas:98-103).
CREATE SEQUENCE IF NOT EXISTS seq_contas_bancarias_op;
CREATE TABLE IF NOT EXISTS contas_bancarias_op (
  codrelacao   bigint PRIMARY KEY DEFAULT nextval('seq_contas_bancarias_op'),
  codconta     integer NOT NULL,
  codoperador  integer NOT NULL,
  cbo_baixa_cr char(1) NOT NULL DEFAULT 'S',
  cbo_baixa_cp char(1) NOT NULL DEFAULT 'S',
  UNIQUE (codconta, codoperador)
);
CREATE INDEX IF NOT EXISTS ix_contas_bancarias_op ON contas_bancarias_op (codconta);

-- fold auditoria [ALTA]: as contas contábeis de BANCO/CAIXA foram semeadas DEPOIS da mig 046 (em 053/058) e
-- ficaram com CLASSE=NULL — o backfill "NULL→'A'" da 046 rodou antes delas. Sem isso, o lookup (que filtra
-- CLASSE='A') não as oferece E o validar do codlanccontabil rejeita a conta bancária que já as referencia. Repete
-- o backfill da 046 (idempotente, mesma intenção: conta sem classe = analítica) — inclui as contas de banco.
UPDATE plano_contas SET classe = 'A' WHERE classe IS NULL;
