-- 313 — LOG: o "Registros de Log" do legado passa a ser gravado e lido pelo Apollo (FILA Achado 20, item 1).
--
-- A tabela veio com a carga (mig 311, 2,49 mi de linhas). Aqui: a sequência do IDLOG (no legado, `GetID('IDLOG')` →
-- ID_IDLOG, em 15.736.322 em 23/09/2026) — `OWNED BY` para a carga reposicioná-la no max(idlog) como faz com as outras
-- (carregar-cutover.ts, "SEQUÊNCIAS") — e o índice da consulta do visualizador (`WHERE CHAVE LIKE :CHAVE AND VALOR =
-- :VALOR AND TRUNC(DATAHORA) BETWEEN :DT1 AND :DT2`, uRegistrosLog.dfm:272).
CREATE SEQUENCE IF NOT EXISTS seq_log;
ALTER SEQUENCE seq_log OWNED BY log.idlog;
SELECT setval('seq_log', (coalesce((SELECT max(idlog) FROM log), 0) + 1)::bigint, false);
ALTER TABLE log ALTER COLUMN idlog SET DEFAULT nextval('seq_log');
CREATE INDEX IF NOT EXISTS ix_log_chave_valor ON log (chave, valor, datahora);
CREATE INDEX IF NOT EXISTS ix_log_datahora ON log (datahora);
