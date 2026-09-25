-- O CABEÇALHO NOVO DA NF como o legado o cria (`cdsNotaNewRecord`, udmNF.pas:5586-5604): `ZeroToFields(cdsNota)` zera todo campo
-- numérico e o NewRecord põe as constantes. Na produção (notas de 2026, só leitura) as 40 colunas abaixo nunca ficam NULL nas notas
-- criadas pelo NewRecord (6.447 de 6.521 de entrada e 754 de 771 de saída; o resto veio de outro caminho — a importação em massa — e
-- fica NULL). O DEFAULT da coluna tem o mesmo efeito em todo caminho que cria a nota e não mexe no que a carga traz.
ALTER TABLE nf ALTER COLUMN totalrepicm SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN totalvroutros SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN totalprodst SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN totalbaseicmt SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN totaloutrasdesp SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN totaldescfinal SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN qtdetransp SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN pesobruto SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN pesoliquido SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN totalfrete2 SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN valorservico SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN issqn SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN valorissqn SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN qtde SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN pis_nfe SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN cofins_nfe SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN taxa_importacao_nfe SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN vtoticmsufdest SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN vtoticmsufremet SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN vtotfcpufdest SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN totalbase_stexterno SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN totalbaseicmsrep SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_icms_uf_dest_bc SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_fcp_bc SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_fcp SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_streal SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_icms_nota_valor SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_icms_nota_bc SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN fisco_emit_dar_valor SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN totalicm_stexterno_sepnf SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_fcp_valor_st SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_fcp_valor_st_ret SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_icmsdeson SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_bonificado SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_desc_acordo SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN totalipi_devolucao SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_desc_pedido SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_vrcfop_abatido SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN perc_aliquota_ret_senar SET DEFAULT 0;
ALTER TABLE nf ALTER COLUMN total_ret_senar SET DEFAULT 0;

-- as constantes do NewRecord (e do binário novo), com o dado de 2026:
ALTER TABLE nf ALTER COLUMN stexterno SET DEFAULT 'N';            -- udmNF.pas:5592 — 'N' em 6.521 + 754
ALTER TABLE nf ALTER COLUMN sequencia_nfe SET DEFAULT 'S';        -- :5593
ALTER TABLE nf ALTER COLUMN rateio_ipi SET DEFAULT 'N';           -- :5596
ALTER TABLE nf ALTER COLUMN rateio_ipi_devolucao SET DEFAULT 'N'; -- :5597
ALTER TABLE nf ALTER COLUMN rateio_st SET DEFAULT 'N';            -- :5598
ALTER TABLE nf ALTER COLUMN tpemissao SET DEFAULT 1;              -- :5599 — 1 em 100%
ALTER TABLE nf ALTER COLUMN complemento SET DEFAULT 'N';          -- :5600
ALTER TABLE nf ALTER COLUMN versaoxml SET DEFAULT '400';           -- :5603 — 400 em 100%
ALTER TABLE nf ALTER COLUMN nota_neutra SET DEFAULT 'N';          -- binário novo — 'N' em 6.430 + 754
ALTER TABLE nf ALTER COLUMN abater_icms_deson SET DEFAULT 'N';    -- binário novo — 'N' em 6.447 + 754
