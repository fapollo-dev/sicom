-- 172 — FOLDS da auditoria adversarial dos cortes 166-171 (leva 1: o que trava a CARGA ou mexe em estoque).
--
-- 1) DUAS UNICIDADES INVENTADAS que o golden viola — as duas rejeitariam linhas no cutover:
--    • `nf_prod_lote (codnfprod, coalesce(lote,''))` (mig 169): no Oracle a única constraint de NF_PROD_LOTE é a
--      PK em CODNFPRODLOTE. O dado tem **1.833 grupos (CODNFPROD, LOTE) repetidos = 11.985 linhas**, e em 1.818
--      deles as cópias têm DTVALIDADE DIFERENTE (ex.: CODNFPROD 395100 / LOTE '0110' com 4.096 linhas e 7
--      validades). Carregar as 56.521 linhas rejeitaria 10.152.
--    • `inventario (codinvent, idproduto)` (mig 090, `ux_inventario_produto`): INVENTARIO no Oracle tem PK só em
--      SEQUENCIA e o golden tem **2.818 grupos repetidos = 13.804 linhas**. Além da carga, o índice quebra em
--      runtime o "Importar Balanço" da foto 41 ('CORRECAO ESTOQUE DUPLICAÇÃO'), que tem 57 produtos repetidos.
--    Nos dois casos a unicidade era invenção nossa: sai.
DROP INDEX IF EXISTS ux_nf_prod_lote_item_lote;
DROP INDEX IF EXISTS ux_inventario_produto;
-- o índice de leitura por item continua (agora ele é o único de codnfprod, e deixa de ser redundante)
CREATE INDEX IF NOT EXISTS ix_nf_prod_lote_item ON nf_prod_lote (codnfprod);

-- 2) convenção do repo que faltou na mig 171: PK explícita exige avançar a sequência, senão o CRUD de motivos
--    colide com o 999 quando chegar lá (mesmo padrão das migs 059:34 e 116:17).
SELECT setval('seq_motivos_operacao', GREATEST((SELECT COALESCE(MAX(codmotivoop), 1) FROM motivos_operacao), 1), true);

-- 3) o ajuste do zeramento pode ser do DEPÓSITO (destino='DEPOSITO'), e o estorno precisa saber disso —
--    ver `ajuste-estoque.service.ts`. Nada a criar aqui: `estoque_dep` já existe (mig 166).
