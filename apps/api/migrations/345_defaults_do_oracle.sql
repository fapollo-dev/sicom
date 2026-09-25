-- 345 — os DEFAULTs das colunas do Oracle que o destino não tinha (ou tinha outro). O legado grava 'N'/0/'S' nas linhas que o código
-- não preenche porque a COLUNA tem DEFAULT (user_tab_columns.data_default, produção 25/09/2026); no destino ela nascia NULL. Achado pelo
-- `tools/cutover/conferir-colunas-nao-escritas.py`: ex. as retenções de saída do parceiro (HAB_RET_*_NF_SAI 'N' em 2.000 de 2.000
-- parceiros recentes), CALCULA_PAUTA_ST do CFOP, GERAR_M220_M620 do NCM e do produto, PERMITEALTERACAO do lote de preço. As quatro que
-- divergiam são escritas pelo código sempre — o DEFAULT só passa a ser o do legado.

ALTER TABLE cfop ALTER COLUMN calcula_pauta_st SET DEFAULT 'N';
ALTER TABLE cfop ALTER COLUMN dispensado_coleta SET DEFAULT 'N';
ALTER TABLE cfop ALTER COLUMN dispensado_pedido_compra SET DEFAULT 'N';
ALTER TABLE class_trib ALTER COLUMN ind_gtrib_regular SET DEFAULT 0;
ALTER TABLE class_trib ALTER COLUMN ind_cred_pres SET DEFAULT 0;
ALTER TABLE class_trib ALTER COLUMN ind_mono SET DEFAULT 0;
ALTER TABLE class_trib ALTER COLUMN ind_mono_reten SET DEFAULT 0;
ALTER TABLE class_trib ALTER COLUMN ind_mono_ret SET DEFAULT 0;
ALTER TABLE class_trib ALTER COLUMN ind_mono_dif SET DEFAULT 0;
ALTER TABLE config_import_conciliador ALTER COLUMN buscansu SET DEFAULT 'S';  -- era 'N'::bpchar
ALTER TABLE config_import_conciliador ALTER COLUMN buscaautorizacao SET DEFAULT 'S';  -- era 'N'::bpchar
ALTER TABLE configuracoes ALTER COLUMN passwordchar SET DEFAULT 'N';
ALTER TABLE estoque ALTER COLUMN qtde_cong SET DEFAULT 0;
ALTER TABLE estoque ALTER COLUMN qtde_bk SET DEFAULT 0;
ALTER TABLE estoque_dep ALTER COLUMN qtde_bk SET DEFAULT 0;
ALTER TABLE estoque_dep ALTER COLUMN qtde_cong SET DEFAULT 0;
ALTER TABLE lote_preco ALTER COLUMN permitealteracao SET DEFAULT 'N';
ALTER TABLE ncm ALTER COLUMN gerar_m220_m620 SET DEFAULT 'N';
ALTER TABLE ncm_lc224_2025 ALTER COLUMN tipo_match SET DEFAULT 'P';
ALTER TABLE ncm_lc224_2025 ALTER COLUMN cst_pis_sai SET DEFAULT '06';
ALTER TABLE ncm_lc224_2025 ALTER COLUMN cst_cofins_sai SET DEFAULT '06';
ALTER TABLE ncm_lc224_2025 ALTER COLUMN cst_pis_ent SET DEFAULT '73';
ALTER TABLE ncm_lc224_2025 ALTER COLUMN cst_cofins_ent SET DEFAULT '73';
ALTER TABLE nf ALTER COLUMN calculapeso SET DEFAULT 'S';
ALTER TABLE nf_prod ALTER COLUMN ind_deduz_deson SET DEFAULT 'N';
ALTER TABLE nfe_inutilizada ALTER COLUMN tiponf SET DEFAULT 'NFE';  -- era 'NFCE'::character varying
ALTER TABLE parceiros ALTER COLUMN hab_ret_pis_nf_sai SET DEFAULT 'N';
ALTER TABLE parceiros ALTER COLUMN hab_ret_cofins_nf_sai SET DEFAULT 'N';
ALTER TABLE parceiros ALTER COLUMN hab_ret_csll_nf_sai SET DEFAULT 'N';
ALTER TABLE parceiros ALTER COLUMN hab_ret_ir_nf_sai SET DEFAULT 'N';
ALTER TABLE parceiros ALTER COLUMN hab_ret_inss_nf_sai SET DEFAULT 'N';
ALTER TABLE parceiros ALTER COLUMN hab_ret_issqn_nf_sai SET DEFAULT 'N';
ALTER TABLE parceiros ALTER COLUMN hab_ret_funrural_nf_sai SET DEFAULT 'N';
ALTER TABLE parceiros ALTER COLUMN hab_ret_senar_nf_sai SET DEFAULT 'N';
ALTER TABLE parceiros ALTER COLUMN libera_digitar_retencoes_sai SET DEFAULT 'N';
ALTER TABLE parceiros ALTER COLUMN retencao_cooperativa_sai SET DEFAULT 'N';
ALTER TABLE parceiros ALTER COLUMN perc_aliquota_issqn_sai SET DEFAULT 0;
ALTER TABLE parceiros ALTER COLUMN perc_aliquota_ir_sai SET DEFAULT 0;
ALTER TABLE parceiros ALTER COLUMN perc_aliquota_funr_sai SET DEFAULT 0;
ALTER TABLE parceiros ALTER COLUMN perc_aliquota_senar_sai SET DEFAULT 0;
ALTER TABLE parceiros ALTER COLUMN dispensado_coleta SET DEFAULT 'N';
ALTER TABLE parceiros ALTER COLUMN dispensado_pedido_compra SET DEFAULT 'N';
ALTER TABLE pc_tab_ajuste_cofins ALTER COLUMN ativo SET DEFAULT 'S';
ALTER TABLE pc_tab_ajuste_pis ALTER COLUMN ativo SET DEFAULT 'S';
ALTER TABLE pedido_compra_empresa ALTER COLUMN pce_frete SET DEFAULT 0;
ALTER TABLE pedido_compra_qtde ALTER COLUMN digitacao_fechada SET DEFAULT 'N';
ALTER TABLE plc ALTER COLUMN flg_perda SET DEFAULT 'N';
ALTER TABLE produtos ALTER COLUMN gerar_m220_m620 SET DEFAULT 'N';
ALTER TABLE produtos ALTER COLUMN compqtde SET DEFAULT 0;
ALTER TABLE produtos ALTER COLUMN compfator SET DEFAULT 0;
ALTER TABLE saldo_operador ALTER COLUMN gera_saldo SET DEFAULT 'S';  -- era 'N'::bpchar
ALTER TABLE troca ALTER COLUMN status SET DEFAULT 0;
