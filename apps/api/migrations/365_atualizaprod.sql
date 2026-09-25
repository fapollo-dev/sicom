-- O gatilho ATUALIZAPROD (BEFORE INSERT OR UPDATE em MULTI_PRECO, lido da produção), no ramo UPDATE: toda alteração carimba DTULTIMALTERACAO,
-- e preço, promoção ou ATACAREJO_ATIVO mudado carimba DTULTPRECOALTERADO e devolve ETQ_IMPRESSA a 'N' (etiqueta a reimprimir). A mig 127
-- não tinha ATACAREJO_ATIVO (24.733 linhas 'S' na produção) nem DTULTIMALTERACAO — as duas colunas chegaram na mig 310.
-- Segue IS DISTINCT FROM (a escolha documentada na mig 127: preço que sai de/para NULL também pede etiqueta).
-- O ramo INSERT fica no código (produto-lojas.ts incluirNasLojas e as linhas novas do cadastro, produto.aggregate.ts): o cadastro regrava o
-- detalhe por delete+insert, e 92.471 linhas da produção têm ETQ_IMPRESSA nula — no banco, cada gravação pediria etiqueta de todas.
-- A carga desliga os gatilhos (carregar-cutover.ts, DISABLE TRIGGER ALL).
CREATE OR REPLACE FUNCTION fn_multi_preco_preco_alterado() RETURNS trigger AS $$
BEGIN
  NEW.dtultimalteracao := now();
  IF (NEW.vrvenda IS DISTINCT FROM OLD.vrvenda)
     OR (NEW.vrpromo IS DISTINCT FROM OLD.vrpromo)
     OR (NEW.promocao IS DISTINCT FROM OLD.promocao)
     OR (NEW.atacarejo_ativo IS DISTINCT FROM OLD.atacarejo_ativo) THEN
    NEW.dtultprecoalterado := now();
    NEW.etq_impressa := 'N';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
