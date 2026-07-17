-- PIS/COFINS — VALOR por item (Wave 5, resíduo fiscal). O nf_prod só tinha as ALÍQUOTAS (aliqpise/aliqcofinse);
-- o VALOR do crédito de PIS/COFINS da ENTRADA (compra) ficava adiado ("valor real no SPED", uNF.md:225/279).
--
-- Golden (Oracle NF_PROD): o legado persiste o crédito da ENTRADA em VRPISE/VRCOFINSE = BCPISCOFINSE × alíquota
-- (conferido: 138,24 × 1,65% = 2,28; × 7,6% = 10,51). VRPIS (débito de saída) é 100% NULL/0 no golden (66.877
-- entradas com VRPISE, 0 com VRPIS) → a saída não guarda valor por item (apura no SPED). Aqui migramos o crédito
-- da entrada: a fonte é o XML do fornecedor (vBC/vPIS/vCOFINS dos grupos PIS/COFINS), persistido VERBATIM como o
-- ICMS/ST — o XML é a verdade legal.
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS bcpiscofinse numeric(13,2) DEFAULT 0;  -- base do PIS/COFINS (entrada)
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vrpise       numeric(13,2) DEFAULT 0;  -- valor do PIS (crédito entrada)
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS vrcofinse    numeric(13,2) DEFAULT 0;  -- valor do COFINS (crédito entrada)

COMMENT ON COLUMN nf_prod.vrpise IS 'Valor do crédito de PIS na entrada = base × aliqpise (XML verbatim no import). Fiel NF_PROD.VRPISE.';
COMMENT ON COLUMN nf_prod.vrcofinse IS 'Valor do crédito de COFINS na entrada = base × aliqcofinse (XML verbatim no import). Fiel NF_PROD.VRCOFINSE.';
