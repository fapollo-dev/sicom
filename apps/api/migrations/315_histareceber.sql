-- 315 — HISTÓRICO DO CONTAS A RECEBER (`HISTARECEBER`; FILA Achado 20, item 9).
--
-- No legado quem grava é a trigger `REM_RECEBER` do Oracle (lida em user_source): quando a DATA DA VENDA de um título
-- muda, `INSERT INTO HISTARECEBER (CODHISTARECEBER, DATA, CODOPERADOR, CODRCB, HISTORICO) VALUES
-- (ID_CODHISTARECEBER.NEXTVAL, CURRENT_TIMESTAMP, :OLD.CODOPERADOR, :NEW.CODRCB, 'DATA DA VENDA ALTERADA')` — o operador
-- é o DO TÍTULO (:OLD.CODOPERADOR), não o da sessão. E a exclusão do título apaga o histórico dele
-- (`ExcluiHistAReceber`, uCadAReceber.pas:3536). A tabela veio com a carga (mig 311, 16 linhas até 03/12/2025).
-- Aqui, a mesma trigger — a carga roda com os gatilhos suspensos, então não gera histórico falso.
CREATE SEQUENCE IF NOT EXISTS seq_histareceber;
ALTER SEQUENCE seq_histareceber OWNED BY histareceber.codhistareceber;
SELECT setval('seq_histareceber', (coalesce((SELECT max(codhistareceber) FROM histareceber), 0) + 1)::bigint, false);
ALTER TABLE histareceber ALTER COLUMN codhistareceber SET DEFAULT nextval('seq_histareceber');
CREATE INDEX IF NOT EXISTS ix_histareceber_codrcb ON histareceber (codrcb);

CREATE OR REPLACE FUNCTION trg_areceber_historico() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM histareceber WHERE codrcb = OLD.codrcb;
    RETURN OLD;
  END IF;
  -- `:OLD.DTVENDA <> :NEW.DTVENDA` do Oracle: com nulo de um lado a comparação é desconhecida e não grava
  IF OLD.dtvenda <> NEW.dtvenda THEN
    INSERT INTO histareceber (data, codoperador, codrcb, historico)
    VALUES (now(), OLD.codoperador, NEW.codrcb, 'DATA DA VENDA ALTERADA');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_areceber_historico ON areceber;
CREATE TRIGGER trg_areceber_historico AFTER UPDATE OF dtvenda OR DELETE ON areceber
  FOR EACH ROW EXECUTE FUNCTION trg_areceber_historico();
