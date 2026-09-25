-- O gatilho CLUBE_DESCONTO_ESTOQUE (BEFORE UPDATE em CLUBE_DESCONTO, lido da produção): toda alteração recalcula ENCERRADA — 'T' só quando
-- há teto de estoque (MAXIMO_ESTOQUE > 0) e a venda o alcançou (VENDA_ESTOQUE ≥ teto); senão 'F'. O Apollo gravava a ENCERRADA que viesse
-- da tela. Na produção nenhuma das 3.125 regras tem teto (e nenhuma está encerrada): a regra fica pronta para quando o teto for usado.
CREATE OR REPLACE FUNCTION fn_clube_desconto_estoque() RETURNS trigger AS $$
BEGIN
  IF coalesce(NEW.maximo_estoque, 0) = 0
     OR (coalesce(NEW.maximo_estoque, 0) > 0 AND coalesce(NEW.venda_estoque, 0) < coalesce(NEW.maximo_estoque, 0)) THEN
    NEW.encerrada := 'F';
  ELSE
    NEW.encerrada := 'T';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_clube_desconto_estoque ON clube_desconto;
CREATE TRIGGER trg_clube_desconto_estoque BEFORE UPDATE ON clube_desconto
  FOR EACH ROW EXECUTE FUNCTION fn_clube_desconto_estoque();
