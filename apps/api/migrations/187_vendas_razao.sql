-- 187 — CAPACIDADE (F4): `vendas.razao` — dado real 62 > destino 60. É o nome do cliente gravado na venda
-- (11,9M linhas); alargar é o único caminho que não perde caractere de nome próprio.
ALTER TABLE vendas ALTER COLUMN razao TYPE varchar(80);
