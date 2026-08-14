-- 146 — rel 45/47 (Vendas por Área / Vendas × m²): a ÁREA física (m²) atribuída a uma família de produtos.
-- 1 linha no golden (área 1 m², empresa 1, família 7106) — config mínima mas VIVA; o relatório divide a venda
-- pela área p/ medir faturamento por metro quadrado de gôndola.
CREATE TABLE IF NOT EXISTS familias_prod_area (
  codfamilias_prod_area integer PRIMARY KEY,
  idempresa             integer,
  area                  numeric(13,2),
  validade_inventario   integer,
  codfamilia            integer,
  tipo                  char(1)
);
