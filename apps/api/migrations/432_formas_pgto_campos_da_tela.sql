-- 432 — FORMAS DE PAGAMENTO (FRMCADFORMAPGTO, uCadFormaPgto.pas/.dfm): o que a tela do legado usa e o Apollo não tinha.
--
-- * CODCONTABIL + GET_CODCONTABIL: a Pesquisa do "Código contábil" (btnBuscaCodContabilClick — CODIGO_CONTABIL, DESCRICAO). Na produção
--   a tabela existe e está vazia (0 linhas); a estrutura é a dela (PK_CODCONTABIL).
-- * GET_CONDICOES_PAGTO_FVENDA: a Pesquisa da "Condição de pagamento" (btnBuscaCondicaoPagtoClick), como a view da produção (as colunas
--   CODIGO, DESCRICAO, DT_ALTERACAO, QTDE_PARCELAS = quantos CDn > 0, CD1..CD8).
-- * REL_FORMA_PAGAMENTO_CONDICAO: a aba "Condições de pagamento" (PK_RFPC = IDPGTO + CODCONPAGTO; 0 linhas na produção).
-- * o atalho é único por loja E por forma pai: o índice da produção é PGTO_IDEMPRESA_ATALHO (IDEMPRESA, ATALHO, IDPGTO_PAI) — no Oracle o
--   nulo da chave composta conta como igual, então coalesce(idpgto_pai, 0) reproduz (a "PIX II" da loja 2 é filha da DINHEIRO).
CREATE TABLE IF NOT EXISTS codcontabil (
  codcontabil      numeric(10,0) PRIMARY KEY,
  descricao        varchar(100),
  status           char(1),
  usultalteracao   numeric(10,0),
  dtultimalteracao timestamptz,
  contadebito      numeric(10,0),
  contacredito     numeric(10,0),
  dtcadastro       timestamptz
);
CREATE OR REPLACE VIEW get_codcontabil (codigo_contabil, descricao) AS
SELECT codcontabil, descricao FROM codcontabil;

CREATE OR REPLACE VIEW get_condicoes_pagto_fvenda (codigo, descricao, dt_alteracao, qtde_parcelas, cd1, cd2, cd3, cd4, cd5, cd6, cd7, cd8) AS
SELECT codconpagto, descricao, coalesce(dtultimalteracao, dtcadastro),
       CASE WHEN coalesce(cd1, 0) > 0 THEN 1 ELSE 0 END + CASE WHEN coalesce(cd2, 0) > 0 THEN 1 ELSE 0 END
     + CASE WHEN coalesce(cd3, 0) > 0 THEN 1 ELSE 0 END + CASE WHEN coalesce(cd4, 0) > 0 THEN 1 ELSE 0 END
     + CASE WHEN coalesce(cd5, 0) > 0 THEN 1 ELSE 0 END + CASE WHEN coalesce(cd6, 0) > 0 THEN 1 ELSE 0 END
     + CASE WHEN coalesce(cd7, 0) > 0 THEN 1 ELSE 0 END + CASE WHEN coalesce(cd8, 0) > 0 THEN 1 ELSE 0 END,
       cd1, cd2, cd3, cd4, cd5, cd6, cd7, cd8
  FROM condicoes_pagto;

CREATE TABLE IF NOT EXISTS rel_forma_pagamento_condicao (
  idpgto      integer NOT NULL REFERENCES formas_pgto (idpgto) ON DELETE CASCADE,
  codconpagto integer NOT NULL,
  PRIMARY KEY (idpgto, codconpagto)
);

DROP INDEX IF EXISTS ux_formas_pgto_atalho;
CREATE UNIQUE INDEX IF NOT EXISTS ux_formas_pgto_atalho ON formas_pgto (idempresa, upper(atalho), coalesce(idpgto_pai, 0));
