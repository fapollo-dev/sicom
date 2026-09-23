-- 307 — OS VALORES QUE O ITEM DO PEDIDO HERDA (revisão de 23/09/2026, dossiê `uPedidoCompra.md` §22).
--
-- No legado toda inclusão de item passa por `CarregarItens` (uPedidoCompra.pas:7241), que copia do `MULTI_PRECO` da
-- loja logada (view `GET_PRODUTOS_PC`) a composição do custo e a escada de preço, e o modal de preço do item
-- (`uPrecificacaoProdutos`) edita e recalcula esses campos NO ITEM. Nenhum deles existia no destino: a carga os
-- perdia (57.696 itens de 2025-26, 85-99% preenchidos). Escalas da produção: NUMBER(13,2); o custo anterior (12,4).
ALTER TABLE pedidocompra_i
  ADD COLUMN IF NOT EXISTS pisconfis        numeric(13,2),  -- PIS/COFINS da empresa (EMPRESAS.PISCONFIS)
  ADD COLUMN IF NOT EXISTS icme             numeric(13,2),  -- % ICMS de entrada
  ADD COLUMN IF NOT EXISTS creditoicm       numeric(13,2),  -- R$ crédito de ICMS
  ADD COLUMN IF NOT EXISTS icm_efetivo      numeric(13,2),  -- % ICMS efetivo de saída
  ADD COLUMN IF NOT EXISTS debitoicm        numeric(13,2),
  ADD COLUMN IF NOT EXISTS lucrobrutov      numeric(13,2),
  ADD COLUMN IF NOT EXISTS lucrobrutop      numeric(13,2),
  ADD COLUMN IF NOT EXISTS despopv          numeric(13,2),  -- R$ despesa operacional
  ADD COLUMN IF NOT EXISTS lucroliqv        numeric(13,2),
  ADD COLUMN IF NOT EXISTS lucroliqp        numeric(13,2),
  ADD COLUMN IF NOT EXISTS imprend          numeric(13,2),  -- R$ IR sobre o lucro
  ADD COLUMN IF NOT EXISTS contsocial       numeric(13,2),  -- R$ CSLL sobre o lucro
  ADD COLUMN IF NOT EXISTS ipi              numeric(13,2),  -- % IPI
  ADD COLUMN IF NOT EXISTS frete            numeric(13,2),  -- % frete
  ADD COLUMN IF NOT EXISTS seguro           numeric(13,2),  -- % seguro
  ADD COLUMN IF NOT EXISTS despacessorio    numeric(13,2),  -- R$ despesa acessória
  ADD COLUMN IF NOT EXISTS icmst            numeric(13,2),  -- R$ ICMS-ST
  ADD COLUMN IF NOT EXISTS fcp_saida        numeric(13,2),  -- % FCP de saída
  ADD COLUMN IF NOT EXISTS vlrembalagemb    numeric(13,2),  -- embalagem BRUTA (antes do desconto)
  ADD COLUMN IF NOT EXISTS vrcustorep       numeric(13,2),  -- custo de reposição
  ADD COLUMN IF NOT EXISTS vrcustocsi       numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrcusto_anterior numeric(12,4);  -- o custo herdado, antes da negociação (= custo em 81%)

-- o fator de embalagem DO PEDIDO: a view de busca do pedido usa `FATOR_PEDIDOCOMPRA` e só cai no `FATORCX` quando
-- ele é zero/nulo (GET_PRODUTOS_PC). 13.840 produtos o têm; 2.669 diferentes do FATORCX.
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS fator_pedidocompra numeric(13,3);

-- a AUDITORIA da liberação do limite de compra (binário novo; 596 pedidos, o operador = OPERADOR_ULT_LIB_VALOR_MAX
-- em 595): quem liberou, quando, e se foi com senha.
ALTER TABLE pedidocompra
  ADD COLUMN IF NOT EXISTS usultalteracao_novo_limite   integer,
  ADD COLUMN IF NOT EXISTS dtultimalteracao_novo_limite timestamptz,
  ADD COLUMN IF NOT EXISTS senha_novo_limite            char(1);

-- o PIS/COFINS da EMPRESA que o item herda (`PISCONFIS := EmpresaPISCONFIS`, uPedidoCompra.pas:7322): 9,3 nas quatro
-- lojas do Lucro Real. Não existia no destino.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS pisconfis numeric(13,2);
