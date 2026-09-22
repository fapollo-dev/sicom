-- 289 — DEVOLUÇÃO DE COMPRA e EMPRESAS: o que faltava, agora por REGRA e não por volume.
-- Quarto e último grande achado do sentido origem → destino, depois das migs 286 (nf), 287 (nf_prod) e
-- 288 (vendas). Contagens no Oracle de produção (só leitura), 22/09/2026.
--
-- ── ⚠️ 1. O ITEM DA DEVOLUÇÃO DE COMPRA NÃO TINHA TRIBUTO NENHUM ─────────────────────────────────────
-- A mig 279 mapeou `PEDIDO_DEVOLUCAO_COMPRA_ITENS` e trouxe 15 colunas de um leiaute de 67. O que ficou de
-- fora foi **a carga tributária inteira do item**: ICMS, ICMS-ST, PIS, COFINS, FCP e os pares `_nota`.
--
--   valor_venda            6.095 itens   R$ 67.146,02      vrcustorep     6.133   R$ 47.837,02
--   icms_valor             2.733         R$ 19.028,34      vrcofinse      2.171   R$  6.653,52
--   icms_st_valor          2.064         R$  5.444,18      vrpise         2.171   R$  1.466,16
--   desconto_nota            457         R$ 10.276,94      desconto         381   R$  1.695,59
--   vrcofinse_nota         2.171         R$ 21.095,66      vrpise_nota    2.171   R$  4.667,36
--   FCP-ST e FCP-ST retido (valor e alíquota, com e sem `_nota`)      ~R$  2.365,00
--
-- Os valores são pequenos porque a devolução de compra é pouca (6.126 itens), mas **é documento fiscal**:
-- uma devolução sem o ICMS que estava sendo devolvido não fecha com a nota de origem, e é exatamente isso
-- que a fiscalização confronta. As alíquotas e a CST vêm junto porque sem elas o valor não se explica.
--
-- Note o par `_nota`: é o mesmo desenho de conferência do `nf_prod` e do `nf_ibscbs` — o que veio na nota
-- do fornecedor ao lado do que a devolução apurou.
--
-- ── ⚠️ 2. `EMPRESAS` PERDIA 15 PARÂMETROS, E UM DELES É DA REFORMA ───────────────────────────────────
-- São 5 empresas, então o volume é irrelevante — o peso está em o que cada coluna DECIDE:
--
--   codplc_juros_pagos · codplc_juros_recebidos · codplc_descontos_concedidos ·
--   codplc_descontos_recebidos · codplc_acrescimos_pagos · codplc_acrescimos_recebidos ·
--   codplc_taxas_cartao · codplc_taxa_cartao_paga · codplc_trocosolidario
--       → as **contas do plano de contas** para onde vão juros, descontos, acréscimos, taxa de cartão e
--         troco solidário. Sem elas a integração contábil não sabe onde lançar, e o razão sai incompleto.
--   codfornecedor_trocosolidario · codparceiro · codterminal · codoperador_autoatendimento · idpgto
--       → os apontamentos de operação da loja.
--   **valor_cbs** → a alíquota de CBS da empresa. Está preenchida nas 5 e é parâmetro da reforma: sem ela,
--     a empresa não tem a própria alíquota e o cálculo cai no parâmetro geral (mig 007).
--
-- ── O que fica de fora, com prova ────────────────────────────────────────────────────────────────────
-- `preen_ncm`, `sincroniza_preco_nf` e `valor_perc_multa`: flags de comportamento de tela sem uso medido
-- no cliente. Declaradas em `ORIGEM_DECLARADA` no conferidor.

-- ── 1. a tributação do item da devolução de compra ───────────────────────────────────────────────────
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS cst                varchar(3);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS valor_venda        numeric(15,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS vrcustorep         numeric(15,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS desconto           numeric(15,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS desconto_nota      numeric(15,4);
-- ICMS e ICMS-ST (o que a devolução apurou)
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS icms_aliquota      numeric(9,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS icms_valor         numeric(15,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS icms_st_aliquota   numeric(9,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS icms_st_valor      numeric(15,4);
-- PIS e COFINS: o apurado e o par `_nota` (o que veio do fornecedor)
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS aliqpise           numeric(9,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS vrpise             numeric(15,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS vrpise_nota        numeric(15,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS aliqcofinse        numeric(9,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS vrcofinse          numeric(15,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS vrcofinse_nota     numeric(15,4);
-- FCP-ST, e o retido, com e sem o par da nota
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS fcp_aliquota_st        numeric(9,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS fcp_valor_st           numeric(15,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS fcp_aliquota_st_nota   numeric(9,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS fcp_valor_st_nota      numeric(15,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS fcp_aliquota_st_ret    numeric(9,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS fcp_valor_st_ret       numeric(15,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS fcp_aliquota_st_ret_nota numeric(9,4);
ALTER TABLE pedido_devolucao_compra_i ADD COLUMN IF NOT EXISTS fcp_valor_st_ret_nota    numeric(15,4);

-- ── 2. os parâmetros da empresa ──────────────────────────────────────────────────────────────────────
-- as contas do plano de contas: sem elas a integração contábil não sabe onde lançar
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codplc_juros_pagos          integer;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codplc_juros_recebidos      integer;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codplc_descontos_concedidos integer;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codplc_descontos_recebidos  integer;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codplc_acrescimos_pagos     integer;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codplc_acrescimos_recebidos integer;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codplc_taxas_cartao         integer;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codplc_taxa_cartao_paga     integer;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codplc_trocosolidario       integer;
-- apontamentos de operação
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codfornecedor_trocosolidario integer;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codparceiro                  integer;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codterminal                  integer;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codoperador_autoatendimento  integer;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS idpgto                       integer;
-- ⚠️ a alíquota de CBS DA EMPRESA: sem ela o cálculo cai no parâmetro geral da mig 007
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS valor_cbs numeric(7,4);
COMMENT ON COLUMN empresas.valor_cbs IS
  'alíquota de CBS da empresa (preenchida nas 5 do cliente) — parâmetro próprio, acima do geral da mig 007';
