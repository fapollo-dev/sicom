-- 334 — DADOSCX ganha a sequência (fechamento de caixa, corte 4.8: o lançamento provisório).
--
-- O cabeçalho do lançamento provisório (`UlancProv`, BTNLANCPROV) grava o fiscal de caixa, os GT e as vendas do turno
-- numa linha de DADOSCX por dia × PDV × operador. O legado numera com `GetID('CODDADOSCX')`; aqui a coluna não tinha
-- default. Na produção são 133 linhas desde 2020 (2 em 2026), todas só com o fiscal — ferramenta de suporte.
CREATE SEQUENCE IF NOT EXISTS seq_dadoscx;
ALTER TABLE dadoscx ALTER COLUMN coddadoscx SET DEFAULT nextval('seq_dadoscx');
SELECT setval('seq_dadoscx', greatest(coalesce((SELECT max(coddadoscx) FROM dadoscx), 0), 1)::bigint, true);
