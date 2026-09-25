-- O gatilho VALIDA_AGRUPAMENTO (AFTER INSERT OR UPDATE em APAGAR, lido da produção): CODGRUPO ou CODGRUPO_AGRUPAMENTO_APG igual a ZERO é
-- erro ("ACIONAR O SUPORTE") — o grupo 0 juntaria títulos sem relação no rateio/CAIXA (por grupo) e no agrupamento. No Apollo os dois vêm
-- de sequência; a trava fica no banco para qualquer caminho, com o texto do legado (HINT 'APOLLO:<código>' → 422). Produção: 0 casos.
CREATE OR REPLACE FUNCTION fn_apagar_valida_agrupamento() RETURNS trigger AS $$
BEGIN
  IF NEW.codgrupo = 0 OR NEW.codgrupo_agrupamento_apg = 0 THEN
    RAISE EXCEPTION 'ERRO: ACIONAR O SUPORTE APOLLO SISTEMAS, PREFERENCIALMENTE 34 999480004'
      USING HINT = 'APOLLO:APAGAR_GRUPO_ZERO', DETAIL = 'codapg=' || NEW.codapg;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_apagar_valida_agrupamento ON apagar;
CREATE TRIGGER trg_apagar_valida_agrupamento AFTER INSERT OR UPDATE ON apagar
  FOR EACH ROW EXECUTE FUNCTION fn_apagar_valida_agrupamento();
