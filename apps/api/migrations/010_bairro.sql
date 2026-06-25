-- Cadastro de Bairros — tabela REAL `BAIRRO` do schema legado (Oracle homolog: IDBAIRRO,
-- DESCRICAO VARCHAR2(100), ATIVO, REGIAO VARCHAR2(2), INDR..., IDCIDADE). IMPORTANTE: a
-- tabela existe (e está VAZIA), mas NÃO há tela Delphi de Bairros no legado (nem view
-- GET_BAIRRO nos fontes) — esta é uma tela NOVA de manutenção sobre a tabela real, e
-- serve de exercício do pilar <CadMaster>: texto + COMBO (REGIAO) + flag (ATIVO),
-- soft-delete (INDR), Pesquisa, navegação, histórico.
-- Tipos Oracle→PG: NUMBER→integer, VARCHAR2→varchar, CHAR(1)→char(1), TIMESTAMP(6)→timestamptz.
CREATE SEQUENCE IF NOT EXISTS seq_bairro_idbairro;

CREATE TABLE IF NOT EXISTS bairro (
  idbairro         integer PRIMARY KEY DEFAULT nextval('seq_bairro_idbairro'),
  descricao        varchar(100),
  ativo            varchar(1) DEFAULT 'S',   -- flag S/N (campo editável, ≠ soft-delete)
  regiao           varchar(2),               -- código da região (combo); decode na view
  idcidade         integer,                  -- FK lógica p/ CIDADE (lookup fora desta fatia)
  indr             char(1),                  -- 'E' = excluído (soft-delete)
  indr_usuario     integer,
  indr_data        timestamptz,
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz
);
ALTER SEQUENCE seq_bairro_idbairro OWNED BY bairro.idbairro;

-- View de pesquisa. NÃO existe GET_BAIRRO no legado (tabela vazia, sem tela) — o decode
-- de REGIAO (código VARCHAR2(2)) é a NOSSA interpretação de zona urbana (Norte/Sul/...),
-- não a cópia de uma view legada. Mapeamento 1:1 com REGIAO_BAIRRO (bairro.schema.ts).
-- Como get_marcas: NÃO pré-filtramos INDR e EXPOMOS indr — o engine aplica a situação.
CREATE OR REPLACE VIEW get_bairro AS
SELECT
  idbairro,
  descricao,
  ativo,
  idcidade,
  CASE regiao
    WHEN 'C'  THEN 'CENTRO'
    WHEN 'N'  THEN 'NORTE'
    WHEN 'S'  THEN 'SUL'
    WHEN 'L'  THEN 'LESTE'
    WHEN 'O'  THEN 'OESTE'
    WHEN 'NL' THEN 'NORDESTE'
    WHEN 'SL' THEN 'SUDESTE'
    WHEN 'NO' THEN 'NOROESTE'
    WHEN 'SO' THEN 'SUDOESTE'
    ELSE ''
  END AS regiao,
  indr
FROM bairro;

-- Seed (bairros realistas; idcidade nulo nesta fatia).
INSERT INTO bairro (descricao, ativo, regiao) VALUES
  ('CENTRO',          'S', 'C'),
  ('JARDIM AMERICA',  'S', 'S'),
  ('VILA NOVA',       'S', 'N'),
  ('SANTA CRUZ',      'S', 'L');

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADBAIRRO', 'BTNGRAVAR',            7, 1),
  ('FRMCADBAIRRO', 'BTNEXCLUIR',           7, 1),
  ('FRMCADBAIRRO', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADBAIRRO', 'BTNEDITAR',            7, 1);
