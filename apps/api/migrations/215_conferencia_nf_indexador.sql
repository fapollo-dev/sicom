-- 215 — CONFERÊNCIA DE NF × INDEXADOR TRIBUTÁRIO (`FRMCONFERENCIANFINDEXADOR`). 165 acessos, 4 operadores.
--
-- A tela põe lado a lado, item a item, **o que o sistema calculou** e **o que veio na nota** — e é onde se
-- descobre que o fornecedor mandou um CST diferente do cadastrado, ou um total que não fecha.
--
-- ── ⚠️ O MAIOR ACHADO DE CARGA ATÉ AGORA: 19 colunas, e são justamente o lado do XML ────────────────────
-- Sem elas a tela não existe: metade da comparação simplesmente não chega ao destino. E não são colunas
-- mortas — medido na produção em 14/09/2026, sobre 496.498 itens de nota:
--
--   TOTAL_PRODUTO_NOTA  369.812 preenchidos      CFOP_ORIGINAL      387.452
--   QTD_NOTA            369.815                  CST_NOTA           373.912
--   ICMS_ST_ALIQ_NOTA   107.897                  MVA_AJUSTADO        88.883
--   OUTRAS_DESPESAS_NOTA 47.089                  IPI_NOTA            33.515
--   ICMS_RED_BC_NOTA     31.995                  DESCONTO_NOTA        8.925
--
-- E o que a tela encontra hoje, se rodasse: **52.065 itens com CST diferente do que veio na nota** e 883 com
-- o valor total do produto divergente. É conferência fiscal com achado real, não relatório decorativo.
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS total_produto_nota   numeric(13,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS qtd_nota             numeric(13,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS ipi_nota             numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS ipi_devolucao_nota   numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS seguro_nota          numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS frete_nota           numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS desconto_nota        numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS outras_despesas_nota numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS icms_aliq_nota       numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS icms_nota_valor      numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS icms_nota_bc         numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS icms_red_bc_nota     numeric(13,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS icms_st_aliq_nota    numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS icms_st_bc_nota      numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS icms_st_nota         numeric(13,2);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS icms_st_red_bc_nota  numeric(13,4);
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS cst_nota             integer;
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS cfop_original        integer;
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS mva_ajustado         numeric(13,4);

-- ⛔ `NF.NFE_XML` NÃO entra. São **716,1 MB** em 46.352 notas (medido em 14/09/2026) — mais peso que toda a
-- recarga total das 77 tabelas do plano de virada, e a conferência não depende dele: ela compara as colunas
-- que o importador já extraiu do XML. O XML serve para o operador abrir o documento original, e isso pode
-- vir depois, sob demanda, sem carregar 716 MB na janela da virada.

-- RBAC: gate de tela; o legado não tem permissão por botão nesta tela.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMCONFERENCIANFINDEXADOR', 'FRMCONFERENCIANFINDEXADOR', 7, 1)
ON CONFLICT DO NOTHING;

-- ── `NF.DTIMPORTACAO` — a coluna "Dt. Importação" da tela ───────────────────────────────────────────────
-- A conferência mostra QUANDO a nota foi importada, ao lado da emissão: é assim que o conferente separa "o
-- fornecedor mandou errado" de "a importação é antiga e o cadastro mudou depois". Existe no legado
-- (`TIMESTAMP(6)`) e não vinha na carga.
ALTER TABLE nf ADD COLUMN IF NOT EXISTS dtimportacao timestamp;
