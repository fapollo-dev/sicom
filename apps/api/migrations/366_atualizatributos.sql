-- O gatilho ATUALIZATRIBUTOS (AFTER INSERT OR UPDATE em MULTI_PRECO, lido da produção): o que muda na linha de preço vai para o produto —
-- IDPISCOFINS, TIPOPIS, IDTABELA, CODFIGURAFISCAL e ALIQUOTASAIDA → PRODUTOS.ALIQUOTA. No legado o combo "Alíquota" do cadastro é a
-- MULTI_PRECO.ALIQUOTASAIDA (UCadProduto.dfm, cmbALIQUOTA em dtsMulti_Preco): PRODUTOS.ALIQUOTA é derivada por este gatilho. Serve a todo
-- UPDATE da linha (NF processada, alteração em massa, a tributação espalhada pela UF no gravar do cadastro).
-- A comparação é a do legado (COALESCE com 0 / ' '); o UPDATE do produto só quando o valor difere (o resultado é o mesmo, sem regravar
-- o produto à toa). PRODUTOS.ALIQUOTA é NOT NULL nos dois bancos: zerar a alíquota da linha falha, como no legado.
-- O ramo INSERT fica no código: as inclusões do Apollo (a linha da sessão espelha o produto; as outras lojas copiam PIS/COFINS e tabela
-- do produto e deixam alíquota/figura vazias) não mudam nada no produto. A carga desliga os gatilhos.
CREATE OR REPLACE FUNCTION fn_multi_preco_atualiza_tributos() RETURNS trigger AS $$
BEGIN
  IF coalesce(OLD.idpiscofins, 0) <> coalesce(NEW.idpiscofins, 0) THEN
    UPDATE produtos SET idpiscofins = NEW.idpiscofins WHERE idproduto = NEW.idproduto AND idpiscofins IS DISTINCT FROM NEW.idpiscofins;
  END IF;
  IF coalesce(OLD.tipopis, ' ') <> coalesce(NEW.tipopis, ' ') THEN
    UPDATE produtos SET tipopis = NEW.tipopis WHERE idproduto = NEW.idproduto AND tipopis IS DISTINCT FROM NEW.tipopis;
  END IF;
  IF coalesce(OLD.idtabela, 0) <> coalesce(NEW.idtabela, 0) THEN
    UPDATE produtos SET idtabela = NEW.idtabela WHERE idproduto = NEW.idproduto AND idtabela IS DISTINCT FROM NEW.idtabela;
  END IF;
  IF coalesce(OLD.codfigurafiscal, 0) <> coalesce(NEW.codfigurafiscal, 0) THEN
    UPDATE produtos SET codfigurafiscal = NEW.codfigurafiscal WHERE idproduto = NEW.idproduto AND codfigurafiscal IS DISTINCT FROM NEW.codfigurafiscal;
  END IF;
  IF coalesce(OLD.aliquotasaida, ' ') <> coalesce(NEW.aliquotasaida, ' ') THEN
    UPDATE produtos SET aliquota = NEW.aliquotasaida WHERE idproduto = NEW.idproduto AND aliquota IS DISTINCT FROM NEW.aliquotasaida;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_multi_preco_atualiza_tributos ON multi_preco;
CREATE TRIGGER trg_multi_preco_atualiza_tributos AFTER UPDATE ON multi_preco
  FOR EACH ROW EXECUTE FUNCTION fn_multi_preco_atualiza_tributos();
