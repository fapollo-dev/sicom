-- RBAC do legado (form-base `PossuiAcessoForm`): tabela PERMISSOES.
-- Presença de linha = ACESSO CONCEDIDO (não há flag). Filtra por FORM+OPCAO+
-- (CODOPERADOR | CODPERFIL, conforme o modo) + CODEMPRESA. Modo do PINHEIRAO = 'Usuario'.
CREATE TABLE IF NOT EXISTS permissoes (
  form         varchar(60) NOT NULL,
  opcao        varchar(60) NOT NULL,
  codoperador  integer,
  codperfil    integer,
  codempresa   integer NOT NULL,
  caption      varchar(120),
  form_caption varchar(120)
);
CREATE INDEX IF NOT EXISTS ix_permissoes_lookup ON permissoes (form, opcao, codempresa);

-- Seed: concede ao operador 7 (empresa 1) as ações do Cadastro de Bancos.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADBANCOS', 'BTNGRAVAR',            7, 1),
  ('FRMCADBANCOS', 'BTNEXCLUIR',           7, 1),
  ('FRMCADBANCOS', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADBANCOS', 'BTNEDITAR',            7, 1);
