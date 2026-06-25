-- 8ª tela: Cadastro de NCM — completa o PALETTE (data + memo) e prova a CHAVE NATURAL.
-- NCM é a classificação fiscal (liga-se ao trabalho de DET_ALIQUOTA/reforma). PK = CODIGO
-- é DIGITADA pelo usuário (não sequence). Sem INDR → hard-delete. CLOB→text, DATE→date.
CREATE TABLE IF NOT EXISTS ncm (
  codigo           integer PRIMARY KEY,    -- CHAVE NATURAL (código NCM), não gerada
  ncmsh            varchar(20),            -- código formatado (texto)
  descricao        text,                   -- CLOB no legado → memo (TextArea)
  ipi              varchar(3),
  vigencia_inicio  date,                   -- DateField
  vigencia_fim     date,                   -- DateField
  observacao       text,                   -- CLOB no legado → memo (TextArea)
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz
);

-- View de pesquisa fiel ao GET_NCM real: projeta codigo, descricao (cast p/ varchar),
-- ncmsh e as duas vigências (TRUNC → date). NCM não tem INDR (hard-delete).
CREATE OR REPLACE VIEW get_ncm AS
SELECT
  codigo,
  CAST(descricao AS varchar(500)) AS descricao,
  ncmsh,
  vigencia_inicio,
  vigencia_fim
FROM ncm;

-- Seed: NCMs reais (com vigência) — amostra do legado homolog.
INSERT INTO ncm (codigo, ncmsh, descricao, ipi, vigencia_inicio) VALUES
  (1012100, '01012100', 'Cavalos reprodutores de raça pura', 'NT', DATE '2016-01-01'),
  (1012900, '01012900', 'Outros cavalos vivos',              'NT', DATE '2016-01-01'),
  (21032010, '21032010', 'Molho de tomate (ketchup)',         '0',  DATE '2017-01-01');

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADNCM', 'BTNGRAVAR',            7, 1),
  ('FRMCADNCM', 'BTNEXCLUIR',           7, 1),
  ('FRMCADNCM', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADNCM', 'BTNEDITAR',            7, 1);
