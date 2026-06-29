-- PRODUTO Fase 4b: blocos NUTRICIONAL (rotulagem) e LOGÍSTICA (dimensões/paletização) —
-- colunas do MASTER (PRODUTOS), armazenamento puro (sem cálculo/derivação no legado, salvo o
-- formato '00.0' do gordura-trans). Doc: dossiers/retaguarda/UCadProduto.md §nutricional/logística.
-- Os VD_* (% Valores Diários) são DIGITADOS/armazenados (não calculados). Tipos Oracle→PG.

-- ===== Nutricional =====
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS valorenergetico      numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS carboidrato          numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS proteina             numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS gorduratotal         numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS gordurasaturada      numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS gorduratrans         numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS fibra                numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS sodio                numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS acucares_totais      numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS acucares_adicionados numeric(13,2);
-- % Valores Diários (digitados)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS vd_valorenergetico   numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS vd_carboidrato       numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS vd_proteina          numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS vd_gorduratotal      numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS vd_gordurasaturada   numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS vd_gorduratrans      numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS vd_fibra             numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS vd_sodio             numeric(13,2);
-- Porção / rotulagem
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS unporcao             integer;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS qtde_porcao          numeric(13,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS desc_porcao          varchar(35);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS acucar_adcionado     char(1);  -- flag rotulagem (Lei 75/2020)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS gordura_saturada     char(1);  -- flag rotulagem
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS altoem_sodio         char(1);  -- flag rotulagem
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS expdadosnutricionais char(1);  -- exibe dados nutricionais
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS codinfanutri         integer;

-- ===== Logística (dimensões PRODUTO/CAIXA/PALLET + paletização) =====
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS comprimento_produto  numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS comprimento_caixa    numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS comprimento_pallet   numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS largura_produto      numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS largura_caixa        numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS largura_pallet       numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS altura_produto       numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS altura_caixa         numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS altura_pallet        numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pesoliq_produto      numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pesoliq_caixa        numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pesoliq_pallet       numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pesobruto_produto    numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pesobruto_caixa      numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pesobruto_pallet     numeric(13,3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pallet_caixas_por_camada    integer;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pallet_camadas_por_pallet   integer;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pallet_caixas_por_pallet    integer;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pallet_empilhamento         integer;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pallet_produtos_por_caixa   integer;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pallet_produtos_por_pallet  integer;  -- (legado: PALLET_PRUDUTOS_..., typo corrigido)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS fatorcx_prod         numeric(13,3);

-- Seed nutricional demonstrativo no produto 1 (porção 200 KCAL etc.).
UPDATE produtos SET
  valorenergetico = 387.00, carboidrato = 99.50, proteina = 0.00, gorduratotal = 0.00,
  sodio = 1.00, qtde_porcao = 5.00, desc_porcao = '1 colher de sopa (5g)',
  pesoliq_produto = 1.000, pesobruto_produto = 1.050
WHERE idproduto = 1;
