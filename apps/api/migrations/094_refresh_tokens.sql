-- REFRESH TOKEN (AUTH — endurecimento além do legado; o legado não tem sessão revogável). O access token (JWT)
-- é STATELESS e curto; o refresh token é OPACO (aleatório), guardado só como HASH (sha256, como a senha nunca em
-- claro), e permite: (a) renovar o access sem re-login; (b) REVOGAR a sessão no logout (o access stateless só some
-- ao expirar, mas sem refresh não há renovação); (c) ROTAÇÃO (cada refresh emite um novo e revoga o anterior) com
-- DETECÇÃO DE REUSO (apresentar um refresh já rotacionado = roubo → revoga a FAMÍLIA inteira, força re-login).
-- Tabela no schema do TENANT (schema-per-tenant), como operadores/operadores_acessos.
CREATE TABLE IF NOT EXISTS operadores_refresh_tokens (
  id          bigserial PRIMARY KEY,
  codoperador integer NOT NULL,
  codempresa  integer,                              -- empresa da sessão (carimbada no novo access ao renovar)
  familia     text NOT NULL,                        -- agrupa a cadeia de rotação (reuse-detection revoga a família)
  token_hash  text NOT NULL UNIQUE,                 -- sha256 do refresh (NUNCA o texto claro)
  expira_em   timestamptz NOT NULL,
  revogado_em timestamptz,                           -- NULL = ativo; setado na rotação/logout/reuso
  criado_em   timestamptz NOT NULL DEFAULT now(),
  ip          text
);
CREATE INDEX IF NOT EXISTS ix_refresh_codoperador ON operadores_refresh_tokens (codoperador);
CREATE INDEX IF NOT EXISTS ix_refresh_familia ON operadores_refresh_tokens (familia);
