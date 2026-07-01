-- FIGURA FISCAL por catálogo (F2c-2 P2) — reconcilia o INDEXADOR_TRIBUTARIO para a chave MULTI-CAMPO
-- real do legado (udmNF.dfm:17593 / udmNF.pas:9987-10162): CODFIGURAFISCAL + TP_CADASTRO + ORIGEM +
-- DESTINO + CODCFOP + (CODBARRA|NCM|CODPARCEIRO|CNPJ_CPF, com OR-null) + desempate por especificidade.
-- Gate por EMPRESAS.FIGURAFISCAL (udmNF.pas:6666-6674): 'D'=NÃO consulta indexador (usa DET_ALIQUOTA
-- por alíquota, o caminho do corte-1); 'O'/'S'=CONSULTAM a figura. O caminho por NCM (resolverIndexador,
-- ST F2b) segue INTACTO — as 6 linhas seed preservam o `ncm`, então o golden STB/T20/ST-7-7 não regride.

CREATE TABLE IF NOT EXISTS figura_fiscal (
  codfigurafiscal  integer PRIMARY KEY,      -- = FIGURA_FISCAL.CODFIGURAFISCAL (legado)
  descfigurafiscal varchar(255) NOT NULL,
  indr             char(1) DEFAULT 'I'
);

-- reestrutura indexador_tributario: ncm deixa de ser PK (a chave real é multi-campo). PRESERVA as linhas
-- seed (elas mantêm o ncm e ganham um PK serial); adiciona as colunas da figura.
ALTER TABLE indexador_tributario DROP CONSTRAINT IF EXISTS indexador_tributario_pkey;
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS codindexadortributario serial PRIMARY KEY;
ALTER TABLE indexador_tributario ALTER COLUMN ncm DROP NOT NULL;
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS codfigurafiscal integer;
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS tp_cadastro char(1);   -- 'F' entrada / 'C' saída
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS origem char(2);
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS destino char(2);
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS codcfop integer;
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS codbarra varchar(30);
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS codparceiro integer;
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS cnpj_cpf varchar(20);
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS operacao char(1);      -- T/R/C/F/S/D/I/N/Y/Z → CST
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS aliquota_fonte_lei_3166 char(1) DEFAULT 'N';
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS aliquota_reduzida_lei_3166 numeric(7,2) DEFAULT 0;
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS considerar_desconto_calc_st char(1) DEFAULT 'N';
ALTER TABLE indexador_tributario ADD COLUMN IF NOT EXISTS indr char(1) DEFAULT 'I';

-- produto aponta a figura fiscal (udmNF.pas:10018 lê produtos.codfigurafiscal).
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS codfigurafiscal integer;

-- catálogo de figura + 1 linha de indexador POR FIGURA (multi-chave, ncm NULL) p/ exercitar o caminho O/S.
-- Figura 1: revenda tributada com ST (operação 'R' → CST 20), SAÍDA interestadual MG→MA, CFOP 6404, MVA 40.
INSERT INTO figura_fiscal (codfigurafiscal, descfigurafiscal) VALUES (1, 'REVENDA TRIBUTADA (TESTE)')
ON CONFLICT (codfigurafiscal) DO NOTHING;
INSERT INTO indexador_tributario
  (codfigurafiscal, tp_cadastro, origem, destino, codcfop, operacao, aliquota_dest, icm_fonte, mva, reducao, redcom, aliquota_fem, tp_figura)
VALUES
  (1, 'C', 'MG', 'MA', 6404, 'R', 18.0, 18.0, 40.0, 100.0, 100.0, 0.0, 'N')
ON CONFLICT DO NOTHING;
