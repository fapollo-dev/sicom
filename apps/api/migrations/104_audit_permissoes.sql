-- 104 — AUDIT_PERMISSOES: trilha de auditoria das mudanças de GRANT (form×opção). Fiel ao Oracle
-- AUDIT_PERMISSOES (FORM, OPCAO, CODOPERADOR, CODEMPRESA, DATA, TIPO 'INSERT'/'DELETE', PROGRAMA, MAQUINA),
-- com 2 extensões do nosso modelo: CODPERFIL (o grant aqui é por PERFIL, que o legado não registrava) e
-- CODOPERADOR_ACAO (o ATOR — quem alterou; no legado ficava embutido em MAQUINA). CODOPERADOR = alvo operador
-- (null para grant de perfil). TIPO 'INSERT' = concedido / 'DELETE' = revogado. Reusa RBAC FRMCADPERFILOPERADOR.
CREATE SEQUENCE IF NOT EXISTS seq_audit_permissoes;
CREATE TABLE IF NOT EXISTS audit_permissoes (
  codaudit         integer PRIMARY KEY DEFAULT nextval('seq_audit_permissoes'),
  form             varchar(60) NOT NULL,
  opcao            varchar(60) NOT NULL,
  codoperador      integer,               -- alvo operador (null p/ grant de perfil)
  codperfil        integer,               -- alvo perfil (extensão: o grant é perfil-based)
  codempresa       integer NOT NULL,
  data             timestamptz NOT NULL DEFAULT now(),
  tipo             varchar(20) NOT NULL,  -- 'INSERT' (concede) / 'DELETE' (revoga)
  programa         varchar(200),
  maquina          varchar(200),
  codoperador_acao integer                -- ATOR (quem alterou)
);
ALTER SEQUENCE seq_audit_permissoes OWNED BY audit_permissoes.codaudit;
CREATE INDEX IF NOT EXISTS ix_audit_permissoes_perfil ON audit_permissoes (codperfil, data);
CREATE INDEX IF NOT EXISTS ix_audit_permissoes_empresa ON audit_permissoes (codempresa, data);
