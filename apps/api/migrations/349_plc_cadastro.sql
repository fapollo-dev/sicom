-- 349 — o cadastro de CENTRO DE CUSTO (PLC; uCadPLC) ganha a tela. O legado gera o código (`GetID('CODPLC')`, uCadPLC.pas:621); o
-- destino não tinha sequência. A lista traz a árvore (pai, tipo, nível) e o INDR (a exclusão é lógica, como no form-base).
CREATE SEQUENCE IF NOT EXISTS seq_plc;
SELECT setval('seq_plc', coalesce((SELECT max(codplc) FROM plc), 0)::bigint + 1, false);
ALTER TABLE plc ALTER COLUMN codplc SET DEFAULT nextval('seq_plc');

CREATE OR REPLACE VIEW get_plc AS
  SELECT codplc, codplc AS codigo, desccodplc, descricao, codpai, tpconta, nivelconta, codcontabil, indr FROM plc;
