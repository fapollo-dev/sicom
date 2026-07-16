-- 086 — E7: SENHA DE OPERAÇÃO por empresa (EMPRESAS.SENHAADMIN/SENHADESC/SENHACANCEL/SENHAGAVETA).
--
-- No legado são cifradas em César +13 (TJvCaesarCipher, reversível — mesma cifra das senhas de operador). Aqui,
-- fiel à decisão do épico de auth (OPERADORES corte-3a): NÃO reusar a cifra reversível — armazenar HASH scrypt
-- (colunas *_hash). O admin (re)define a senha de operação; ações sensíveis (desconto/cancelamento/estorno)
-- verificam contra o hash. O cutover das senhas César legadas é um tool à parte (molde das 157 senhas de operador).
-- SENHAREDUCAO/SENHAGAVETA no PDV (redução Z / gaveta) — colunas migradas, mas o consumidor real é o PDV (adiado).
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS senha_admin_hash  text,
  ADD COLUMN IF NOT EXISTS senha_desc_hash   text,
  ADD COLUMN IF NOT EXISTS senha_cancel_hash text,
  ADD COLUMN IF NOT EXISTS senha_gaveta_hash text;

-- RBAC: definir a senha de operação = grant do cadastro de empresa (BTNGRAVAR). A verificação é chamada pelas
-- ações (não exige grant próprio além de operador autenticado).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADEMPRESA', 'BTNSENHAOPERACAO', 7, 1), ('FRMCADEMPRESA', 'BTNSENHAOPERACAO', 7, 2)
ON CONFLICT DO NOTHING;
