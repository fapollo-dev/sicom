-- O gatilho CHECK_REMESSAS_BOLETOS_CONTAS (BEFORE DELETE em ARECEBER, lido da produção): o título que está numa remessa de boleto
-- (REMESSAS_BOLETOS_CONTAS com INDR ≠ 'E') não é excluído — o boleto ficaria registrado no banco sem título no sistema. Na produção
-- 14.133 das 14.224 linhas estão ativas (última em 01/09/2026). Vale para todo caminho de exclusão (a tela, o agrupamento, o estorno da
-- baixa em lote, o caixa, o faturamento), como no legado. A carga desliga os gatilhos; o TRUNCATE não dispara o de linha.
-- O HINT 'APOLLO:<código>' faz o filtro de erros devolver 422 com o código e o texto do legado.
CREATE OR REPLACE FUNCTION fn_areceber_check_remessas_boletos() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM remessas_boletos_contas WHERE codrcb = OLD.codrcb AND coalesce(indr, 'I') <> 'E') THEN
    RAISE EXCEPTION 'Não é possível excluir o registro da ARECEBER devido a dependências na tabela REMESSAS_BOLETOS_CONTAS.'
      USING HINT = 'APOLLO:ARECEBER_EM_REMESSA_BOLETO', DETAIL = 'codrcb=' || OLD.codrcb;
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_areceber_check_remessas_boletos ON areceber;
CREATE TRIGGER trg_areceber_check_remessas_boletos BEFORE DELETE ON areceber
  FOR EACH ROW EXECUTE FUNCTION fn_areceber_check_remessas_boletos();
