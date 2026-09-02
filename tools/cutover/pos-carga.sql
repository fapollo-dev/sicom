-- PÓS-CARGA — o que o Apollo precisa ter no banco e o LEGADO não tem.
--
-- O carregador TRUNCA cada tabela antes de carregar (o ensaio parte do vazio), e com isso leva junto as linhas que
-- as nossas migrations semeiam. Quase tudo que semeamos o legado também tem (vem na carga). O que fica aqui é a
-- exceção declarada: dado que o legado NÃO tem e o Apollo exige — reaplicado no fim da carga, idempotente.
-- Este arquivo é lido por `apps/api/scripts/carregar-cutover.ts` depois da última tabela e ANTES da conferência de
-- órfãos, para o que ele semeia contar como pai.

-- motivo 999: o legado grava CODMOTIVO = 999 em milhares de ajustes de estoque (4.874 em produção) e não tem a
-- linha em MOTIVOS_OPERACAO — lá não há FK. Aqui `ajuste_estoque.codmotivo` REFERENCES motivos_operacao, então a
-- linha precisa existir (é a mesma da mig 171, que a carga apaga ao truncar a tabela).
INSERT INTO motivos_operacao (codmotivoop, descricao)
SELECT 999, 'AJUSTE DE INVENTARIO (codigo 999 do legado)'
WHERE NOT EXISTS (SELECT 1 FROM motivos_operacao WHERE codmotivoop = 999);
