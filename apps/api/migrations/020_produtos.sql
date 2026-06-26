-- PRODUTO (hub do ERP) — Fase 1: NÚCLEO fiel. A tela ARMAZENA config (identidade + fiscal
-- + unidade/balança + códigos de barras); NÃO calcula preço/imposto (motor já portado em
-- apps/api/src/modules/precificacao). Preço (MULTI_PRECO) e estoque (ESTOQUE) são por empresa
-- e entram em F2/F3. Doc: docs/04-screen-dossier/dossiers/retaguarda/UCadProduto.md
-- Arquitetura: PRODUTOS (GLOBAL, sem IDEMPRESA) + ALIQUOTA(código)→DET_ALIQUOTA(por UF, já migrado).

-- Lookups de apoio (catálogos).
CREATE SEQUENCE IF NOT EXISTS seq_unidade_codunidade;
CREATE TABLE IF NOT EXISTS unidade (
  codunidade integer PRIMARY KEY DEFAULT nextval('seq_unidade_codunidade'),
  sigla      varchar(6) NOT NULL,
  descricao  varchar(60)
);
ALTER SEQUENCE seq_unidade_codunidade OWNED BY unidade.codunidade;

-- FAMILIAS_PROD: tabela ÚNICA com discriminador TIPO (G=grupo, S=subgrupo, D=departamento,
-- O=seção, R=grupo de preço) — espelha o legado.
CREATE SEQUENCE IF NOT EXISTS seq_familias_prod;
CREATE TABLE IF NOT EXISTS familias_prod (
  codfamilia integer PRIMARY KEY DEFAULT nextval('seq_familias_prod'),
  tipo       char(1) NOT NULL,            -- G/S/D/O/R
  descricao  varchar(60)
);
ALTER SEQUENCE seq_familias_prod OWNED BY familias_prod.codfamilia;

-- ALIQUOTA: catálogo dos códigos fiscais (ex.: T01). O detalhe por UF (ICM/CST) está em
-- DET_ALIQUOTA (já migrado em 007). O produto guarda o CÓDIGO.
CREATE TABLE IF NOT EXISTS aliquota (
  codigo    char(3) PRIMARY KEY,
  descricao varchar(60)
);

-- PRODUTOS (núcleo). PK IDPRODUTO via sequence (app-side no legado). GLOBAL.
CREATE SEQUENCE IF NOT EXISTS seq_produtos_idproduto;
CREATE TABLE IF NOT EXISTS produtos (
  idproduto          integer PRIMARY KEY DEFAULT nextval('seq_produtos_idproduto'),
  codbarra           varchar(14) NOT NULL,
  descricao          varchar(120) NOT NULL,
  descricao_resumida varchar(60),
  descricao_web      varchar(200),
  descricao_balanca  varchar(60),
  codunidade         integer REFERENCES unidade(codunidade),
  unidade            char(2) NOT NULL,                 -- denormalizado (SIGLA)
  codfor             integer NOT NULL REFERENCES parceiros(codparceiro), -- fornecedor (FRN)
  idmarca            integer REFERENCES marcas(idmarca),
  codgrupo           integer,                          -- → familias_prod (TIPO='G') (ref. lógica)
  codsubgrupo        integer,                          -- TIPO='S'
  coddpto            integer,                          -- TIPO='D'
  codsecao           integer,                          -- TIPO='O'
  codgrupopreco      integer,                          -- TIPO='R'
  -- config fiscal (armazenada; cálculo vive em precificacao)
  ncmsh              varchar(10),
  cest               varchar(10),
  cest_obrigatorio   char(1) DEFAULT 'N',
  aliquota           char(3) NOT NULL REFERENCES aliquota(codigo),  -- código → DET_ALIQUOTA por UF
  idpiscofins        integer,                          -- → PISCOFINS (lookup adiado)
  codfigurafiscal    integer,                          -- origem/CFOP (lookup adiado)
  codfcp             integer,                          -- FCP por UF (lookup adiado)
  mva                numeric(13,2),
  origemprod         char(1),                          -- 0-8 (CST origem)
  -- unidade/balança/validade
  balanca            char(1) NOT NULL DEFAULT 'N',
  codbalanca         integer,
  fatorkg            numeric(15,3),
  peso               numeric(15,3),
  fatorcx            integer DEFAULT 1,
  validade           integer,
  controle_validade  char(1) DEFAULT 'S',
  -- controle / auto-relacionamento
  ativo              char(1) DEFAULT 'S',
  ativo_compra       char(1) DEFAULT 'S',
  idproduto_pai      integer,                          -- variação pai/filho (ref. lógica)
  fator_filho        numeric(15,4),
  -- auditoria (carimbada pelo engine)
  usucadastro        integer,
  dtcadastro         timestamptz,
  usultalteracao     integer,
  dtultimalteracao   timestamptz,
  codoperador        integer
);
ALTER SEQUENCE seq_produtos_idproduto OWNED BY produtos.idproduto;

-- Detalhe 1:N — códigos de barras auxiliares / embalagens.
CREATE SEQUENCE IF NOT EXISTS seq_codauxiliar_chaveaux;
CREATE TABLE IF NOT EXISTS codauxiliar (
  chaveaux    integer PRIMARY KEY DEFAULT nextval('seq_codauxiliar_chaveaux'),
  idproduto   integer NOT NULL REFERENCES produtos(idproduto) ON DELETE CASCADE,
  codauxiliar varchar(14),
  codbarra    varchar(14),
  fatoremb    numeric(15,3) DEFAULT 1,
  codunidade  integer,
  operacao    char(1)
);
ALTER SEQUENCE seq_codauxiliar_chaveaux OWNED BY codauxiliar.chaveaux;

-- Views de listagem dos catálogos (lookups da tela via engine).
CREATE OR REPLACE VIEW get_unidade AS
  SELECT codunidade, codunidade AS codigo, sigla, descricao FROM unidade;
CREATE OR REPLACE VIEW get_familias_prod AS
  SELECT codfamilia, codfamilia AS codigo, tipo, descricao FROM familias_prod;
CREATE OR REPLACE VIEW get_aliquota AS
  SELECT codigo, codigo AS aliquota, descricao FROM aliquota;

-- View de pesquisa/listagem: decode + lookups (marca/unidade/grupo/fornecedor).
CREATE OR REPLACE VIEW get_produtos AS
SELECT
  p.idproduto AS codigo,
  p.idproduto,
  p.codbarra,
  p.descricao,
  p.ncmsh,
  p.aliquota,
  p.unidade,
  m.descricao  AS marca,
  g.descricao  AS grupo,
  fo.razao     AS fornecedor,
  p.ativo
FROM produtos p
LEFT JOIN marcas m        ON m.idmarca = p.idmarca
LEFT JOIN familias_prod g ON g.codfamilia = p.codgrupo
LEFT JOIN parceiros fo    ON fo.codparceiro = p.codfor;

-- Seed de catálogos.
INSERT INTO unidade (codunidade, sigla, descricao) VALUES
  (1, 'UN', 'UNIDADE'), (2, 'KG', 'QUILOGRAMA'), (3, 'CX', 'CAIXA'),
  (4, 'PC', 'PACOTE'), (5, 'LT', 'LITRO'), (6, 'DZ', 'DUZIA')
ON CONFLICT (codunidade) DO NOTHING;
SELECT setval('seq_unidade_codunidade', 100, false);

INSERT INTO familias_prod (codfamilia, tipo, descricao) VALUES
  (1, 'G', 'MERCEARIA'), (2, 'G', 'BEBIDAS'),
  (10, 'D', 'ALIMENTOS'), (11, 'D', 'LIMPEZA'),
  (20, 'O', 'SECOS'), (30, 'R', 'TABELA PADRAO')
ON CONFLICT (codfamilia) DO NOTHING;
SELECT setval('seq_familias_prod', 100, false);

-- Códigos de alíquota (o detalhe por UF está em det_aliquota/007).
INSERT INTO aliquota (codigo, descricao) VALUES
  ('T01', 'TRIBUTADO INTEGRAL'),
  ('STB', 'SUBSTITUICAO TRIBUTARIA'),
  ('IST', 'ISENTO'),
  ('NTB', 'NAO TRIBUTADO')
ON CONFLICT (codigo) DO NOTHING;

-- Seed de produtos (codfor=2 é fornecedor FRN no seed de parceiros; idmarca=1 existe).
INSERT INTO produtos (idproduto, codbarra, descricao, descricao_resumida, codunidade, unidade, codfor, idmarca, codgrupo, coddpto, ncmsh, aliquota, balanca, ativo) VALUES
  (1, '7891000100103', 'ACUCAR REFINADO 1KG',     'ACUCAR 1KG',  1, 'UN', 2, 1, 1, 10, '17019900', 'T01', 'N', 'S'),
  (2, '7894900011517', 'REFRIGERANTE COLA 2L',    'REFRI 2L',    1, 'UN', 2, 1, 2, 10, '22021000', 'T01', 'N', 'S'),
  (3, '2000001000005', 'QUEIJO MUSSARELA KG',     'MUSSARELA',   2, 'KG', 2, 1, 1, 10, '04061010', 'T01', 'S', 'S')
ON CONFLICT (idproduto) DO NOTHING;
SELECT setval('seq_produtos_idproduto', 1000, false);

INSERT INTO codauxiliar (idproduto, codauxiliar, codbarra, fatoremb, codunidade) VALUES
  (1, '7891000100103', '7896000000017', 12, 3)  -- caixa com 12
ON CONFLICT DO NOTHING;

-- RBAC: tela de produto + catálogos de apoio (operador 7, empresa 1).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADPRODUTO', 'BTNGRAVAR',            7, 1),
  ('FRMCADPRODUTO', 'BTNEXCLUIR',           7, 1),
  ('FRMCADPRODUTO', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADPRODUTO', 'BTNEDITAR',            7, 1),
  ('FRMCADUNIDADE',  'BTNGRAVAR',  7, 1),
  ('FRMCADUNIDADE',  'BTNEXCLUIR', 7, 1),
  ('FRMCADFAMILIAS', 'BTNGRAVAR',  7, 1),
  ('FRMCADFAMILIAS', 'BTNEXCLUIR', 7, 1),
  ('FRMCADALIQUOTA', 'BTNGRAVAR',  7, 1),
  ('FRMCADALIQUOTA', 'BTNEXCLUIR', 7, 1);
