-- O gatilho CASCATA_FAMILIA_PROD (BEFORE UPDATE em FAMILIAS_PROD, lido da produção), como está:
--  · mudou o TIPO: move os produtos do código antigo para o novo na coluna do tipo novo — o código da família não muda, então é um no-op
--    (mantido para a porta ficar igual);
--  · mudou o CODDPTO (ou o CODGRUPO) da família: move TODOS os produtos do departamento (grupo) antigo para o novo — não só os da família.
--    ⚠️ É o que o gatilho faz: trocar o departamento de UM subgrupo leva junto os produtos dos outros subgrupos do departamento antigo.
--    Na produção nenhuma alteração de departamento/grupo de família está na LOG; 99% dos produtos batem com o subgrupo.
-- Comparação do legado (`<>`: de/para nulo não dispara). A carga desliga os gatilhos.
CREATE OR REPLACE FUNCTION fn_familias_prod_cascata() RETURNS trigger AS $$
BEGIN
  IF OLD.tipo <> NEW.tipo THEN
    IF NEW.tipo = 'D' THEN
      UPDATE produtos SET coddpto = NEW.codfamilia WHERE coddpto = OLD.codfamilia;
    ELSIF NEW.tipo = 'G' THEN
      UPDATE produtos SET codgrupo = NEW.codfamilia WHERE codgrupo = OLD.codfamilia;
    ELSIF NEW.tipo = 'S' THEN
      UPDATE produtos SET codsubgrupo = NEW.codfamilia WHERE codsubgrupo = OLD.codfamilia;
    END IF;
  END IF;
  IF OLD.coddpto <> NEW.coddpto THEN
    UPDATE produtos SET coddpto = NEW.coddpto WHERE coddpto = OLD.coddpto;
  END IF;
  IF OLD.codgrupo <> NEW.codgrupo THEN
    UPDATE produtos SET codgrupo = NEW.codgrupo WHERE codgrupo = OLD.codgrupo;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_familias_prod_cascata ON familias_prod;
CREATE TRIGGER trg_familias_prod_cascata BEFORE UPDATE ON familias_prod
  FOR EACH ROW EXECUTE FUNCTION fn_familias_prod_cascata();
