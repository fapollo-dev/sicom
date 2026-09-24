-- 327 — O A PAGAR NA CAIXA GERENCIAL (CAIXA-escritores.md §2): o que o escritor do rateio precisa no destino.
--
-- 1) DTCOMPRA × DTVENDA. O APAGAR do legado só tem DTCOMPRA (a carga o traz em `apagar.dtcompra`, mig 201); o Apollo nasceu
--    com `dtvenda` (a tela, a view get_apagar, o período fechado, o título de saldo) — e a carga não o preenche: o título
--    migrado aparecia SEM data de emissão na tela. Uma data só, nas duas colunas: a que vier preenche a outra — pelo fuso
--    da loja (dtcompra é date, dtvenda é timestamptz: a meia-noite UTC seria o dia anterior no Brasil).
CREATE OR REPLACE FUNCTION apollo_apagar_dtcompra() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.dtcompra IS NULL THEN NEW.dtcompra := (NEW.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date; END IF;
    IF NEW.dtvenda IS NULL THEN NEW.dtvenda := (NEW.dtcompra::timestamp AT TIME ZONE 'America/Sao_Paulo'); END IF;
  ELSE
    IF NEW.dtvenda IS DISTINCT FROM OLD.dtvenda AND NEW.dtcompra IS NOT DISTINCT FROM OLD.dtcompra THEN NEW.dtcompra := (NEW.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date;
    ELSIF NEW.dtcompra IS DISTINCT FROM OLD.dtcompra AND NEW.dtvenda IS NOT DISTINCT FROM OLD.dtvenda THEN NEW.dtvenda := (NEW.dtcompra::timestamp AT TIME ZONE 'America/Sao_Paulo');
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_apagar_dtcompra ON apagar;
CREATE TRIGGER trg_apagar_dtcompra BEFORE INSERT OR UPDATE ON apagar FOR EACH ROW EXECUTE FUNCTION apollo_apagar_dtcompra();
UPDATE apagar SET dtvenda = (dtcompra::timestamp AT TIME ZONE 'America/Sao_Paulo') WHERE dtvenda IS NULL AND dtcompra IS NOT NULL;
UPDATE apagar SET dtcompra = (dtvenda AT TIME ZONE 'America/Sao_Paulo')::date WHERE dtcompra IS NULL AND dtvenda IS NOT NULL;

-- 2) o rateio e a CAIXA são por GRUPO (APAGAR.CODGRUPO, a sequência ID_CODGRUPO — seq_caixa_codgrupo, mig 319)
CREATE INDEX IF NOT EXISTS ix_apagar_codgrupo ON apagar (codgrupo);
CREATE INDEX IF NOT EXISTS ix_cx_apagar_codgrupo ON cx_apagar (codgrupo);
CREATE INDEX IF NOT EXISTS ix_caixa_codcxapagar ON caixa (codgrupo, codcxapagar) WHERE codcxapagar IS NOT NULL;
