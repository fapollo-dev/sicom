-- O gatilho SET_DEFAULTS (BEFORE INSERT OR UPDATE em ARECEBER, lido da produção): TOTAL_BRT nulo recebe o TOTAL. No Apollo só 2 dos 14
-- caminhos de inclusão do contas a receber gravavam o TOTAL_BRT; no banco vale para todos (e para a alteração, como no legado).
CREATE OR REPLACE FUNCTION fn_areceber_set_defaults() RETURNS trigger AS $$
BEGIN
  IF NEW.total_brt IS NULL THEN
    NEW.total_brt := NEW.total;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_areceber_set_defaults ON areceber;
CREATE TRIGGER trg_areceber_set_defaults BEFORE INSERT OR UPDATE ON areceber
  FOR EACH ROW EXECUTE FUNCTION fn_areceber_set_defaults();
