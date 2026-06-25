-- FISCAL ST/MVA: REUSA o INDEXADOR_TRIBUTARIO do legado (MVA por NCM) e a regra
-- clássica de ICMS-ST. DESENVOLVE: sob a Reforma a ST é EXTINTA (IBS/CBS não-cumulativos).
CREATE TABLE IF NOT EXISTS indexador_tributario (
  ncm         varchar(10) PRIMARY KEY,
  aliquota_dest numeric(7,2) NOT NULL, -- alíquota interna do destino (%)
  icm_fonte   numeric(7,2) NOT NULL,   -- ICMS próprio da origem (%)
  mva         numeric(7,2) NOT NULL,   -- Margem de Valor Agregado (%)
  reducao     numeric(7,2) NOT NULL DEFAULT 100, -- % da base (100 = sem redução)
  st_externo  char(1) DEFAULT 'N'
);

-- Seed REAL extraído de pinheirao.INDEXADOR_TRIBUTARIO (produtos com MVA/ST).
INSERT INTO indexador_tributario (ncm, aliquota_dest, icm_fonte, mva, reducao, st_externo) VALUES
 ('21032010', 18.0, 12.0, 50.0, 100.0, 'N'),  -- molhos/condimentos
 ('19021100', 18.0, 18.0, 35.0, 38.89, 'N'),  -- massas (com redução de base)
 ('04061010', 18.0, 18.0, 45.0, 38.89, 'N'),  -- queijos
 ('02031900', 18.0, 18.0, 15.0, 38.89, 'N'),  -- carne suína
 ('18069000', 18.0, 18.0, 25.0, 100.0, 'N');  -- chocolates
