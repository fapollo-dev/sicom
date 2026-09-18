-- 260 — CADASTRO DE CEST (`FRMCADCEST`, `uCadCest.pas` + `.dfm`). **11 acessos, 3 operadores.**
-- Dossiê: `uCadCest.md`.
--
-- O Código Especificador da Substituição Tributária (Convênio ICMS 92/15) — a tabela de referência que
-- `produtos.cest` aponta e que vai na NF-e e no SPED. A tela do legado é um CadMaster de três campos:
-- CEST, DESCRIÇÃO, NCM.
--
-- ── O que o dado diz (produção, 18/09/2026) ─────────────────────────────────────────────────────────────
--  · `CEST`: **19.109 linhas**, 896 CESTs distintos — a tabela é CEST × NCM (um CEST cobre vários NCMs; zero
--    pares repetidos). PK é `CODCEST` (surrogate). Além dos 3 campos da tela: SEGUIMENTO (25 valores), ITEM,
--    ANEXOXXVII. NCM é VARCHAR2(150) na origem, mas 100% tem 8 dígitos.
--  · Produtos com CEST: **31.556**. **248 apontam um CEST que NÃO existe na tabela** e 4 têm CEST fora do
--    formato de 7 dígitos — a tela do produto não valida contra nada, e o código errado vai para a NF-e.
--    Aqui `GET cadastro/cest/sem-cadastro` lista esses produtos.
--  · A tabela não existia no destino nem no plano de carga: entra na f0 do `plano-tabelas.json`.
CREATE SEQUENCE IF NOT EXISTS seq_cest;
CREATE TABLE IF NOT EXISTS cest (
  codcest          integer PRIMARY KEY DEFAULT nextval('seq_cest'),
  cest             varchar(7)    NOT NULL,
  ncm              varchar(8),
  descricao        varchar(1000) NOT NULL,
  seguimento       varchar(255),
  item             varchar(8),
  anexoxxvii       char(1),
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_cest OWNED BY cest.codcest;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cest_cest_ncm ON cest (cest, coalesce(ncm, ''));
CREATE INDEX IF NOT EXISTS ix_cest_ncm ON cest (ncm);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADCEST', 'FRMCADCEST', 7, 1),
  ('FRMCADCEST', 'BTNGRAVAR',  7, 1),
  ('FRMCADCEST', 'BTNEXCLUIR', 7, 1)
ON CONFLICT DO NOTHING;

-- o count de produtos por CEST (tela e `sem-cadastro`) anda por aqui
CREATE INDEX IF NOT EXISTS ix_produtos_cest ON produtos (cest);
