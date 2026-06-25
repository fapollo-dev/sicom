-- 6ª tela / 1ª HERDEIRA COMPLETA via <CadMaster>: Cadastro de Bairros (legado BAIRRO).
-- Valida o pilar inteiro numa tela real: texto + COMBO (REGIAO) + flag (ATIVO),
-- soft-delete (INDR), Pesquisa com decode na view, navegação, histórico.
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

-- View de pesquisa. O REGIAO decode é cópia VERBATIM do GET_BAIRRO real (inclui o
-- quirk do legado: 'O'→CENTRO e o ramo inalcançável 'C'→OESTE — fidelidade = copiar o bug).
-- Diferença do GET_BAIRRO real: aqui NÃO pré-filtramos INDR e EXPOMOS indr — é o
-- contrato do engine (como get_marcas), que aplica o filtro de situação na query.
-- Resultado observável (excluídos somem por padrão) é idêntico ao legado.
CREATE OR REPLACE VIEW get_bairro AS
SELECT
  idbairro,
  descricao,
  ativo,
  idcidade,
  CASE
    WHEN regiao = 'C'  THEN 'CENTRO'
    WHEN regiao = 'N'  THEN 'NORTE'
    WHEN regiao = 'S'  THEN 'SUL'
    WHEN regiao = 'L'  THEN 'LESTE'
    WHEN regiao = 'O'  THEN 'CENTRO'
    WHEN regiao = 'C'  THEN 'OESTE'
    WHEN regiao = 'NL' THEN 'NORDESTE'
    WHEN regiao = 'SL' THEN 'SUDESTE'
    WHEN regiao = 'NO' THEN 'NOROESTE'
    WHEN regiao = 'SO' THEN 'SUDOESTE'
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
