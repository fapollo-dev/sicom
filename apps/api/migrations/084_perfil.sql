-- 084 — PERFIS & PERMISSÕES (UCadPerfilOperador) corte-1: PERFIL + RELACAO_OPERADOR_PERFIL.
--
-- RBAC do legado (golden): PERMISSOES (já existe, mig 002; grant FORM×OPCAO keyed a CODOPERADOR ou CODPERFIL) +
-- PERFIL (perfis nomeados, 20 no golden) + RELACAO_OPERADOR_PERFIL (operador↔perfil M:N, 62). Acesso efetivo =
-- grants próprios ∪ grants dos perfis do operador (o corte-2 liga isso no acesso.service). Este corte cria o
-- CADASTRO de perfis + a atribuição de perfis a operadores. Perfil é GLOBAL (sem empresa, fiel ao PERFIL do golden).

CREATE SEQUENCE IF NOT EXISTS seq_perfil;
CREATE TABLE IF NOT EXISTS perfil (
  codperfil        integer PRIMARY KEY DEFAULT nextval('seq_perfil'),
  perfil           varchar(100) NOT NULL,             -- nome do perfil
  ativo            char(1) DEFAULT 'S',
  tipo             varchar(20),                        -- classificação livre do legado
  usucadastro      integer,
  dtcadastro       timestamptz DEFAULT now(),
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  indr             varchar(1) DEFAULT 'I',             -- soft-delete
  indr_usuario     integer,
  indr_data        timestamptz
);
ALTER SEQUENCE seq_perfil OWNED BY perfil.codperfil;

CREATE SEQUENCE IF NOT EXISTS seq_relacao_operador_perfil;
CREATE TABLE IF NOT EXISTS relacao_operador_perfil (
  codrelacao       integer PRIMARY KEY DEFAULT nextval('seq_relacao_operador_perfil'),
  codoperador      integer NOT NULL REFERENCES operadores(codoperador),
  codperfil        integer NOT NULL REFERENCES perfil(codperfil),
  usucadastro      integer,
  dtcadastro       timestamptz DEFAULT now(),
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  indr             varchar(1) DEFAULT 'I'
);
ALTER SEQUENCE seq_relacao_operador_perfil OWNED BY relacao_operador_perfil.codrelacao;
-- 1 vínculo ativo por (operador, perfil) — a atribuição é idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS ux_relacao_operador_perfil ON relacao_operador_perfil (codoperador, codperfil) WHERE coalesce(indr, 'I') <> 'E';
CREATE INDEX IF NOT EXISTS ix_relacao_operador_perfil_op ON relacao_operador_perfil (codoperador);

-- View de lista/pesquisa dos perfis (+ contagem de operadores atribuídos).
CREATE OR REPLACE VIEW get_perfil AS
SELECT
  p.codperfil AS codigo,
  p.codperfil,
  p.perfil,
  p.ativo,
  p.tipo,
  p.indr,
  COALESCE((SELECT COUNT(*) FROM relacao_operador_perfil r WHERE r.codperfil = p.codperfil AND COALESCE(r.indr,'I') <> 'E'), 0) AS qtde_operadores
FROM perfil p;

-- RBAC da tela.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADPERFILOPERADOR', 'BTNGRAVAR', 7, 1), ('FRMCADPERFILOPERADOR', 'BTNGRAVAR', 7, 2),
  ('FRMCADPERFILOPERADOR', 'BTNEXCLUIR', 7, 1), ('FRMCADPERFILOPERADOR', 'BTNEXCLUIR', 7, 2),
  ('FRMCADPERFILOPERADOR', 'BTNADICIONARREGISTRO', 7, 1), ('FRMCADPERFILOPERADOR', 'BTNADICIONARREGISTRO', 7, 2),
  ('FRMCADPERFILOPERADOR', 'BTNEDITAR', 7, 1), ('FRMCADPERFILOPERADOR', 'BTNEDITAR', 7, 2),
  ('FRMCADPERFILOPERADOR', 'BTNRELACAO', 7, 1), ('FRMCADPERFILOPERADOR', 'BTNRELACAO', 7, 2)
ON CONFLICT DO NOTHING;
