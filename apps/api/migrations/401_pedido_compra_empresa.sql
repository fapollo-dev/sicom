-- PEDIDO_COMPRA_EMPRESA acompanha o pedido: uma linha por loja do campo EMPRESAS ("1, 2"; vazio = a loja do pedido), com o INDR
-- do pedido. Quem grava no legado é o binário novo (o pedido multi-loja não está no fonte de 2020); a regra vem do dado — 583
-- de 653 pedidos de 2026 têm exatamente as lojas do EMPRESAS, e os 39 excluídos têm INDR 'E' nas duas tabelas. A
-- GET_PEDIDOCOMPRA (rel_get_pedidocompra, mig 390) faz JOIN nela: sem a linha, o pedido criado no Apollo sumiria da fonte do
-- relatório de pedidos. O PCE_FRETE (0 em todos os pedidos de 2026) é preservado; a loja que sai do EMPRESAS sai da tabela.
CREATE OR REPLACE FUNCTION apollo_pedido_compra_empresa() RETURNS trigger AS $$
DECLARE
  lojas integer[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT x::integer), '{}') INTO lojas
    FROM unnest(string_to_array(replace(coalesce(NEW.empresas, ''), ' ', ''), ',')) AS x
   WHERE x ~ '^\d+$';
  IF coalesce(array_length(lojas, 1), 0) = 0 AND NEW.idempresa IS NOT NULL THEN
    lojas := ARRAY[NEW.idempresa];
  END IF;
  DELETE FROM pedido_compra_empresa WHERE codpedcomp = NEW.codpedcomp AND NOT (codempresa = ANY(lojas));
  INSERT INTO pedido_compra_empresa (codpedcomp, codempresa, pce_frete, indr)
  SELECT NEW.codpedcomp, l, 0, NEW.indr FROM unnest(lojas) AS l
  ON CONFLICT (codpedcomp, codempresa) DO UPDATE SET indr = EXCLUDED.indr;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_pedido_compra_empresa ON pedidocompra;
CREATE TRIGGER tg_pedido_compra_empresa
  AFTER INSERT OR UPDATE OF empresas, indr, idempresa ON pedidocompra
  FOR EACH ROW EXECUTE FUNCTION apollo_pedido_compra_empresa();
