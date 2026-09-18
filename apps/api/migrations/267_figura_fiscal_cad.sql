-- 267 — CADASTRO DE FIGURAS FISCAIS (`FRMCADFIGURASFISCAIS`, `uCadFigurasFiscais.pas` + `udmCadFigurasFiscais`).
-- **6 acessos, 2 operadores.** Dossiê: `uCadFigurasFiscais.md`.
--
-- A figura fiscal é a chave do `INDEXADOR_TRIBUTARIO` multi-campo que a mig 034 já implementou (o caminho
-- que 4 das 5 empresas usam: `EMPRESAS.FIGURAFISCAL = 'O'`; só uma está em 'D', a que consulta
-- `DET_ALIQUOTA` por alíquota). Faltava a TELA que mantém o catálogo — a do legado edita um campo só,
-- `DESCFIGURAFISCAL`.
--
-- ── O que o dado diz (produção, 18/09/2026) ─────────────────────────────────────────────────────────────
--  · `FIGURA_FISCAL`: **16.838 linhas**, todas ativas (`INDR='I'`); descrições como 'ISENTO',
--    'SUBSTITUICAO', 'TRIBUTADO 7%', 'TRIBUTADO 12%'.
--  · **só 11 figuras distintas aparecem no `INDEXADOR_TRIBUTARIO`** — o catálogo tem 16.838 linhas e a
--    regra tributária usa 11. O resto é histórico de integração (a tabela tem `INTEGRACAO_ID`).
--  · a tabela já está no destino (mig 034) e no plano de carga; aqui entram as colunas que a carga
--    precisa preservar e a tela mostra.
ALTER TABLE figura_fiscal ADD COLUMN IF NOT EXISTS codreduzido      varchar(20);
ALTER TABLE figura_fiscal ADD COLUMN IF NOT EXISTS usultalteracao   integer;
ALTER TABLE figura_fiscal ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz;
ALTER TABLE figura_fiscal ADD COLUMN IF NOT EXISTS dtcadastro       timestamptz DEFAULT now();
ALTER TABLE figura_fiscal ADD COLUMN IF NOT EXISTS indr_usuario     integer;
ALTER TABLE figura_fiscal ADD COLUMN IF NOT EXISTS indr_data        timestamptz;
CREATE SEQUENCE IF NOT EXISTS seq_figura_fiscal;
SELECT setval('seq_figura_fiscal', (SELECT GREATEST(coalesce(max(codfigurafiscal), 0), 1) FROM figura_fiscal));
ALTER TABLE figura_fiscal ALTER COLUMN codfigurafiscal SET DEFAULT nextval('seq_figura_fiscal');
CREATE INDEX IF NOT EXISTS ix_indexador_figura ON indexador_tributario (codfigurafiscal);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADFIGURASFISCAIS', 'FRMCADFIGURASFISCAIS', 7, 1),
  ('FRMCADFIGURASFISCAIS', 'BTNGRAVAR',            7, 1),
  ('FRMCADFIGURASFISCAIS', 'BTNEXCLUIR',           7, 1)
ON CONFLICT DO NOTHING;
