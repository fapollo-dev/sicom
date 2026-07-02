-- 042 — Corrige a UNIQUE da chave natural da NF para a tupla-golden.
--
-- Achado do code-review de certificação (2026-07-02): o índice ux_nf_natural criado em 025 usava
-- (nronf, serie, modelo, idempresa, TIPO, codparceiro) — divergente do que o legado e o próprio hook
-- `validar` (nf.aggregate.ts) consideram chave: (nronf, serie, modelo, idempresa, TIPOEMISSAO, codparceiro).
--   • uNF.pas:4735/4761 — a duplicidade é por número+fornecedor+série+modelo+empresa+tipoemissao; o
--     TIPO (E/S) NÃO participa da chave (golden confirmado).
--   • Incluir TIPO deixava passar no índice uma própria e uma terceiros de mesmo número/série/modelo/
--     parceiro que diferissem só no tipo; e omitir TIPOEMISSAO fazia própria('0') e terceiros('1')
--     colidirem indevidamente sob concorrência (o `validar` distingue por tipoemissao, mas roda fora do
--     lock — o índice é o backstop transacional e precisa casar com ele).
DROP INDEX IF EXISTS ux_nf_natural;
CREATE UNIQUE INDEX IF NOT EXISTS ux_nf_natural
  ON nf (nronf, serie, modelo, idempresa, tipoemissao, codparceiro)
  WHERE nronf IS NOT NULL AND nronf <> '';
