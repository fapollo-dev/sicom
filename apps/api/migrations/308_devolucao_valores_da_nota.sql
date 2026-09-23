-- 308 — DEVOLUÇÃO DE COMPRA: os valores DA NOTA do fornecedor (Achado 18 da FILA, 23/09/2026).
--
-- O item da devolução do legado é calculado dos valores DESTACADOS na nota de entrada — `NF_PROD.ICMS_NOTA_BC`,
-- `ICMS_NOTA_VALOR`, `IPI_NOTA`, `FRETE_NOTA`, `SEGURO_NOTA`, `DESCONTO_NOTA`, `OUTRAS_DESPESAS_NOTA`, CST e alíquota
-- da nota, `TOTAL_PRODUTO_NOTA` —, proporcionais à quantidade devolvida (uCadPedidoDevolucaoCompras.pas:1021-1120), e a
-- NF de devolução copia esses valores (uNF.pas:11994 `ImportaPedidoDevolucaoCompra`). O Apollo rateava o imposto
-- ESCRITURADO (`VRBASECALCULO`/`VRICM`): em 2025-26, 37.881 itens de entrada têm base destacada e base escriturada
-- zero — a devolução sairia sem ICMS. Em 2025 o legado devolveu R$ 3.943 de ICMS; pelo escriturado seriam R$ 520.
ALTER TABLE pedido_devolucao_compra_i
  ADD COLUMN IF NOT EXISTS icms_bc              numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_bc_nota         numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_nota            numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_reducao_bc      numeric(13,4),
  ADD COLUMN IF NOT EXISTS icms_st_bc           numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_st_bc_nota      numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_st_nota         numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_st_reducao_bc   numeric(13,4),
  ADD COLUMN IF NOT EXISTS ipi                  numeric(13,2),   -- R$ (o % da NF é recalculado sobre o total)
  ADD COLUMN IF NOT EXISTS ipi_nota             numeric(13,2),
  ADD COLUMN IF NOT EXISTS frete                numeric(13,2),
  ADD COLUMN IF NOT EXISTS frete_nota           numeric(13,2),
  ADD COLUMN IF NOT EXISTS seguro               numeric(13,2),
  ADD COLUMN IF NOT EXISTS seguro_nota          numeric(13,2),
  ADD COLUMN IF NOT EXISTS outras_despesas      numeric(13,2),
  ADD COLUMN IF NOT EXISTS outras_despesas_nota numeric(13,2),
  ADD COLUMN IF NOT EXISTS bcpiscofinse         numeric(10,2),
  ADD COLUMN IF NOT EXISTS bcpiscofinse_nota    numeric(10,2),
  ADD COLUMN IF NOT EXISTS arredonda            char(1),         -- arredonda ('S') ou trunca o total do item
  ADD COLUMN IF NOT EXISTS descricao_produto    varchar(800),
  ADD COLUMN IF NOT EXISTS unidade_nota         varchar(8),
  ADD COLUMN IF NOT EXISTS cod_troca            integer,
  ADD COLUMN IF NOT EXISTS cod_troca_itens      integer,
  ADD COLUMN IF NOT EXISTS cod_troca_itens_qtde integer,
  ADD COLUMN IF NOT EXISTS estoqueretiradatroca varchar(12),
  -- a base do FCP-ST (a alíquota e o valor já existiam)
  ADD COLUMN IF NOT EXISTS fcp_bc_st            numeric(13,2),
  ADD COLUMN IF NOT EXISTS fcp_bc_st_nota       numeric(13,2),
  ADD COLUMN IF NOT EXISTS fcp_bc_st_ret        numeric(13,2),
  ADD COLUMN IF NOT EXISTS fcp_bc_st_ret_nota   numeric(13,2);

-- o IPI DEVOLVIDO da NF de devolução (`IPI_DEVOLUCAO_EM_TRIBUTOS_DEVOLVIDOS='S'`, o do cliente): o % sobre o total do
-- item e o % devolvido do IPI da nota; e o total no cabeçalho, que ENTRA no total da nota (udmNF.pas:5557)
ALTER TABLE nf_prod
  ADD COLUMN IF NOT EXISTS ipi_devolucao            numeric(13,4),
  ADD COLUMN IF NOT EXISTS ipi_devolucao_perc_devol numeric(13,4),
  ADD COLUMN IF NOT EXISTS informacoes_adicionais   varchar(500);
ALTER TABLE nf ADD COLUMN IF NOT EXISTS totalipi_devolucao numeric(13,2);
