-- 068 — PEDIDO DE COMPRA: precificação do ITEM (PEDIDOCOMPRA_I). Aplica o motor completo (custo líquido +
-- markup→venda + margem líquida + PMZ) ao item do pedido — "o comprador forma o preço" (uPedidoCompra.pas +
-- uPrecificacaoProdutos.pas via TMargemPreco). Recon Oracle: no legado estes campos são MUITO populados
-- (VRVENDA 96,9% / MARKUP 81,9% / VRCUSTOLIQUIDO·VRVENDASUG·PMZ 42,1%), mas são SNAPSHOT de uma sessão
-- interativa (markup manual + edições) — NÃO reproduzíveis por fórmula (batem 0,4%). Aqui ARMAZENAMOS o
-- resultado do motor (reuso de /precificacao/produto); é a analítica do item.
--
-- FRONTEIRA (adiada, com procedência): a PROPAGAÇÃO ao MULTI_PRECO ("UPDATE MULTI_PRECO SET VRVENDA",
-- uPedidoCompra.pas:3517) é um EFEITO DE ESCRITA no catálogo (com promoção acumulativa + produtos-filho +
-- multi-loja) → mantido FORA (o pedido segue "sem efeitos"; o FATO de catálogo é um corte próprio).

-- Escalas fiéis ao dicionário Oracle de PEDIDOCOMPRA_I: MARKUP/VRVENDASUG/PMZ/VRCUSTOLIQUIDO/MARGEML2/
-- MARGEML2V = NUMBER(13,2); VRVENDA = NUMBER(12,4). Nomes fiéis: MARGEML2 (não 'margeml') + MARGEML2V (valor).
ALTER TABLE pedidocompra_i ADD COLUMN IF NOT EXISTS vrcustoliquido numeric(13,2); -- custo líquido (base do preço)
ALTER TABLE pedidocompra_i ADD COLUMN IF NOT EXISTS markup         numeric(13,2); -- % markup (input/derivado)
ALTER TABLE pedidocompra_i ADD COLUMN IF NOT EXISTS vrvenda        numeric(12,4); -- preço de venda PRATICADO (comprador; ≠ sugerido)
ALTER TABLE pedidocompra_i ADD COLUMN IF NOT EXISTS vrvendasug     numeric(13,2); -- venda SUGERIDA pelo motor (DbtVendaSugestao)
ALTER TABLE pedidocompra_i ADD COLUMN IF NOT EXISTS margeml2       numeric(13,2); -- margem líquida L2 (%)
ALTER TABLE pedidocompra_i ADD COLUMN IF NOT EXISTS margeml2v      numeric(13,2); -- margem líquida L2 (valor = lucro líquido R$)
ALTER TABLE pedidocompra_i ADD COLUMN IF NOT EXISTS pmz            numeric(13,2); -- preço mínimo (ponto de zero)
