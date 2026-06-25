-- HISTORICO_DINAMICO — auditoria genérica de mudança de campo do form-base
-- (SetaHistorico_Dinamico). UMA LINHA POR CAMPO ALTERADO em toda gravação/exclusão.
-- Estrutura espelha a tabela real do legado (PINHEIRAO.HISTORICO_DINAMICO):
--   campo/valor_anterior/valor_atual + contexto (tabela, chave/valor_chave,
--   operador, empresa, data, historico, origem). VALOR_* são VARCHAR2(20) no
--   legado (valores stringificados e truncados) — preservamos o limite.
CREATE SEQUENCE IF NOT EXISTS seq_historico_dinamico;

CREATE TABLE IF NOT EXISTS historico_dinamico (
  codhistorico    bigint PRIMARY KEY DEFAULT nextval('seq_historico_dinamico'),
  campo           varchar(20),
  valor_anterior  varchar(20),
  valor_atual     varchar(20),
  tabela          varchar(30),
  data            timestamptz DEFAULT now(),
  codoperador     integer,
  chave           varchar(30),       -- nome da coluna-chave (ex.: 'IDMARCA')
  valor_chave     varchar(60),       -- valor da chave (PK do registro)
  codempresa      integer,
  historico       varchar(500),      -- descrição livre (ex.: 'INSERT'/'UPDATE'/'DELETE')
  origem          varchar(50)
);
ALTER SEQUENCE seq_historico_dinamico OWNED BY historico_dinamico.codhistorico;

CREATE INDEX IF NOT EXISTS ix_historico_dinamico_alvo
  ON historico_dinamico (tabela, valor_chave);
