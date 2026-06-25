-- 9ª tela: Cadastro de CIDADES (legado CIDADES) — alvo do LOOKUP/FK de Bairros.
-- Chave natural (IDCIDADE = código IBGE). SEM INDR e SEM colunas de auditoria
-- (a tabela real só tem idcidade/iduf/cidade) → audit:false, hard-delete no engine.
CREATE TABLE IF NOT EXISTS cidades (
  idcidade integer PRIMARY KEY,   -- CHAVE NATURAL (IBGE)
  iduf     integer,
  cidade   varchar(200)
);

-- GET_CIDADES real faz LEFT JOIN em UF p/ a sigla; aqui (sem cadastro de UF nesta
-- fatia) projetamos idcidade/iduf/cidade. Divergência documentada.
CREATE OR REPLACE VIEW get_cidades AS
SELECT idcidade, iduf, cidade FROM cidades;

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
