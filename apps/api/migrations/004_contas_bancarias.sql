-- 3ª tela: CONTAS_BANCARIAS (subconjunto fiel — foco no padrão FK/lookup → BANCOS).
-- Sem trigger REM no legado → não replica.
CREATE SEQUENCE IF NOT EXISTS seq_conta_codconta;

CREATE TABLE IF NOT EXISTS contas_bancarias (
  codconta         integer PRIMARY KEY DEFAULT nextval('seq_conta_codconta'),
  codbco           integer NOT NULL REFERENCES bancos(codbco), -- FK → BANCOS (lookup)
  titular          varchar(50),
  nroconta         varchar(10),
  ativo            char(1) NOT NULL DEFAULT 'S',
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz
);
ALTER SEQUENCE seq_conta_codconta OWNED BY contas_bancarias.codconta;

-- View de pesquisa com JOIN no BANCOS (mostra o nome do banco — padrão lookup).
CREATE OR REPLACE VIEW get_contas_bancarias AS
SELECT c.codconta, c.codbco, b.banco, c.titular, c.nroconta, c.ativo
FROM contas_bancarias c
JOIN bancos b ON b.codbco = c.codbco;

-- Seed (usa bancos do seed 001): 2 contas.
INSERT INTO contas_bancarias (codbco, titular, nroconta, ativo) VALUES
  (1, 'MATRIZ',  '12345-6', 'S'),
  (5, 'FILIAL',  '98765-4', 'S');

-- RBAC: concede ao operador 7 (empresa 1).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADCONTASBANCARIAS', 'BTNGRAVAR',  7, 1),
  ('FRMCADCONTASBANCARIAS', 'BTNEXCLUIR', 7, 1);
