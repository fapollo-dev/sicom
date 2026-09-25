-- O gatilho UPDATE_CODAUXILIAR (BEFORE UPDATE em PRODUTOS, lido da produção): o produto que troca de código de barras leva o código novo a
-- todas as linhas do CODAUXILIAR (a coluna CODBARRA é o código PRINCIPAL — 1.147 de 1.147 iguais na produção). Vale para o cadastro e para
-- a multi-atualização. Comparação do legado (`<>`: de/para nulo não dispara). A carga desliga os gatilhos.
CREATE OR REPLACE FUNCTION fn_produtos_update_codauxiliar() RETURNS trigger AS $$
BEGIN
  IF NEW.codbarra <> OLD.codbarra THEN
    UPDATE codauxiliar SET codbarra = NEW.codbarra WHERE idproduto = NEW.idproduto;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_produtos_update_codauxiliar ON produtos;
CREATE TRIGGER trg_produtos_update_codauxiliar BEFORE UPDATE ON produtos
  FOR EACH ROW EXECUTE FUNCTION fn_produtos_update_codauxiliar();
