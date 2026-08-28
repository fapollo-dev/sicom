-- 186 — FOLDS da F3, os três medidos no golden.
--
-- 1) `diario.idorigem` NOT NULL: 718 das 888.243 linhas do razão não têm origem. Poucas, mas são lançamentos
--    reais — e o razão não pode perder linha. O NOT NULL era nosso.
ALTER TABLE diario ALTER COLUMN idorigem DROP NOT NULL;

-- 2) `ux_mbo_fitid`: o banco REUSA o FITID (77 grupos / 693 linhas, e **nenhum** com data e valor iguais — §7b).
--    O índice não é a regra de dedup: o `conciliacao-bancaria.service.ts:55-58` já consulta antes de inserir e
--    conta `duplicadas`. Ele é backstop, então segue o padrão das migs 173/178/182/183 — exclui o histórico.
ALTER TABLE movimentacao_bancaria_ofx ADD COLUMN IF NOT EXISTS origem_legado char(1);
DROP INDEX IF EXISTS ux_mbo_fitid;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mbo_fitid
  ON movimentacao_bancaria_ofx (codconta, mbo_transacao_id, mbo_check_num)
  WHERE coalesce(origem_legado, 'N') <> 'S';

-- 3) `ck_adto_venc` (dtvencimento >= dtadiantamento): **54 dos 563 adiantamentos do golden têm vencimento ANTES
--    da data do adiantamento**. A regra veio do `btnGravarClick` do legado (validação 4) — que valida na TELA, e
--    portanto não impediu o dado antigo. Mantemos a validação para o que é criado aqui e liberamos o histórico:
--    o CHECK passa a valer só quando `origem_legado` não é 'S'.
ALTER TABLE adiantamento_forn ADD COLUMN IF NOT EXISTS origem_legado char(1);
ALTER TABLE adiantamento_forn DROP CONSTRAINT IF EXISTS ck_adto_venc;
ALTER TABLE adiantamento_forn ADD CONSTRAINT ck_adto_venc
  CHECK (coalesce(origem_legado, 'N') = 'S' OR dtvencimento >= dtadiantamento);
