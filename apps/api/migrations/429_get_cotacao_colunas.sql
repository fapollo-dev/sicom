-- 429 — COTAÇÃO (FRMCADCOTACAO): a get_cotacao foi criada na mig 091 com `c.*`, e o PostgreSQL congela a lista de colunas na criação da
-- view — as colunas que a cotação ganhou depois (EMPRESAS na 310, DTENVIOEMAIL/CODCTC_LISTAF na 218) não apareciam. O cabeçalho da tela
-- (as lojas da cotação) precisa delas: a view é recriada com as colunas de hoje.
DROP VIEW IF EXISTS get_cotacao;
CREATE VIEW get_cotacao AS
  SELECT c.*,
    (SELECT count(*) FROM cotacao_prod p WHERE p.codctc = c.codctc) AS qtde_produtos,
    (SELECT count(*) FROM cotacao_forn f WHERE f.codctc = c.codctc) AS qtde_fornecedores
  FROM cotacao c;
