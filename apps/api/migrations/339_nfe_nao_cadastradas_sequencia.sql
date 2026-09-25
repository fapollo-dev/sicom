-- A FILA DO MANIFESTO: a chave da NFE_NAO_CADASTRADAS vem de uma sequência (o GetID do legado) — auditoria de esqueletos §4.2.
-- O Apollo usava o NSU da distribuição como CODNFE_NAOCAD: colidia com a chave migrada (1..66.929; ULTIMO_NSU é 6.582 na
-- empresa 2 e 21.920 na 51) e entre empresas. A carga ajusta a sequência (`carregar-cutover.ts` + `pos-carga.sql`).
CREATE SEQUENCE IF NOT EXISTS seq_nfe_nao_cadastradas;
SELECT setval('seq_nfe_nao_cadastradas', coalesce((SELECT max(codnfe_naocad) FROM nfe_nao_cadastradas), 0)::bigint + 1, false);
ALTER TABLE nfe_nao_cadastradas ALTER COLUMN codnfe_naocad SET DEFAULT nextval('seq_nfe_nao_cadastradas');

-- A última etapa realizada da esteira da nota (NF_STATUS_PROCESSO) — coluna do legado que não tinha destino: 15.393 de 15.398
-- resumos de 2025-26 a têm preenchida (a 66929 aponta a 451668, stProcessarFaturar).
ALTER TABLE nfe_nao_cadastradas ADD COLUMN IF NOT EXISTS codnfstatuspro integer;
