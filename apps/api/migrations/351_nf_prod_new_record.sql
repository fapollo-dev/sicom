-- O ITEM NOVO DA NF como o legado o cria (`cdsItensNotaNewRecord`, udmNF.pas:4758-4860): `ZeroToFields` zera TODO campo numérico
-- do item e o NewRecord põe as constantes. Na produção (itens de 2026, só leitura), as 72 colunas abaixo — que a tela do Apollo
-- não gerencia — nunca ficam NULL nos itens criados pelo NewRecord (59.099 de 60.717 de entrada e 8.475 de 8.568 de saída; o resto veio
-- de outro caminho, sem o NewRecord, e fica NULL); o Apollo as deixava NULL. O DEFAULT da coluna é o mesmo efeito em todo caminho que
-- insere o item (a tela, a importação do XML, as inclusões por pedido/scrap/troca) e não mexe no que a carga traz.
ALTER TABLE nf_prod ALTER COLUMN vrcustoreal SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN markup SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vrpis SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN frete2 SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN markupl SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN markupl2 SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN creditoicm SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN creditopiscofins SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN debitoicm SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vendaliq SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN lucrobrutov SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN lucrobrutop SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN despopv SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN lucroliqv SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN lucroliqp SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN imprend SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN contsocial SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN margeml2v SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN despextra SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN custo_real_unit SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN ultvenda SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN ultcusto SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vrcustorep SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN pmz SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vrvendasug SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vrcustocsi SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vicmsufdest SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vicmsufremet SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vfcpufdest SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vricms_stexterno SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vrbase_stexterno SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN produc_peso_liq_exp SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN produc_peso_bruto_exp SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN fcp_bc SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN icms_uf_dest_bc SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN icms_nota_valor SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN icms_nota_bc SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN mva_ajustado SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN icms_aliq_nota SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN icms_st_aliq_nota SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN icms_red_bc_nota SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN icms_st_red_bc_nota SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN total_produto_nota SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN qtd_nota SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN ipi_nota SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN seguro_nota SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN frete_nota SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN outras_despesas_nota SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN desconto_nota SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vricms_stexterno_separadonf SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN fcp_aliquota_st SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN fcp_valor_st SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN fcp_bc_st SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN fcp_aliquota_st_ret SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN fcp_valor_st_ret SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN fcp_bc_st_ret SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vricms_desonerado SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vrcustoajustenf SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vrbasecalculoicm_calc SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vricm_calc SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vrajcustodec47530 SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN ipi_devolucao SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN ipi_devolucao_perc_devol SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN ipi_devolucao_nota SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vrsaldoflex SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vrcomissao SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN ultcustorep SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vrcredsn SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN aliqcredsn SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vrfrete SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN custo_recalculo_bonif SET DEFAULT 0;
ALTER TABLE nf_prod ALTER COLUMN vrcfop_abatido SET DEFAULT 0;

-- as constantes do NewRecord (e do binário novo), com o dado de 2026:
ALTER TABLE nf_prod ALTER COLUMN item_perda_total SET DEFAULT 'N';           -- udmNF.pas:4856 — 'N' em 59.099 + 8.475
ALTER TABLE nf_prod ALTER COLUMN atualiza_multipreco_decomp SET DEFAULT 'S'; -- udmNF.pas:4857 — o 'N' só vem da decomposição
ALTER TABLE nf_prod ALTER COLUMN destacicmssn SET DEFAULT 'N';               -- binário novo — 'N' em 59.099 + 8.475
ALTER TABLE nf_prod ALTER COLUMN beneficio SET DEFAULT 2;                    -- 2 = sem benefício (uItensNF.dfm:3843) em 59.099 + 8.475;
                                                                              -- o fonte de 2020 punha 1, o binário novo põe 2
ALTER TABLE nf_prod ALTER COLUMN decomposicao SET DEFAULT 'N';               -- binário novo — 'N' em 60.564 + 8.436 (nenhum 'S' na entrada)
ALTER TABLE nf_prod ALTER COLUMN origem_estoque SET DEFAULT 'E';             -- 'E' em 100% dos itens de 2026
