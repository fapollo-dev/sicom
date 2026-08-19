-- 165 — APURAÇÃO DE ICMS: folds da auditoria da mig 164. O cabeçalho (E110) estava fiel; **o detalhe não**, e como
-- o `icms_cfop` é Σ do detalhe por CFOP (provado no golden: 5/5 medidas iguais em 7 CFOPs da apuração 1083), cada
-- erro de campo do detalhe virava erro no livro.
--
-- As colunas abaixo são o que faltava para a perna do CUPOM ser fiel. O legado apura NFC-e a partir da tabela de
-- itens do cupom, que tem base e alíquota de ICMS PRÓPRIAS (`GetSQLNFC`, uRelRegistros_ES.pas:1798-1812):
--   BASE = SUM(V.ICMS_BASE_CALCULO)   ·   ICMS = ICMS_EFETIVO = V.ICMS_ALIQUOTA   ·   ISENTAS = OUTRAS = 0 (literal)
-- e o identificador do documento é `N.CODNFC||'NFC'` (golden: '2022377NFC'), não o nosso `nropedido` — que casa com
-- 0 de 1.400.580 linhas do golden.
--
-- ⚠️ ESCRITOR: estas três colunas vêm da CARGA (o dado nasce no PDV legado). Enquanto não vierem preenchidas, a
-- perna do cupom usa fallback aproximado (valor do item quando há ICMS destacado) — e a base do golden mostra que a
-- aproximação erra quando há redução (cupom 2022377: base 22,11 contra item 37,90). Registrado no dossiê §5.
ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS icms_base_calculo numeric(15,2),  -- base de ICMS do item do cupom (pode ser REDUZIDA)
  ADD COLUMN IF NOT EXISTS icms_aliquota     numeric(13,4),  -- alíquota do item (vai em ICMS e ICMS_EFETIVO)
  ADD COLUMN IF NOT EXISTS codnfc            integer;        -- id do documento NFC-e (o `CODIGO` do detalhe usa este)
CREATE INDEX IF NOT EXISTS ix_vendas_codnfc ON vendas (codnfc) WHERE codnfc IS NOT NULL;
