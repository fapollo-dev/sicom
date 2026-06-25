-- 7ª tela: Cadastro de PRECO (Tabela de Reajuste) — completa o PALETTE de campos:
-- texto (DESCRICAO) + NÚMERO/MOEDA (VALOR_REAJUSTE numeric) + 2 CHECKBOX (REAJUSTE, ATIVO).
-- Tipos Oracle→PG: NUMBER(13,2)→numeric(13,2), CHAR(1)→char(1), VARCHAR2→varchar.
CREATE SEQUENCE IF NOT EXISTS seq_preco_id_preco;

CREATE TABLE IF NOT EXISTS preco (
  id_preco         integer PRIMARY KEY DEFAULT nextval('seq_preco_id_preco'),
  descricao        varchar(100),
  valor_reajuste   numeric(13,2),          -- campo numérico/moeda (NumberField)
  reajuste         char(1) DEFAULT 'N',    -- flag S/N (checkbox)
  ativo            varchar(1) DEFAULT 'S', -- flag S/N (checkbox)
  indr             char(1),                -- 'E' = excluído (soft-delete)
  indr_usuario     integer,
  indr_data        timestamptz,
  usucadastro      integer,
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz
);
ALTER SEQUENCE seq_preco_id_preco OWNED BY preco.id_preco;

-- View de pesquisa. GET_PRECO real projeta ID_PRECO/DESCRICAO/VALOR_REAJUSTE/REAJUSTE/ATIVO
-- e pré-filtra INDR='I'. Aqui (contrato do engine) EXPOMOS indr e NÃO pré-filtramos —
-- o engine aplica a situação (ativos/inativos/todos) na query. Resultado idêntico.
CREATE OR REPLACE VIEW get_preco AS
SELECT id_preco, descricao, valor_reajuste, reajuste, ativo, indr FROM preco;

-- Seed: as 2 linhas reais do legado (homolog PINHEIRAO).
INSERT INTO preco (descricao, valor_reajuste, reajuste, ativo) VALUES
  ('PIZZARIA', 10.00, 'S', 'S'),
  ('TESTE',     5.50, 'S', 'S');

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADPRECO', 'BTNGRAVAR',            7, 1),
  ('FRMCADPRECO', 'BTNEXCLUIR',           7, 1),
  ('FRMCADPRECO', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADPRECO', 'BTNEDITAR',            7, 1);
