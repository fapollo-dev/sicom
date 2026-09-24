-- 329 — a PREVISÃO DE A PAGAR DO MANIFESTO (binário novo; recon de 24/09/2026 na produção: 6.632 previsões desde 18/03/2025,
-- 3.601 em 2026 — a maior família de títulos do ano).
-- NFE_FINANCEIRO_MANIFESTO é a grade "Financeiro" da análise da nota do manifesto: as parcelas que o usuário digita/ajusta antes
-- de gerar a previsão — e que vencem o `<dup>` do XML quando existem (30 contra 7). 270 linhas na produção (ID_ID_FM em 48.009).
CREATE SEQUENCE IF NOT EXISTS seq_nfe_financeiro_manifesto;
CREATE TABLE IF NOT EXISTS nfe_financeiro_manifesto (
  id_fm      integer PRIMARY KEY DEFAULT nextval('seq_nfe_financeiro_manifesto'),
  nrparcela  varchar(20),
  chavenfe   varchar(50) NOT NULL,
  data       date,
  valor      numeric(13,2)
);
CREATE INDEX IF NOT EXISTS ix_nfe_financeiro_manifesto_chave ON nfe_financeiro_manifesto (chavenfe);

-- a previsão é achada pela chave da NF-e no faturamento (a conversão) e na geração (o dedupe)
CREATE INDEX IF NOT EXISTS ix_apagar_chavenfe ON apagar (chavenfe);
