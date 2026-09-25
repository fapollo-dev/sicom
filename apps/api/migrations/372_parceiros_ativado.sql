-- O gatilho REM_PARCEIROS (AFTER INSERT OR UPDATE OR DELETE em PARCEIROS, lido da produção), na parte que não é remessa ao PDV: o ATIVADO
-- do parceiro mudou → PARCEIROS_END, PARCEIROS_REL e PARCEIROS_PGTO recebem o mesmo (produção: 827 endereços de parceiros inativos, todos
-- N). A REMESSA_SERVER (a fila de replicação do PDV) fica fora — sem PDV. Comparação do legado (`<>`: de/para nulo não dispara).
-- No cadastro, o endereço é coluna gerenciada do detalhe: `parceiro.aggregate.ts` o acompanha (o relacionamento e o pagamento sobrevivem
-- sozinhos — preservados da linha já cascateada).
CREATE OR REPLACE FUNCTION fn_parceiros_ativado() RETURNS trigger AS $$
BEGIN
  IF NEW.ativado <> OLD.ativado THEN
    UPDATE parceiros_end  SET ativado = NEW.ativado WHERE codparceiro = NEW.codparceiro;
    UPDATE parceiros_rel  SET ativado = NEW.ativado WHERE codparceiro = NEW.codparceiro;
    UPDATE parceiros_pgto SET ativado = NEW.ativado WHERE codparceiro = NEW.codparceiro;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_parceiros_ativado ON parceiros;
CREATE TRIGGER trg_parceiros_ativado AFTER UPDATE ON parceiros
  FOR EACH ROW EXECUTE FUNCTION fn_parceiros_ativado();
