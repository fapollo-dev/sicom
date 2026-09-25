-- O histórico da receita (RECEITA_PROD_HIST, 858 linhas carregadas): o código vem da sequência do legado (ID_CODRECEITAHIST). A sequência é
-- dona da coluna — a carga a alinha pelo maior carregado (carregar-cutover.ts). Quem grava é o cadastro de produto (o gatilho
-- RECEITA_PROD_HIST do legado, portado em `produto.aggregate.ts` porque o detalhe é regravado por delete+insert).
CREATE SEQUENCE IF NOT EXISTS seq_receita_prod_hist;
ALTER SEQUENCE seq_receita_prod_hist OWNED BY receita_prod_hist.codreceitahist;
ALTER TABLE receita_prod_hist ALTER COLUMN codreceitahist SET DEFAULT nextval('seq_receita_prod_hist');
SELECT setval('seq_receita_prod_hist', coalesce((SELECT max(codreceitahist) FROM receita_prod_hist), 0)::bigint + 1, false);
