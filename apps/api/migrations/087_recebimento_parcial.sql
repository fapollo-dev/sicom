-- RECEBIMENTO PARCIAL 1:N (Wave 4, corte-1) — um Pedido de Compra recebido em VÁRIAS NFs de entrada.
--
-- O corte-1 do RECEBIMENTO ligou a NF ao pedido 1:1 (061: UNIQUE parcial ux_nf_codpedcomp → 1 NF por pedido).
-- O legado é 1:N (a query de saldo em udmNF.dfm:17495 soma NF_PROD de TODAS as NFs do mesmo CODPEDCOMP): o
-- fornecedor entrega o pedido em remessas, cada uma uma NF. Aqui DESTRAVAMOS o 1:N: dropamos o UNIQUE e o
-- saldo por item passa a ser COMPUTADO (qtd pedida − Σ qtd recebida nas NFs vinculadas). Correlação item-NF ↔
-- item-pedido POR PRODUTO (NF_PROD.CODPRODUTO = PEDIDOCOMPRA_I.IDPRODUTO), fiel ao legado (decisão de tenant).
DROP INDEX IF EXISTS ux_nf_codpedcomp;

-- Status do cruzamento NF×pedido (fiel a NF.STATUS_QTD_PEDCOMP / STATUS_PEDCOMP do legado). Preenchidos no
-- recebimento (Total/Parcial) e na Análise Pedido×NF (liberação). Nullable — NF sem vínculo de pedido não os usa.
ALTER TABLE nf ADD COLUMN IF NOT EXISTS status_qtd_pedcomp varchar(10);   -- 'Total' | 'Parcial'
ALTER TABLE nf ADD COLUMN IF NOT EXISTS status_pedcomp varchar(50);       -- liberação: 'LIBERADO SEM/COM DIVERGENCIA' | 'NAO LIBERADO'
ALTER TABLE nf ADD COLUMN IF NOT EXISTS codoperador_liberacao integer;    -- quem liberou a divergência (Análise, corte-2)

COMMENT ON COLUMN nf.status_qtd_pedcomp IS 'Recebimento parcial 1:N: Total (fecha o saldo) | Parcial (acumula). Fiel NF.STATUS_QTD_PEDCOMP.';
COMMENT ON COLUMN nf.status_pedcomp IS 'Análise Pedido×NF (corte-2): status de liberação da divergência. Fiel NF.STATUS_PEDCOMP.';
