-- 316 — O ESTORNO DO CAIXA APAGA SÓ O QUE O APOLLO GRAVOU (recon do fechamento de caixa, 23/09/2026).
--
-- O estorno do fechamento do caixa do Apollo (`caixa-contabil.estornarNoTrx`, usado também na reabertura) apagava por
-- chaves que COLIDEM com o dado migrado:
--  · `mov_contas_bancarias WHERE nropdv_fechamento = <codcaixa> AND origem = 'FCP'` — no legado NROPDV_FECHAMENTO é o
--    NÚMERO DO PDV (10.390 linhas FCP em 2026) e o caixa do Apollo começa em 1: reabrir o caixa 53 apagaria o
--    fechamento migrado do PDV 53;
--  · `diario WHERE codorigem IN (17, 19) AND idorigem = <codcaixa>` — no legado o IDORIGEM dessas origens é o
--    IDSALDOOP / o CODCX, outro espaço de números.
-- Agora a contabilização guarda o lote e o movimento que criou, e o estorno apaga exatamente esses.
ALTER TABLE caixa_sessao ADD COLUMN IF NOT EXISTS codlote_contabil integer;
ALTER TABLE caixa_sessao ADD COLUMN IF NOT EXISTS codmovconta_fcp integer;
