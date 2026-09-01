-- 190 — RESTAURA o NOT NULL de `historico_prod.tipo` e `.qtde`, afrouxados nas migs 188 e 189.
--
-- Diagnóstico errado meu, corrigido: eu tratei "coluna chega vazia na carga" como "o legado permite nulo" e
-- derrubei a obrigatoriedade duas vezes na mesma tabela. Não era isso — **as colunas não existem no legado com
-- esses nomes**. O kardex de lá é nomeado por *alteração* e *atual*:
--     qtde_alter → qtde · qtde_atual → saldo_novo · origem_documento → origem
-- e mais duas que o nosso modelo tem e o legado não guarda, agora DERIVADAS na extração:
--     saldo_anterior = qtde_atual − qtde_alter   (o legado guarda o saldo depois e o delta)
--     tipo           = 'S' se o delta é negativo, senão 'E'
--
-- Com o mapa certo as colunas chegam preenchidas, então a garantia volta: o kardex não deve aceitar movimento
-- sem tipo nem sem quantidade — é a tabela que sustenta a Ficha de Movimentação e a conferência de estoque.
ALTER TABLE historico_prod ALTER COLUMN tipo SET NOT NULL;
ALTER TABLE historico_prod ALTER COLUMN qtde SET NOT NULL;
