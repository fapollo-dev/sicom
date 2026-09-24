-- 325 — FECHAMENTO DE CAIXA, corte 2 (efetivar): o que o efetivar grava e o destino não numerava.
-- CX_APAGAR: o `GetID('CODCXAPAGAR')` do legado (ID_CODCXAPAGAR). O efetivar cria o título do troco solidário (e de recarga,
-- correspondente e voucher quando configurados) com o rateio em CX_APAGAR (`UfinalizaFechamento.pas:1876-2028`); o mesmo
-- número serve ao escritor do A Pagar na CAIXA (`CAIXA-escritores.md` §2).
CREATE SEQUENCE IF NOT EXISTS seq_cx_apagar;
ALTER SEQUENCE seq_cx_apagar OWNED BY cx_apagar.codcxapagar;
SELECT setval('seq_cx_apagar', (coalesce((SELECT max(codcxapagar) FROM cx_apagar), 0) + 1)::bigint, false);
ALTER TABLE cx_apagar ALTER COLUMN codcxapagar SET DEFAULT nextval('seq_cx_apagar');
-- CONTACORRENTEOP é um acumulador por (operador, forma) sem PK no Oracle; o efetivar o lê por essa chave a cada linha.
CREATE INDEX IF NOT EXISTS ix_contacorrenteop_chave ON contacorrenteop (codoperador, idpgto);
CREATE INDEX IF NOT EXISTS ix_contacorrente_pdv ON contacorrente (codpdv, idpgto);
