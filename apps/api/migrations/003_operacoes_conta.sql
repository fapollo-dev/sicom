-- 2ª tela: OPERACOES_CONTA (mapeada do Oracle). Sem trigger REM no legado → NÃO replica
-- (diferente de BANCOS): o repository desta entidade não escreve no outbox.
CREATE SEQUENCE IF NOT EXISTS seq_opconta_codopconta;

CREATE TABLE IF NOT EXISTS operacoes_conta (
  codopconta       integer PRIMARY KEY DEFAULT nextval('seq_opconta_codopconta'),
  descricao        varchar(100) NOT NULL,
  tipo             char(1) NOT NULL,          -- 'C' (Crédito) | 'D' (Débito)
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz
);
ALTER SEQUENCE seq_opconta_codopconta OWNED BY operacoes_conta.codopconta;

-- View de pesquisa (decodifica TIPO igual ao legado: C→CREDITO, else→DEBITO).
CREATE OR REPLACE VIEW get_operacoes_conta AS
SELECT descricao, codopconta,
       CASE tipo WHEN 'C' THEN 'CREDITO' ELSE 'DEBITO' END AS tipo
FROM operacoes_conta;

-- Seed real (1 linha do legado) + sequence para o próximo ser 1.
INSERT INTO operacoes_conta (codopconta, descricao, tipo) VALUES (0, 'TRANSFERENCIA', 'C');
SELECT setval('seq_opconta_codopconta', 1, false);

-- RBAC: concede ao operador 7 (empresa 1) as ações desta tela.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADOPERACOESCONTA', 'BTNGRAVAR',  7, 1),
  ('FRMCADOPERACOESCONTA', 'BTNEXCLUIR', 7, 1);
