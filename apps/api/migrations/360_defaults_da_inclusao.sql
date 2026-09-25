-- O conferidor de colunas não escritas (tools/cutover/conferir-colunas-nao-escritas.py, rodado em 25/09/2026): colunas que a linha
-- nascida no legado traz preenchidas e a nascida no Apollo deixaria nulas.
-- (1) DEFAULTs do Oracle que o destino não tem (a mesma classe da mig 345 — colunas acrescentadas depois dela):
ALTER TABLE parceiros ALTER COLUMN perc_aliquota_issqn_sai SET DEFAULT 0;
ALTER TABLE parceiros ALTER COLUMN perc_aliquota_ir_sai SET DEFAULT 0;
ALTER TABLE parceiros ALTER COLUMN perc_aliquota_funr_sai SET DEFAULT 0;
ALTER TABLE parceiros ALTER COLUMN perc_aliquota_senar_sai SET DEFAULT 0;
ALTER TABLE parceiros ALTER COLUMN dispensado_coleta SET DEFAULT 'N';
ALTER TABLE parceiros ALTER COLUMN dispensado_pedido_compra SET DEFAULT 'N';
-- (2) o que a inclusão do binário novo grava (sem DEFAULT no Oracle; constante nas 2.000 linhas mais novas):
ALTER TABLE nf_prod_ibscbs ALTER COLUMN codcclass_trib_ncm_anexos SET DEFAULT 0;   -- 0 em 96,5% (o resto, a classificação do anexo)
ALTER TABLE agenda_promocao ALTER COLUMN liberar_agenda_app SET DEFAULT 'N';       -- 'N' em 99,7% (o app libera depois)
ALTER TABLE receita_prod ALTER COLUMN fatorcxprod_util SET DEFAULT 1;               -- 1 em 100%
ALTER TABLE itens_producao_receita ALTER COLUMN fator_conversao_cx_prod SET DEFAULT 1;       -- 1 em 98,6%
ALTER TABLE itens_producao_receita ALTER COLUMN fator_conversao_cx_prod_util SET DEFAULT 1;  -- 1 em 98,6%
ALTER TABLE cotacao_prod ALTER COLUMN qtdeatual SET DEFAULT 0;                      -- 0 em 99,8%
ALTER TABLE cotacao_prod ALTER COLUMN valorcotacao SET DEFAULT 0;                   -- 0 em 99,8%
ALTER TABLE cheque ALTER COLUMN qtdechq SET DEFAULT 1;                              -- 1 em 11 de 11
