-- 314 — PRODUTOS DESASSOCIADOS DO FORNECEDOR (FILA Achado 20, item 7).
--
-- A tabela veio com a carga (mig 311, 304 linhas, mantida até 02/09/2026 — a trilha AUDIT_PROD_DESASSOCIADOS). É a
-- lista de produtos que o comprador tirou de um fornecedor: as importações de itens do pedido de compra os pulam
-- (`GetSQLProdutos`, uPedidoCompra.pas:8313 — `P.IDPRODUTO NOT IN (SELECT IDPRODUTO FROM PRODUTOS_FORN_DESASSOCIADOS
-- WHERE CODPARCEIRO = :CODPARCEIRO)`, e o mesmo na consulta dos associados, uPedidoCompra.dfm:4972). Quem mantém: a aba
-- "Fornecedores desassociados" do cadastro de produto (UCadProduto.pas:1830) e o "Desassociar fornecedor do produto"
-- do pedido (uPedidoCompra.pas:2297).
-- O PFD_ID vem de `ID_PFD_ID` no legado; aqui a `seq_pfd` (OWNED BY, a carga a reposiciona). Um par por
-- (fornecedor, produto): o pedido checa antes de inserir ("Este produto já está desassociado do fornecedor.") e a
-- produção não tem repetição (304 pares distintos em 304 linhas).
CREATE SEQUENCE IF NOT EXISTS seq_pfd;
ALTER SEQUENCE seq_pfd OWNED BY produtos_forn_desassociados.pfd_id;
SELECT setval('seq_pfd', (coalesce((SELECT max(pfd_id) FROM produtos_forn_desassociados), 0) + 1)::bigint, false);
ALTER TABLE produtos_forn_desassociados ALTER COLUMN pfd_id SET DEFAULT nextval('seq_pfd');
CREATE UNIQUE INDEX IF NOT EXISTS ux_pfd_parceiro_produto ON produtos_forn_desassociados (codparceiro, idproduto);
CREATE INDEX IF NOT EXISTS ix_pfd_produto ON produtos_forn_desassociados (idproduto);
