-- 189 — `historico_prod.qtde` NOT NULL: o kardex do legado aceita linha sem quantidade (é a segunda coluna da
-- mesma tabela, depois de `tipo` na mig 188). Movimento histórico não se descarta nem se inventa quantidade.
ALTER TABLE historico_prod ALTER COLUMN qtde DROP NOT NULL;
