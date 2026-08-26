-- 175 — CHAVES DO LEGADO na carga (§7e do PLANO-DE-CARGA). O ensaio mostrou que três PKs nossas não são únicas
-- na origem; a boa notícia é que `vendas` e `cx_vendas` já nascem com SURROGATE (sequence), então o conserto não
-- é de schema-de-aplicação: é a carga que não pode trazer o código do Oracle para dentro da PK.
--
--   vendas(codvendas):      1.887.781 grupos / 11.370.238 linhas repetidas — CODVENDAS lá é por VENDA (cupom),
--                           não por linha: 11.922.255 linhas para 2.439.798 códigos;
--   cx_vendas(codcxvendas): 89 / 178, mesma natureza;
--   det_aliquota(aliquota,uf) 1/5 e caixa_pdv(codcaixa) 1/2: PK natural — a carga DEDUPLICA (regra contada no
--   relatório de reconciliação), porque aqui a chave é usada pela aplicação e não pode virar surrogate.
--
-- O código do legado não se perde: vira coluna de referência indexada — é por ela que a conferência com o Oracle
-- (e qualquer relatório que amarre o cupom) encontra a linha depois da virada.
ALTER TABLE vendas    ADD COLUMN IF NOT EXISTS codvendas_legado    bigint;
ALTER TABLE cx_vendas ADD COLUMN IF NOT EXISTS codcxvendas_legado  bigint;
COMMENT ON COLUMN vendas.codvendas_legado IS 'CODVENDAS do Oracle (por VENDA/cupom, não por linha) — referência da carga; a PK daqui é surrogate';
COMMENT ON COLUMN cx_vendas.codcxvendas_legado IS 'CODCXVENDAS do Oracle — referência da carga; a PK daqui é surrogate';
CREATE INDEX IF NOT EXISTS ix_vendas_cod_legado    ON vendas (codvendas_legado);
CREATE INDEX IF NOT EXISTS ix_cx_vendas_cod_legado ON cx_vendas (codcxvendas_legado);
