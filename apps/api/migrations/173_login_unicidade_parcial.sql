-- 173 — LOGIN DE OPERADOR: unicidade PARCIAL (decisão do usuário, 2026-08-26) + desempate por código.
--
-- O golden tem 4 logins repetidos entre operadores (15 contas): FLAVIA CARVALHO (2), LAURA (2), NATALIA (2) e
-- TESTE (4). O nosso `ux_operadores_login` era UNIQUE GLOBAL sobre `upper(login)` — invenção nossa que barraria
-- a carga. O legado não tem essa constraint: `uLogin.pas:339` (`CheckUser`) autentica pelo `segLogin`, que casa
-- **LOGIN + SENHA com JOIN em RELACAO_OPERADOR_EMPRESA filtrando CODEMPRESA** (uLogin.dfm) — ou seja, a
-- identidade lá é (login, senha, EMPRESA), e nem isso é único: `Result := not IsEmpty` pega a primeira linha do
-- cursor, sem ORDER BY.
--
-- O que o dado diz sobre os 4 casos:
--   LAURA (503 desab / 509 ativo) e NATALIA (502 desab / 508 ativo) → par "conta antiga desativada + nova";
--   FLAVIA CARVALHO (1321 e 1481) e TESTE (1121, 1801, 1841) → contas ATIVAS colidindo, todas na empresa 1.
--
-- Decisão: a unicidade vale para o que NASCE no Apollo; o histórico entra como está e a autenticação desempata
-- pelo MENOR CÓDIGO (o mais antigo), que é o que o cursor do legado devolve na prática.
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS origem_legado char(1);
COMMENT ON COLUMN operadores.origem_legado IS 'S = veio da carga do Oracle (aceita login repetido do histórico); NULL/N = nasceu no Apollo';

DROP INDEX IF EXISTS ux_operadores_login;
-- parcial: só cadastros novos e ativos disputam a unicidade do login
CREATE UNIQUE INDEX IF NOT EXISTS ux_operadores_login_novo
  ON operadores (upper(login))
  WHERE coalesce(origem_legado, 'N') <> 'S'
    AND coalesce(desabilitado, 'N') <> 'S'
    AND coalesce(indr, 'I') <> 'E';
-- e o índice de busca continua existindo para o login (agora sem unicidade)
CREATE INDEX IF NOT EXISTS ix_operadores_login ON operadores (upper(login));
