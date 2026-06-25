-- 4ª tela: MESTRE-DETALHE (LOTE_COBRANCA + ITENS_LOTECOB).
CREATE SEQUENCE IF NOT EXISTS seq_lotecob_codlotecob;
CREATE SEQUENCE IF NOT EXISTS seq_ilotecob_codilotcob;

CREATE TABLE IF NOT EXISTS lote_cobranca (
  codlotecob       integer PRIMARY KEY DEFAULT nextval('seq_lotecob_codlotecob'),
  codparceiro      integer NOT NULL,
  data             timestamptz NOT NULL,
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz
);
ALTER SEQUENCE seq_lotecob_codlotecob OWNED BY lote_cobranca.codlotecob;

CREATE TABLE IF NOT EXISTS itens_lotecob (
  codilotcob  integer PRIMARY KEY DEFAULT nextval('seq_ilotecob_codilotcob'),
  codlotecob  integer NOT NULL REFERENCES lote_cobranca(codlotecob) ON DELETE CASCADE,
  codrcb      integer NOT NULL
);
ALTER SEQUENCE seq_ilotecob_codilotcob OWNED BY itens_lotecob.codilotcob;

-- View de listagem do lote (com contagem de itens).
CREATE OR REPLACE VIEW get_lote_cobranca AS
SELECT l.codlotecob, l.codparceiro, l.data,
       (SELECT count(*) FROM itens_lotecob i WHERE i.codlotecob = l.codlotecob) AS qtd_itens
FROM lote_cobranca l;

-- RBAC.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADLOTECOBRANCA', 'BTNGRAVAR',  7, 1),
  ('FRMCADLOTECOBRANCA', 'BTNEXCLUIR', 7, 1);
