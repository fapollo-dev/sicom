-- PIS/COFINS de RENTABILIDADE por item (Wave 5, resíduo fiscal). Projeta o DÉBITO de saída e (no pedido) o
-- CRÉDITO de entrada — snapshot de margem que o motor de precificação computa (uDMPrecificacaoProd.pas:215/355,
-- udmNF.pas:3821/10362). NÃO é fiscal-de-registro (a apuração/SPED recomputam de rate×base); consumidor = os
-- relatórios de rentabilidade (qtde × (débito − crédito)).
--
-- Golden PINHEIRAO (READ-ONLY, verificado):
--   NF_PROD.DEBITOPISCOFINS       = round((ALIQPISS+ALIQCOFINSS)×VRVENDA/100, 2)  → 82.640/82.695 = 99,93%
--   NF_PROD.CREDITOPISCOFINS      = 0% (no-op do legado — cds field nunca atribuído) → NÃO migrado
--   PEDIDOCOMPRA_I.DEBITOPISCOFINS  = idem via catálogo (produto.idpiscofins), 161.238 itens
--   PEDIDOCOMPRA_I.CREDITOPISCOFINS = round((ALIQ_PIS_ENT+ALIQ_COFINS_ENT)×VRCUSTO/100, 2)  [só CLASSFISCAL='LR']
-- (o ~18% de "erro" no pedido é DRIFT: re-derivar histórico com as alíquotas de HOJE; snapshot vale as de então.)
--
-- Derivação SERVER-AUTHORITATIVE: NF usa as alíquotas do PRÓPRIO item (aliqpiss/aliqcofinss); o pedido resolve do
-- catálogo PISCOFINS via produto.idpiscofins + o regime da empresa (empresas.classfiscal='LR' habilita o crédito).
ALTER TABLE nf_prod        ADD COLUMN IF NOT EXISTS debitopiscofins  numeric(13,2) DEFAULT 0;  -- débito projetado de saída
ALTER TABLE pedidocompra_i ADD COLUMN IF NOT EXISTS debitopiscofins  numeric(13,2) DEFAULT 0;  -- débito projetado de saída
ALTER TABLE pedidocompra_i ADD COLUMN IF NOT EXISTS creditopiscofins numeric(13,2) DEFAULT 0;  -- crédito de entrada (só LR)

COMMENT ON COLUMN nf_prod.debitopiscofins IS 'PIS/COFINS débito projetado de saída = round((ALIQPISS+ALIQCOFINSS)×VRVENDA/100,2). Rentabilidade (fiel NF_PROD.DEBITOPISCOFINS).';
COMMENT ON COLUMN pedidocompra_i.debitopiscofins IS 'PIS/COFINS débito projetado = round((sai)×VRVENDA/100,2) via catálogo. Fiel PEDIDOCOMPRA_I.DEBITOPISCOFINS.';
COMMENT ON COLUMN pedidocompra_i.creditopiscofins IS 'PIS/COFINS crédito de entrada = round((ent)×VRCUSTO/100,2), só CLASSFISCAL=LR. Fiel PEDIDOCOMPRA_I.CREDITOPISCOFINS.';
