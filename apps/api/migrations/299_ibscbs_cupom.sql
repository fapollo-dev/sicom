-- 299 — IBS/CBS NO CUPOM: a venda do PDV carrega os grupos desde mar/2026, e a apuração não os via.
-- ⚠️ CORRIGE UMA AFIRMAÇÃO MINHA da mig 281 (e do dossiê `uCadIBSCBS.md` §13.3): "o débito de cupom não entra:
-- nenhuma venda de cupom carrega grupo IBS/CBS". Eu medi as NOTAS (os 98.760 itens de `NF_PROD_IBSCBS`) e não
-- olhei os itens do CUPOM, que moram em `VENDAS`. Achado na varredura dos pontos cegos do conferidor (as colunas
-- estão preenchidas em ~7% das 19 milhões de vendas — abaixo do limiar de 50% que ele olha).
--
-- Oracle de produção (só leitura), 23/09/2026 — itens de venda com os grupos, por mês:
--   2026-03  166.588 itens · base R$ 1.870.461,14 · CBS R$ 6.858,23 · IBS-UF R$ 390,68
--   2026-04  205.810       · base R$ 2.536.041,46 · CBS R$ 9.908,81 · IBS-UF R$ 639,81
--   2026-07  227.892       · base R$ 2.892.967,70 · CBS R$ 10.340,65 · IBS-UF R$ 659,66
--   (fev/2026 tem 3 itens de teste; de mar a set, ~200 mil por mês)
-- CST 000 e 200; cClassTrib 000001 a 200038. A apuração de IBS/CBS do Apollo subestimava o DÉBITO nesse valor
-- todo mês — e o crédito das notas, que é dez vezes o débito das notas, parecia a explicação.
--
-- As colunas vêm com os nomes do legado, exceto o CST, que aqui é `cst_ibscbs`: `vendas` já tem o CST do ICMS
-- (`icms_cst`), e um `cst` solto seria lido como ele. IBS = IBS-UF + IBS-municipal, como nas notas (exato em
-- 10.012 de 10.012 cabeçalhos, mig 279).
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cst_ibscbs        varchar(3);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cclasstrib        varchar(6);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS vbc               numeric(12,2);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS pibsuf            numeric(13,4);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS vibsuf            numeric(12,2);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS pibsmun           numeric(13,4);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS vibsmun           numeric(12,2);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS pcbs              numeric(13,4);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS vcbs              numeric(12,2);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS predaliq_cbs      numeric(13,4);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS paliqefet_cbs     numeric(13,4);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS predaliq_ibsuf    numeric(13,4);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS paliqefet_ibsuf   numeric(13,4);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS predaliq_ibsmun   numeric(13,4);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS paliqefet_ibsmun  numeric(13,4);

-- a perna do CUPOM na apuração, em colunas próprias (a fiscalização pergunta separado) e SOMADA ao débito
ALTER TABLE apuracao_ibscbs ADD COLUMN IF NOT EXISTS base_debito_cupom numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE apuracao_ibscbs ADD COLUMN IF NOT EXISTS ibs_debito_cupom  numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE apuracao_ibscbs ADD COLUMN IF NOT EXISTS cbs_debito_cupom  numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE apuracao_ibscbs ADD COLUMN IF NOT EXISTS cupons_debito     integer NOT NULL DEFAULT 0;
