-- OS JOBS DO BANCO DE PRODUÇÃO que mexem em dado (ALL_SCHEDULER_JOBS, lidos em 25/09/2026, somente leitura) — fazem parte do
-- comportamento vivo do legado, e o fonte Delphi não os tem. Os dois que rodam e alteram dado de negócio viram gatilho aqui (o mesmo
-- efeito, sem a espera do agendamento); os outros estão em docs/05-migration-engineering/jobs-do-banco.md.

-- UPDATEICMSNEGATIVO_SPED (a cada 3 horas, 2.466 execuções sem falha): `UPDATE nf_prod SET vricm = vricm * -1 WHERE vricm < 0`.
-- Na produção não há nenhum item com VRICM negativo (0 de todas as linhas): o valor negativo dura no máximo 3 horas.
CREATE OR REPLACE FUNCTION trg_nf_prod_vricm_positivo() RETURNS trigger AS $$
BEGIN
  IF NEW.vricm < 0 THEN NEW.vricm := -NEW.vricm; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS nf_prod_vricm_positivo ON nf_prod;
CREATE TRIGGER nf_prod_vricm_positivo BEFORE INSERT OR UPDATE OF vricm ON nf_prod
  FOR EACH ROW EXECUTE FUNCTION trg_nf_prod_vricm_positivo();

-- UPDATE_INTEGRACAO_CODPLANOCONTAS_DEB_BAIXA_C (todo dia às 05:00, 341 execuções sem falha):
--   UPDATE apagar SET codplanocontas_deb_baixa_cp = NULL WHERE codplanocontas_deb_baixa_cp IS NOT NULL;
--   UPDATE apagar_bx SET codplc_juros = 3707 WHERE codplc_juros IS NULL AND acre_desc < 0;
-- A conta de débito da baixa que o faturamento copia da situação não sobrevive à noite (0 títulos com ela na produção): a integração
-- contábil da baixa cai sempre na conta do fornecedor. E a baixa com acréscimo negativo ganha o centro de custo 3707 ("JUROS
-- BANCARIOS") quando não tem um — 363 de 375 em 2026 (as 12 sem são as do dia, antes das 05:00). O 3707 é do cliente: o gatilho só
-- age quando o centro existe na base.
CREATE OR REPLACE FUNCTION trg_apagar_sem_conta_deb_baixa() RETURNS trigger AS $$
BEGIN
  NEW.codplanocontas_deb_baixa_cp := NULL;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS apagar_sem_conta_deb_baixa ON apagar;
CREATE TRIGGER apagar_sem_conta_deb_baixa BEFORE INSERT OR UPDATE ON apagar
  FOR EACH ROW WHEN (NEW.codplanocontas_deb_baixa_cp IS NOT NULL) EXECUTE FUNCTION trg_apagar_sem_conta_deb_baixa();

CREATE OR REPLACE FUNCTION trg_apagar_bx_plc_juros() RETURNS trigger AS $$
BEGIN
  IF NEW.codplc_juros IS NULL AND COALESCE(NEW.acre_desc, 0) < 0 AND EXISTS (SELECT 1 FROM plc WHERE codplc = 3707) THEN
    NEW.codplc_juros := 3707;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS apagar_bx_plc_juros ON apagar_bx;
CREATE TRIGGER apagar_bx_plc_juros BEFORE INSERT OR UPDATE ON apagar_bx
  FOR EACH ROW EXECUTE FUNCTION trg_apagar_bx_plc_juros();
