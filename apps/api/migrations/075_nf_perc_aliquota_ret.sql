-- 075 — A PAGAR resíduo (e): SNAPSHOT das alíquotas de retenção no cabeçalho da NF (perc_aliquota_ret_*).
--
-- O motor calcularRetencoes (nf-fiscal, F2) já grava nf.total_ret_* (o VALOR retido). Mas a ALÍQUOTA usada
-- p/ compor a OBS do título A Pagar era RELIDA da config no faturamento (F4, nf-faturamento:230) — se a config
-- (ALIQUOTA_RETENCAO_* / PERC_ALIQUOTA_IR/ISSQN do parceiro) mudasse ENTRE o F2 e o F4, a OBS divergia do valor
-- realmente retido. O legado congela a alíquota no cabeçalho no cálculo (cds PERC_ALIQUOTA_RET_*, udmNF.pas:2346-2352,
-- gravada no CalcularRetencoes udmNF.pas:3659-3679) e a OBS do InserirAPagar lê o SNAPSHOT (udmNF.pas:8630).
--
-- Este corte espelha as 7 colunas. O F2 (calcularRetencoes) passa a gravar a alíquota REAL usada por imposto;
-- o F4 (gerarTitulosRetencao) lê o snapshot p/ a OBS → OBS byte-a-byte estável sob drift de config. Sem front
-- (colunas internas). NÃO afeta o VALOR do título (que já era o snapshot nf.total_ret_*), só o texto da OBS.
ALTER TABLE nf
  ADD COLUMN IF NOT EXISTS perc_aliquota_ret_pis      numeric(13,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS perc_aliquota_ret_cofins   numeric(13,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS perc_aliquota_ret_csll     numeric(13,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS perc_aliquota_ret_ir       numeric(13,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS perc_aliquota_ret_inss     numeric(13,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS perc_aliquota_ret_issqn    numeric(13,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS perc_aliquota_ret_funrural numeric(13,2) NOT NULL DEFAULT 0;
