-- 5ª tela: MARCAS — cadastro com SOFT-DELETE (INDR). Sem trigger REM (não replica).
CREATE SEQUENCE IF NOT EXISTS seq_marcas_idmarca;

CREATE TABLE IF NOT EXISTS marcas (
  idmarca          integer PRIMARY KEY DEFAULT nextval('seq_marcas_idmarca'),
  descricao        varchar(100),
  indr             char(1),          -- 'E' = excluído (soft-delete); null/'I' = ativo
  indr_usuario     integer,
  indr_data        timestamptz,
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz
);
ALTER SEQUENCE seq_marcas_idmarca OWNED BY marcas.idmarca;

-- View de pesquisa (NÃO filtra INDR — o filtro é aplicado na query da listagem,
-- como o form-base faz: COALESCE(INDR,'I')='I').
CREATE OR REPLACE VIEW get_marcas AS
SELECT idmarca AS codigo, descricao, indr, indr_data, indr_usuario FROM marcas;

INSERT INTO marcas (descricao) VALUES ('NESTLE'), ('UNILEVER'), ('COCA-COLA');

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADMARCAS', 'BTNGRAVAR',  7, 1),
  ('FRMCADMARCAS', 'BTNEXCLUIR', 7, 1);
