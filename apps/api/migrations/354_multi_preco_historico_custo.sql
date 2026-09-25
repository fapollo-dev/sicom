-- O gatilho UPDATE_CUSTO_MULTI_PRECO do legado (lido de ALL_SOURCE na produção, só leitura): toda alteração de VRCUSTO, VRCUSTOREP,
-- VRPROMO ou VRVENDA na linha de preço grava o HISTORICO_DINAMICO — "Alteracao do Valor de Custo", "…de Custo de Reposicao",
-- "…de Promoção", "…de Venda" —, de qualquer tela (o processamento da NF, a precificação, a agenda…). O Apollo não tinha: o histórico de
-- custo do produto parava na carga. O operador: o da sessão (`apollo.operador`, quando a aplicação o põe), senão o CODUSUALT da própria
-- linha, senão o PRODUTOS.USULTALTERACAO (a mesma ordem do legado). O `<>` do Oracle com NULL não grava — aqui também não.

-- o número como o Oracle o converte para texto (TO_CHAR implícito): sem zeros à direita e sem o zero antes da vírgula (0.5 → '.5')
CREATE OR REPLACE FUNCTION apollo_num_oracle(v numeric) RETURNS varchar LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN v IS NULL THEN NULL
           WHEN v = 0 THEN '0'
           ELSE regexp_replace(regexp_replace(CASE WHEN v::text LIKE '%.%' THEN rtrim(rtrim(v::text, '0'), '.') ELSE v::text END, '^0\.', '.'), '^-0\.', '-.')
         END
$$;

CREATE OR REPLACE FUNCTION trg_update_custo_multi_preco() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_operador integer;
  v_sessao   text := current_setting('apollo.operador', true);
BEGIN
  IF v_sessao ~ '^\d+$' THEN v_operador := v_sessao::integer; END IF;
  IF v_operador IS NULL THEN v_operador := NEW.codusualt; END IF;
  IF v_operador IS NULL THEN SELECT usultalteracao INTO v_operador FROM produtos WHERE idproduto = NEW.idproduto; END IF;
  IF NEW.vrcusto <> OLD.vrcusto THEN
    INSERT INTO historico_dinamico (campo, valor_anterior, valor_atual, tabela, data, codoperador, codempresa, chave, valor_chave, historico)
    VALUES ('VRCUSTO', apollo_num_oracle(OLD.vrcusto), apollo_num_oracle(NEW.vrcusto), 'MULTI_PRECO', now(), v_operador, NEW.idempresa, 'IDPRODUTO', NEW.idproduto::text, 'Alteracao do Valor de Custo');
  END IF;
  IF NEW.vrcustorep <> OLD.vrcustorep THEN
    INSERT INTO historico_dinamico (campo, valor_anterior, valor_atual, tabela, data, codoperador, codempresa, chave, valor_chave, historico)
    VALUES ('VRCUSTOREP', apollo_num_oracle(OLD.vrcustorep), apollo_num_oracle(NEW.vrcustorep), 'MULTI_PRECO', now(), v_operador, NEW.idempresa, 'IDPRODUTO', NEW.idproduto::text, 'Alteracao do Valor de Custo de Reposicao');
  END IF;
  IF NEW.vrpromo <> OLD.vrpromo THEN
    INSERT INTO historico_dinamico (campo, valor_anterior, valor_atual, tabela, data, codoperador, codempresa, chave, valor_chave, historico)
    VALUES ('VRPROMO', apollo_num_oracle(OLD.vrpromo), apollo_num_oracle(NEW.vrpromo), 'MULTI_PRECO', now(), v_operador, NEW.idempresa, 'IDPRODUTO', NEW.idproduto::text, 'Alteracao do Valor de Promoção');
  END IF;
  IF NEW.vrvenda <> OLD.vrvenda THEN
    INSERT INTO historico_dinamico (campo, valor_anterior, valor_atual, tabela, data, codoperador, codempresa, chave, valor_chave, historico)
    VALUES ('VRVENDA', apollo_num_oracle(OLD.vrvenda), apollo_num_oracle(NEW.vrvenda), 'MULTI_PRECO', now(), v_operador, NEW.idempresa, 'IDPRODUTO', NEW.idproduto::text, 'Alteracao do Valor de Venda');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_custo_multi_preco ON multi_preco;
CREATE TRIGGER update_custo_multi_preco AFTER UPDATE ON multi_preco FOR EACH ROW EXECUTE FUNCTION trg_update_custo_multi_preco();
