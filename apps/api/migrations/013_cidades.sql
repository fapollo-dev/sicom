-- 9ª tela: Cadastro de CIDADES (legado CIDADES) — alvo do LOOKUP/FK de Bairros.
-- Chave natural (IDCIDADE = código IBGE). SEM INDR e SEM colunas de auditoria
-- (a tabela real só tem idcidade/iduf/cidade) → audit:false, hard-delete no engine.
CREATE TABLE IF NOT EXISTS cidades (
  idcidade integer PRIMARY KEY,   -- CHAVE NATURAL (IBGE)
  iduf     integer,
  cidade   varchar(200)
);

-- GET_CIDADES real faz LEFT JOIN em UF p/ a sigla; aqui (sem cadastro de UF nesta
-- fatia) decodificamos IDUF→SIGLA (códigos IBGE) na própria view, espelhando o
-- LEFT JOIN em UF do GET_CIDADES real — o lookup mostra a sigla, não o id cru.
CREATE OR REPLACE VIEW get_cidades AS
SELECT
  idcidade,
  iduf,
  cidade,
  CASE iduf
    WHEN 11 THEN 'RO' WHEN 12 THEN 'AC' WHEN 13 THEN 'AM' WHEN 14 THEN 'RR'
    WHEN 15 THEN 'PA' WHEN 16 THEN 'AP' WHEN 17 THEN 'TO' WHEN 21 THEN 'MA'
    WHEN 22 THEN 'PI' WHEN 23 THEN 'CE' WHEN 24 THEN 'RN' WHEN 25 THEN 'PB'
    WHEN 26 THEN 'PE' WHEN 27 THEN 'AL' WHEN 28 THEN 'SE' WHEN 29 THEN 'BA'
    WHEN 31 THEN 'MG' WHEN 32 THEN 'ES' WHEN 33 THEN 'RJ' WHEN 35 THEN 'SP'
    WHEN 41 THEN 'PR' WHEN 42 THEN 'SC' WHEN 43 THEN 'RS' WHEN 50 THEN 'MS'
    WHEN 51 THEN 'MT' WHEN 52 THEN 'GO' WHEN 53 THEN 'DF' ELSE NULL
  END AS uf
FROM cidades;

-- Seed: cidades reais (código IBGE).
INSERT INTO cidades (idcidade, iduf, cidade) VALUES
  (3550308, 35, 'SAO PAULO'),
  (3509502, 35, 'CAMPINAS'),
  (3304557, 33, 'RIO DE JANEIRO'),
  (3106200, 31, 'BELO HORIZONTE');

-- FK real Bairro→Cidades (prova integridade referencial pelo caminho do engine).
-- idcidade nulo é permitido (bairros do seed não têm cidade).
ALTER TABLE bairro
  ADD CONSTRAINT fk_bairro_cidade FOREIGN KEY (idcidade) REFERENCES cidades(idcidade);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADCIDADES', 'BTNGRAVAR',            7, 1),
  ('FRMCADCIDADES', 'BTNEXCLUIR',           7, 1),
  ('FRMCADCIDADES', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADCIDADES', 'BTNEDITAR',            7, 1);
