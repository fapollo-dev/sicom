-- NF F5b-fase4b: PIS/COFINS FIEL — catálogo PISCOFINS (rate POR-PRODUTO) + allow-list PC_CONFIG (entrada)
-- + override NF_PROD.IDPISCOFINS. Substitui o placeholder (totalnf×1,65/7,6 fixo). Golden PINHEIRAO 100%
-- (40962 sit826/827 · 41220 · 40012 rate-reduzida). GetSQLPisCofins (UIntegracaoContabil.pas:527-683).

-- catálogo de PIS/COFINS por produto (rates reais do PINHEIRAO).
CREATE TABLE IF NOT EXISTS piscofins (
  idpiscofins     integer PRIMARY KEY,
  descricao       varchar(80),
  aliq_pis_ent    numeric(13,4) DEFAULT 0,
  aliq_pis_sai    numeric(13,4) DEFAULT 0,
  aliq_cofins_ent numeric(13,4) DEFAULT 0,
  aliq_cofins_sai numeric(13,4) DEFAULT 0,
  cst_pis_ent integer, cst_pis_sai integer, cst_cofins_ent integer, cst_cofins_sai integer
);
INSERT INTO piscofins (idpiscofins, descricao, aliq_pis_ent, aliq_pis_sai, aliq_cofins_ent, aliq_cofins_sai, cst_pis_ent, cst_pis_sai, cst_cofins_ent, cst_cofins_sai) VALUES
  (1,  'CREDITO PRESUMIDO CARNE BOVINA', 0.66,  1.65, 3.04,  7.6, 60, 1, 60, 1),
  (9,  'ISENTO',                         0,     0,    0,     0,   71, 9, 71, 9),
  (10, 'SUBSTITUICAO TRIBUTARIA',        0,     0,    0,     0,   75, 5, 75, 5),
  (11, 'CREDITO PRESUMIDO AVES E SUINOS',0.198, 1.65, 0.912, 7.6, 60, 1, 60, 1),
  (12, 'ALIQUOTA ZERO',                  0,     0,    0,     0,   73, 6, 73, 6),
  (13, 'TRIBUTADOS',                     1.65,  1.65, 7.6,   7.6, 50, 1, 50, 1),
  (14, 'MONOFASICO',                     0,     0,    0,     0,   70, 4, 70, 4)
ON CONFLICT (idpiscofins) DO NOTHING;

-- override por linha (existe no legado; 76% preenchido). NULL → usa produtos.idpiscofins (coalesce).
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS idpiscofins integer;

-- allow-list de CFOP de ENTRADA (PC_CONFIG; só a coluna CFOP importa p/ GetSQLPisCofins).
CREATE TABLE IF NOT EXISTS pc_config (
  cfop           varchar(4) PRIMARY KEY,
  id_basecredito integer
);
INSERT INTO pc_config (cfop, id_basecredito) VALUES
  ('1102',1),('2102',1),('1403',1),('2403',1),('1910',1),('2910',1),
  ('1101',2),('2101',2),('1401',2),('2401',2),('1253',4),('1933',6),
  ('1353',7),('2353',7),('1411',12),('2411',12),('1202',12),('2202',12)
ON CONFLICT (cfop) DO NOTHING;

-- situações PIS/COFINS de SAÍDA dos CFOPs de venda-ST (golden 40962: 5202/5411 → PIS 826 / COFINS 827).
INSERT INTO cfop (codcfop, descricao) VALUES ('5202','VENDA ST'), ('5411','VENDA ST/COMERC') ON CONFLICT (codcfop) DO NOTHING;
UPDATE cfop SET situacao_pis_saidas_nf = 826, situacao_cofins_saidas_nf = 827 WHERE codcfop IN ('5202','5411');
-- IIC das situações 826/827 (mesmas contas do golden 788/789: PIS D235/C154, COFINS D236/C153).
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico) VALUES
  (826,'D','F',235,1),(826,'C','F',154,1),(827,'D','F',236,1),(827,'C','F',153,1)
ON CONFLICT DO NOTHING;
