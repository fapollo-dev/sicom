-- 212 — PRODUTO PAI × FILHO: a coluna que decide se a diferença é VALOR ou PERCENTUAL.
--
-- Quem chama: "Aplicar valores" da Precificação de NF (`InsereAjustePreco:1019` →
-- `TAtualizacaoPrecoFilho.GeraLoteFilho`). Precificar o pai enfileira lote **para os filhos também** — e o
-- filho pode nem estar na nota. É a parte da tela que mexe em preço de produto que o operador não vê.
--
-- ── A coluna que faltava ────────────────────────────────────────────────────────────────────────────────
-- Das quatro colunas do mecanismo, três já vinham na carga (`IDPRODUTO_PAI`, `FATOR_FILHO`,
-- `DIF_PRECO_PROD_FILHO_X_PAI`) e a quarta não: `TPDIF_PRECO_PROD_FILHO_X_PAI`, que diz se a diferença é
-- 'D' (valor absoluto, somado) ou qualquer outra coisa (percentual sobre o preço do pai). Sem ela o filho
-- sairia com o preço errado — oitavo achado da mesma família.
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tpdif_preco_prod_filho_x_pai char(1);

CREATE INDEX IF NOT EXISTS ix_produtos_idproduto_pai ON produtos (idproduto_pai) WHERE idproduto_pai IS NOT NULL;

-- ── ⚠️ DIVERGÊNCIA fonte × dado, resolvida pelo DADO ────────────────────────────────────────────────────
-- O fonte que temos é de **14/05/2020**; a produção roda um binário mais novo. Nesta regra os dois discordam,
-- e a divergência é verificável:
--
--   · o fonte filtra os filhos por `COALESCE(DIF,0) <> 0 AND TPDIF IS NOT NULL` (`FILTRO_DIF_PRECO`);
--   · em produção (medido em 14/09/2026) **200 produtos têm pai e ZERO têm DIF ou TPDIF preenchidos** —
--     pelo fonte, nenhum lote de filho poderia existir;
--   · e existem **676 lotes** com a OBS de filho, **670 deles com pai**, o último em **10/09/2026** — o
--     mecanismo está vivo e rodou quatro dias antes desta medição.
--
-- O caso concreto que fecha a conta: o produto 795537 (CHUCHU PICADO KG), filho de 5890 (CHUCHU KG), sem DIF
-- e sem TPDIF, recebeu lote a **4,49** — exatamente o preço do pai. É o que a fórmula do fonte devolve quando
-- a diferença é nula (`venda_pai + venda_pai × 0/100`). Ou seja: **a fórmula do fonte está certa, o filtro é
-- que não se aplica mais**. Implementamos a fórmula do fonte SEM o filtro de DIF — que é o comportamento que
-- o cliente tem hoje — e o smoke prova os três casos (sem diferença, diferença em valor, em percentual).
--
-- ⛔ `FATOR_FILHO` NÃO multiplica nada: `CalculaPrecoFilho:192` começa com `pFatorFilho := 1;` e o `iif`
-- original está comentado no fonte. O campo é lido, é passado como parâmetro e é **descartado na primeira
-- linha**. O dado confirma que ninguém percebeu: os 200 produtos com pai têm `FATOR_FILHO = 1`. Copiado como
-- está — ligar o fator agora mudaria preço em produção sem ninguém ter pedido.
