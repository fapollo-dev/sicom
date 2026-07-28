-- 114 — PRODUTO aba "Fator de Conversão de Unidades" (tabFatorConversao do UCadProduto): conversão de
-- unidade POR PRODUTO, detalhe 1:N do agregado `produtos`. Leitura: "1 <PARA> contém <FATOR> <DE>", onde
-- PARA = unidade do produto (read-only no legado — TDBText; golden: PARA = produtos.unidade em 100% das
-- 86 linhas → derivado no servidor) e DE = unidade convertida (o usuário informa só DE + FATOR).
--
-- FK é CODPRODUTO (não idproduto) — nome fiel ao legado; referencia produtos(idproduto). NÃO tem UNIQUE de
-- (codproduto,de,para): a unicidade é regra de APLICAÇÃO (fiel ao RetornarValores; golden tem 0 duplicados).
-- DE≠unidade e FATOR>0 são guardas de ENTRADA (web, espelham edtUnDeExit/btnSaveFatorConv) — NÃO travas de
-- gravação: o golden tem 21 linhas com DE=PARA e 1 com FATOR=0 (sujo), e reabrir+gravar não pode regredir.
CREATE SEQUENCE IF NOT EXISTS seq_fator_conversao_codfatorconv;
CREATE TABLE IF NOT EXISTS fator_conversao (
  codfatorconv integer PRIMARY KEY DEFAULT nextval('seq_fator_conversao_codfatorconv'),
  codproduto   integer NOT NULL REFERENCES produtos(idproduto) ON DELETE CASCADE,
  de           varchar(6) NOT NULL,               -- unidade convertida (o usuário informa)
  para         varchar(6) NOT NULL,               -- unidade do produto (derivada no servidor; Oracle NOT NULL, golden 0 nulos)
  fator        numeric(13,6) NOT NULL DEFAULT 0    -- quantidade (golden tem 1 linha = 0)
);
ALTER SEQUENCE seq_fator_conversao_codfatorconv OWNED BY fator_conversao.codfatorconv;
CREATE INDEX IF NOT EXISTS ix_fator_conversao_codproduto ON fator_conversao(codproduto);
