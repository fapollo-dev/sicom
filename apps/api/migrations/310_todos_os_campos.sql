-- 310 — TODOS OS CAMPOS (ordem do usuário, 23/09/2026: "tem que ter todos os campos").
--
-- Toda coluna das tabelas do legado que migram passa a existir no destino, com o tipo do Oracle (NUMBER(p,s) → numeric(p,s),
-- VARCHAR2(n) → varchar(n), CHAR(n) → char(n), DATE/TIMESTAMP → timestamptz, CLOB → text, BLOB → bytea). A carga casa pelo
-- nome, então cada uma vem sozinha; as telas as preservam ao salvar (colunas não gerenciadas). Levantadas contra a
-- PRODUÇÃO: 1.319 faltavam em 82 tabelas — 7 eram só nome diferente e viraram de-para na carga (entre elas a série da NF-e e a lista de
-- escopos das 842 configurações); as outras estão aqui. Gerado do dicionário do Oracle (user_tab_columns), em ordem de
-- coluna, uma tabela por bloco.

-- adiantamento_forn ← ADIANTAMENTO_FORN (585 linhas; 2 colunas)
ALTER TABLE adiantamento_forn
  ADD COLUMN IF NOT EXISTS old_codparceiro numeric(10,0),
  ADD COLUMN IF NOT EXISTS codmapa numeric(10,0);

-- agenda_promocao ← AGENDA_PROMOCAO (3.744 linhas; 4 colunas)
ALTER TABLE agenda_promocao
  ADD COLUMN IF NOT EXISTS dataexecucao timestamptz,
  ADD COLUMN IF NOT EXISTS codparceiro numeric(10,0),
  ADD COLUMN IF NOT EXISTS idsituacao_nf numeric(10,0),
  ADD COLUMN IF NOT EXISTS liberar_agenda_app char(1);

-- agenda_promocao_itens ← AGENDA_PROMOCAO_ITENS (45.532 linhas; 6 colunas)
ALTER TABLE agenda_promocao_itens
  ADD COLUMN IF NOT EXISTS empresas varchar(250),
  ADD COLUMN IF NOT EXISTS atualizacao_grupo char(1),
  ADD COLUMN IF NOT EXISTS codgrupo numeric(10,0),
  ADD COLUMN IF NOT EXISTS opcoes char(1),
  ADD COLUMN IF NOT EXISTS atualizacao_grupo_anterior varchar(1),
  ADD COLUMN IF NOT EXISTS descricao_promocao varchar(255);

-- ajuste_estoque ← AJUSTE_ESTOQUE (14.248 linhas; 3 colunas)
ALTER TABLE ajuste_estoque
  ADD COLUMN IF NOT EXISTS data timestamptz,
  ADD COLUMN IF NOT EXISTS minimo numeric(13,3),
  ADD COLUMN IF NOT EXISTS maximo numeric(13,3);

-- apagar ← APAGAR (54.990 linhas; 41 colunas)
ALTER TABLE apagar
  ADD COLUMN IF NOT EXISTS logado varchar(20),
  ADD COLUMN IF NOT EXISTS codcentrocusto numeric(10,0),
  ADD COLUMN IF NOT EXISTS convenio char(1),
  ADD COLUMN IF NOT EXISTS idlote numeric(10,0),
  ADD COLUMN IF NOT EXISTS old_codparceiro numeric(10,0),
  ADD COLUMN IF NOT EXISTS form varchar(100),
  ADD COLUMN IF NOT EXISTS operacao_convenio_funcionario varchar(1),
  ADD COLUMN IF NOT EXISTS codconvenio numeric(10,0),
  ADD COLUMN IF NOT EXISTS status_pendencia char(1),
  ADD COLUMN IF NOT EXISTS codoperador_aceite_pendencia numeric(10,0),
  ADD COLUMN IF NOT EXISTS data_aceite_pendencia timestamptz,
  ADD COLUMN IF NOT EXISTS bloqueio varchar(1),
  ADD COLUMN IF NOT EXISTS geradocartaoproprio varchar(1),
  ADD COLUMN IF NOT EXISTS codapgcartao numeric(10,0),
  ADD COLUMN IF NOT EXISTS codgrupo_fcx numeric(10,0),
  ADD COLUMN IF NOT EXISTS contabilnf char(1),
  ADD COLUMN IF NOT EXISTS codbarrasblt varchar(48),
  ADD COLUMN IF NOT EXISTS remessa_gerada varchar(1),
  ADD COLUMN IF NOT EXISTS codparceirocedente numeric(10,0),
  ADD COLUMN IF NOT EXISTS lote_remessa numeric(10,0),
  ADD COLUMN IF NOT EXISTS retorno_op varchar(2),
  ADD COLUMN IF NOT EXISTS percjuros numeric(13,2),
  ADD COLUMN IF NOT EXISTS mora numeric(13,4),
  ADD COLUMN IF NOT EXISTS cod_agenda_prev_pagto numeric(10,0),
  ADD COLUMN IF NOT EXISTS baixa_autorizada varchar(1),
  ADD COLUMN IF NOT EXISTS codoperador_autorizada numeric(10,0),
  ADD COLUMN IF NOT EXISTS data_autorizada timestamptz,
  ADD COLUMN IF NOT EXISTS obs_autorizada varchar(500),
  ADD COLUMN IF NOT EXISTS codoperador_auto_paga numeric(10,0),
  ADD COLUMN IF NOT EXISTS data_auto_paga timestamptz,
  ADD COLUMN IF NOT EXISTS obs_auto_paga varchar(500),
  ADD COLUMN IF NOT EXISTS baixa_auto_paga varchar(1),
  ADD COLUMN IF NOT EXISTS codoperador_auto_trans numeric(10,0),
  ADD COLUMN IF NOT EXISTS data_auto_trans timestamptz,
  ADD COLUMN IF NOT EXISTS obs_auto_trans varchar(500),
  ADD COLUMN IF NOT EXISTS baixa_auto_trans varchar(1),
  ADD COLUMN IF NOT EXISTS codoperador_autentica_trans numeric(10,0),
  ADD COLUMN IF NOT EXISTS data_autentica_trans timestamptz,
  ADD COLUMN IF NOT EXISTS obs_autentica_trans varchar(500),
  ADD COLUMN IF NOT EXISTS baixa_autentica_trans varchar(1),
  ADD COLUMN IF NOT EXISTS chavenfe varchar(50);

-- apagar_bx ← APAGAR_BX (51.589 linhas; 2 colunas)
ALTER TABLE apagar_bx
  ADD COLUMN IF NOT EXISTS tx_juros numeric(15,2),
  ADD COLUMN IF NOT EXISTS nome_retorno varchar(50);

-- apuracao_pc_det ← APURACAO_PC_DET (193 linhas; 4 colunas)
ALTER TABLE apuracao_pc_det
  ADD COLUMN IF NOT EXISTS apuracao varchar(15),
  ADD COLUMN IF NOT EXISTS descricaobase varchar(200),
  ADD COLUMN IF NOT EXISTS descricaopc varchar(100),
  ADD COLUMN IF NOT EXISTS basecalculoapura numeric(15,2);

-- areceber ← ARECEBER (99.809 linhas; 39 colunas)
ALTER TABLE areceber
  ADD COLUMN IF NOT EXISTS logado varchar(20),
  ADD COLUMN IF NOT EXISTS nropedido varchar(20),
  ADD COLUMN IF NOT EXISTS total numeric(10,2),
  ADD COLUMN IF NOT EXISTS codgrupo numeric(10,0),
  ADD COLUMN IF NOT EXISTS codoperadorman numeric(10,0),
  ADD COLUMN IF NOT EXISTS parcela varchar(10),
  ADD COLUMN IF NOT EXISTS codcx numeric(10,0),
  ADD COLUMN IF NOT EXISTS antecipado char(1),
  ADD COLUMN IF NOT EXISTS lotecob numeric(10,0),
  ADD COLUMN IF NOT EXISTS datalotcob timestamptz,
  ADD COLUMN IF NOT EXISTS txadm numeric(13,2),
  ADD COLUMN IF NOT EXISTS baixado char(1),
  ADD COLUMN IF NOT EXISTS idrds numeric(10,0),
  ADD COLUMN IF NOT EXISTS datatransf timestamptz,
  ADD COLUMN IF NOT EXISTS lotetransf numeric(10,0),
  ADD COLUMN IF NOT EXISTS idlote numeric(10,0),
  ADD COLUMN IF NOT EXISTS desconto numeric(13,2),
  ADD COLUMN IF NOT EXISTS desconto_tipo char(1),
  ADD COLUMN IF NOT EXISTS old_codparceiro numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtfechamentocx timestamptz,
  ADD COLUMN IF NOT EXISTS chave varchar(14),
  ADD COLUMN IF NOT EXISTS status_pendencia char(1),
  ADD COLUMN IF NOT EXISTS codoperador_aceite_pendencia numeric(10,0),
  ADD COLUMN IF NOT EXISTS data_aceite_pendencia timestamptz,
  ADD COLUMN IF NOT EXISTS sequencia numeric(10,0),
  ADD COLUMN IF NOT EXISTS contabilnf char(1),
  ADD COLUMN IF NOT EXISTS nfadicmanual char(1),
  ADD COLUMN IF NOT EXISTS diferenca_pedcomp char(1),
  ADD COLUMN IF NOT EXISTS total_brt numeric(10,2),
  ADD COLUMN IF NOT EXISTS codagenda numeric(10,0),
  ADD COLUMN IF NOT EXISTS codcfo varchar(1),
  ADD COLUMN IF NOT EXISTS importado varchar(1),
  ADD COLUMN IF NOT EXISTS valor_perc_multa char(1),
  ADD COLUMN IF NOT EXISTS codparceiropinheirao numeric(10,0),
  ADD COLUMN IF NOT EXISTS carencia numeric(10,0),
  ADD COLUMN IF NOT EXISTS idintegracao varchar(40),
  ADD COLUMN IF NOT EXISTS dtagendamento timestamptz,
  ADD COLUMN IF NOT EXISTS codoperador_liberacao numeric(10,0),
  ADD COLUMN IF NOT EXISTS qrcodepix varchar(4000);

-- areceber_bx ← ARECEBER_BX (19.225 linhas; 6 colunas)
ALTER TABLE areceber_bx
  ADD COLUMN IF NOT EXISTS codoperador_liberacao_desconto numeric(10,0),
  ADD COLUMN IF NOT EXISTS tx_juros numeric(15,2),
  ADD COLUMN IF NOT EXISTS vr_antecipacao numeric(15,2),
  ADD COLUMN IF NOT EXISTS tx_antecipacao numeric(15,2),
  ADD COLUMN IF NOT EXISTS txmulta numeric(13,2),
  ADD COLUMN IF NOT EXISTS valor_perc_multa char(1);

-- caixa ← CAIXA (239.942 linhas; 3 colunas)
ALTER TABLE caixa
  ADD COLUMN IF NOT EXISTS status char(1),
  ADD COLUMN IF NOT EXISTS old_codparceiro numeric(10,0),
  ADD COLUMN IF NOT EXISTS codmapadesp numeric(10,0);

-- cartao ← CARTAO (2.025.583 linhas; 35 colunas)
ALTER TABLE cartao
  ADD COLUMN IF NOT EXISTS codcx numeric(10,0),
  ADD COLUMN IF NOT EXISTS resumo numeric(10,0),
  ADD COLUMN IF NOT EXISTS datavencimento timestamptz,
  ADD COLUMN IF NOT EXISTS referencia char(1),
  ADD COLUMN IF NOT EXISTS txantecipacao numeric(13,2),
  ADD COLUMN IF NOT EXISTS dtfechamentocx timestamptz,
  ADD COLUMN IF NOT EXISTS tipomodalidade numeric(10,0),
  ADD COLUMN IF NOT EXISTS modalidadeoperadora varchar(100),
  ADD COLUMN IF NOT EXISTS hashpaf varchar(32),
  ADD COLUMN IF NOT EXISTS tipo_conciliacao varchar(100),
  ADD COLUMN IF NOT EXISTS nomearquivoconciliacao varchar(200),
  ADD COLUMN IF NOT EXISTS chave varchar(14),
  ADD COLUMN IF NOT EXISTS conciliadovendas varchar(1),
  ADD COLUMN IF NOT EXISTS tipoconciliacaovendas varchar(100),
  ADD COLUMN IF NOT EXISTS nomearquivoconciliacaovendas varchar(200),
  ADD COLUMN IF NOT EXISTS linhaconciliacaovendas numeric(10,0),
  ADD COLUMN IF NOT EXISTS data_operacao timestamptz,
  ADD COLUMN IF NOT EXISTS sequencia numeric(10,0),
  ADD COLUMN IF NOT EXISTS codmapa numeric(10,0),
  ADD COLUMN IF NOT EXISTS codmaparcb numeric(10,0),
  ADD COLUMN IF NOT EXISTS idnf numeric(10,0),
  ADD COLUMN IF NOT EXISTS idintegracao varchar(40),
  ADD COLUMN IF NOT EXISTS lote_origem numeric(10,0),
  ADD COLUMN IF NOT EXISTS origem char(1),
  ADD COLUMN IF NOT EXISTS idlote_rcb numeric(10,0),
  ADD COLUMN IF NOT EXISTS imp_raf char(1),
  ADD COLUMN IF NOT EXISTS data_insercao timestamptz,
  ADD COLUMN IF NOT EXISTS valor_liquido numeric(13,2),
  ADD COLUMN IF NOT EXISTS tx_aministrativo numeric(13,2),
  ADD COLUMN IF NOT EXISTS remessa_boavista char(1),
  ADD COLUMN IF NOT EXISTS data_remessa_boavista timestamptz,
  ADD COLUMN IF NOT EXISTS data_baixa_arquivo timestamptz,
  ADD COLUMN IF NOT EXISTS remessa_integracao char(1),
  ADD COLUMN IF NOT EXISTS data_remessa_integracao timestamptz,
  ADD COLUMN IF NOT EXISTS inserido varchar(1);

-- cfop ← CFOP (398 linhas; 14 colunas)
ALTER TABLE cfop
  ADD COLUMN IF NOT EXISTS usultalteracao numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS dtcadastro timestamptz,
  ADD COLUMN IF NOT EXISTS aliquota char(3),
  ADD COLUMN IF NOT EXISTS atualiza_venda_nf char(1),
  ADD COLUMN IF NOT EXISTS idpiscofins numeric(10,0),
  ADD COLUMN IF NOT EXISTS dispensado_pedido_compra varchar(1),
  ADD COLUMN IF NOT EXISTS nao_gera_sped_contribuicao char(1),
  ADD COLUMN IF NOT EXISTS informaiest char(1),
  ADD COLUMN IF NOT EXISTS nao_atualiza_forn_prod char(1),
  ADD COLUMN IF NOT EXISTS filtro_prec_nf char(1),
  ADD COLUMN IF NOT EXISTS transferencia char(1),
  ADD COLUMN IF NOT EXISTS codclass_trib numeric(10,0),
  ADD COLUMN IF NOT EXISTS calcula_pauta_st varchar(1);

-- codauxiliar ← CODAUXILIAR (1.085 linhas; 3 colunas)
ALTER TABLE codauxiliar
  ADD COLUMN IF NOT EXISTS porcentagem_valor numeric(15,2),
  ADD COLUMN IF NOT EXISTS dtcadastro timestamptz,
  ADD COLUMN IF NOT EXISTS dtalteracao timestamptz;

-- composicao ← COMPOSICAO (61 linhas; 1 colunas)
ALTER TABLE composicao
  ADD COLUMN IF NOT EXISTS idempresa numeric;

-- config_balanca ← CONFIG_BALANCA (2 linhas; 1 colunas)
ALTER TABLE config_balanca
  ADD COLUMN IF NOT EXISTS exporta_rdc429 char(1);

-- config_plano_contas ← CONFIG_PLANO_CONTAS (1 linhas; 12 colunas)
ALTER TABLE config_plano_contas
  ADD COLUMN IF NOT EXISTS codconfig numeric(10,0),
  ADD COLUMN IF NOT EXISTS ndig_1 numeric(10,0),
  ADD COLUMN IF NOT EXISTS ndig_2 numeric(10,0),
  ADD COLUMN IF NOT EXISTS ndig_3 numeric(10,0),
  ADD COLUMN IF NOT EXISTS ndig_4 numeric(10,0),
  ADD COLUMN IF NOT EXISTS ndig_5 numeric(10,0),
  ADD COLUMN IF NOT EXISTS ndig_6 numeric(10,0),
  ADD COLUMN IF NOT EXISTS ndig_7 numeric(10,0),
  ADD COLUMN IF NOT EXISTS ndig_8 numeric(10,0),
  ADD COLUMN IF NOT EXISTS usultalteracao numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS dtcadastro timestamptz;

-- configuracoes ← CONFIGURACOES (842 linhas; 4 colunas)
ALTER TABLE configuracoes
  ADD COLUMN IF NOT EXISTS modulos varchar(100),
  ADD COLUMN IF NOT EXISTS mascara varchar(250),
  ADD COLUMN IF NOT EXISTS tamanhovalor numeric,
  ADD COLUMN IF NOT EXISTS passwordchar varchar(1);

-- contabilista ← CONTABILISTA (4 linhas; 3 colunas)
ALTER TABLE contabilista
  ADD COLUMN IF NOT EXISTS num varchar(10),
  ADD COLUMN IF NOT EXISTS fone varchar(20),
  ADD COLUMN IF NOT EXISTS fax varchar(20);

-- contas_bancarias ← CONTAS_BANCARIAS (36 linhas; 4 colunas)
ALTER TABLE contas_bancarias
  ADD COLUMN IF NOT EXISTS codoperadorchaveamento numeric(10,0),
  ADD COLUMN IF NOT EXISTS nroconta_ofx varchar(50),
  ADD COLUMN IF NOT EXISTS estorno_dthr_baixa char(1),
  ADD COLUMN IF NOT EXISTS bloq_trans_contas char(1);

-- contas_bancarias_op ← CONTAS_BANCARIAS_OP (206 linhas; 5 colunas)
ALTER TABLE contas_bancarias_op
  ADD COLUMN IF NOT EXISTS habilitar_tranfer varchar(1),
  ADD COLUMN IF NOT EXISTS habiltiar_libe_moviment varchar(1),
  ADD COLUMN IF NOT EXISTS habiltiar_chavear_fec_cxa varchar(1),
  ADD COLUMN IF NOT EXISTS habiltiar_detalhar_conta varchar(1),
  ADD COLUMN IF NOT EXISTS habiltiar_conci_ofx varchar(1);

-- cotacao ← COTACAO (39 linhas; 1 colunas)
ALTER TABLE cotacao
  ADD COLUMN IF NOT EXISTS empresas varchar(30);

-- cotacao_forn_itens ← COTACAO_FORN_ITENS (16.014 linhas; 1 colunas)
ALTER TABLE cotacao_forn_itens
  ADD COLUMN IF NOT EXISTS dataman timestamptz;

-- cotacao_prod ← COTACAO_PROD (5.179 linhas; 6 colunas)
ALTER TABLE cotacao_prod
  ADD COLUMN IF NOT EXISTS qtdeatual numeric(13,3),
  ADD COLUMN IF NOT EXISTS valorcotacao numeric(15,4),
  ADD COLUMN IF NOT EXISTS vlrembalagem numeric(12,4),
  ADD COLUMN IF NOT EXISTS vlrunitario numeric(12,4),
  ADD COLUMN IF NOT EXISTS qtdtotal numeric(13,2),
  ADD COLUMN IF NOT EXISTS obs varchar(500);

-- det_aliquota ← DET_ALIQUOTA (195 linhas; 3 colunas)
ALTER TABLE det_aliquota
  ADD COLUMN IF NOT EXISTS codcontabilaprazo varchar(30),
  ADD COLUMN IF NOT EXISTS codcontabilavista varchar(30),
  ADD COLUMN IF NOT EXISTS descricaoaliquota varchar(100);

-- devolucao_vendas ← DEVOLUCAO_VENDAS (3.658 linhas; 2 colunas)
ALTER TABLE devolucao_vendas
  ADD COLUMN IF NOT EXISTS codvenda numeric(10,0),
  ADD COLUMN IF NOT EXISTS coditem numeric(10,0);

-- diario ← DIARIO (1.769.169 linhas; 6 colunas)
ALTER TABLE diario
  ADD COLUMN IF NOT EXISTS usultalteracao numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS dtcadastro timestamptz,
  ADD COLUMN IF NOT EXISTS codperiodo numeric(10,0),
  ADD COLUMN IF NOT EXISTS codcc numeric(10,0),
  ADD COLUMN IF NOT EXISTS ccusto numeric(10,0);

-- empresas ← EMPRESAS (5 linhas; 203 colunas)
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS senhaadmin varchar(30),
  ADD COLUMN IF NOT EXISTS senhadesc varchar(30),
  ADD COLUMN IF NOT EXISTS senhacancel varchar(30),
  ADD COLUMN IF NOT EXISTS senhagaveta varchar(30),
  ADD COLUMN IF NOT EXISTS fone2 varchar(20),
  ADD COLUMN IF NOT EXISTS responsavel varchar(80),
  ADD COLUMN IF NOT EXISTS mascaraplc varchar(30),
  ADD COLUMN IF NOT EXISTS numeitensnota numeric(10,0),
  ADD COLUMN IF NOT EXISTS atucomposicao char(1),
  ADD COLUMN IF NOT EXISTS campocomposicao varchar(7),
  ADD COLUMN IF NOT EXISTS logada char(1),
  ADD COLUMN IF NOT EXISTS dtautualizacao timestamptz,
  ADD COLUMN IF NOT EXISTS despfederativas numeric(13,2),
  ADD COLUMN IF NOT EXISTS contacofre numeric(10,0),
  ADD COLUMN IF NOT EXISTS cctesouraria numeric(10,0),
  ADD COLUMN IF NOT EXISTS codcentralbalcao numeric(10,0),
  ADD COLUMN IF NOT EXISTS faturapedidodireto char(1),
  ADD COLUMN IF NOT EXISTS ccmultajuros numeric(10,0),
  ADD COLUMN IF NOT EXISTS filtrapdv char(3),
  ADD COLUMN IF NOT EXISTS tolerancianf numeric(13,2),
  ADD COLUMN IF NOT EXISTS ccdesconto numeric(10,0),
  ADD COLUMN IF NOT EXISTS ccacresjuro numeric(10,0),
  ADD COLUMN IF NOT EXISTS validacaixa char(1),
  ADD COLUMN IF NOT EXISTS perfilsped char(1),
  ADD COLUMN IF NOT EXISTS indice_ativ numeric(10,0),
  ADD COLUMN IF NOT EXISTS tp_ligacao numeric(10,0),
  ADD COLUMN IF NOT EXISTS grupotensao char(2),
  ADD COLUMN IF NOT EXISTS email varchar(100),
  ADD COLUMN IF NOT EXISTS senha_email varchar(30),
  ADD COLUMN IF NOT EXISTS smtp varchar(100),
  ADD COLUMN IF NOT EXISTS porta numeric(10,0),
  ADD COLUMN IF NOT EXISTS assunto varchar(150),
  ADD COLUMN IF NOT EXISTS texto varchar(600),
  ADD COLUMN IF NOT EXISTS nome varchar(200),
  ADD COLUMN IF NOT EXISTS txadm numeric(13,2),
  ADD COLUMN IF NOT EXISTS email_contador char(1),
  ADD COLUMN IF NOT EXISTS trigger_estoque char(1),
  ADD COLUMN IF NOT EXISTS saida_operadora char(1),
  ADD COLUMN IF NOT EXISTS preen_ncm char(1),
  ADD COLUMN IF NOT EXISTS faturamentopedido char(1),
  ADD COLUMN IF NOT EXISTS insc_mun varchar(30),
  ADD COLUMN IF NOT EXISTS junta_comercial varchar(30),
  ADD COLUMN IF NOT EXISTS data_abertura timestamptz,
  ADD COLUMN IF NOT EXISTS cpf varchar(20),
  ADD COLUMN IF NOT EXISTS ramoatividade char(1),
  ADD COLUMN IF NOT EXISTS numero_historico numeric(10,0),
  ADD COLUMN IF NOT EXISTS separador_duplicata char(1),
  ADD COLUMN IF NOT EXISTS modelo_duplicata numeric(10,0),
  ADD COLUMN IF NOT EXISTS senhareducao varchar(30),
  ADD COLUMN IF NOT EXISTS pedcompra char(1),
  ADD COLUMN IF NOT EXISTS contacmv numeric(10,0),
  ADD COLUMN IF NOT EXISTS sincroniza_preco_nf char(1),
  ADD COLUMN IF NOT EXISTS contrapartida varchar(10),
  ADD COLUMN IF NOT EXISTS cta_caixa numeric(10,0),
  ADD COLUMN IF NOT EXISTS lcto_contabil varchar(10),
  ADD COLUMN IF NOT EXISTS regime_lote varchar(10),
  ADD COLUMN IF NOT EXISTS integrante varchar(10),
  ADD COLUMN IF NOT EXISTS fechamento_caixa char(1),
  ADD COLUMN IF NOT EXISTS atudcomposicao char(1),
  ADD COLUMN IF NOT EXISTS salario numeric(15,2),
  ADD COLUMN IF NOT EXISTS lcto_financeiro char(1),
  ADD COLUMN IF NOT EXISTS dtcargatcpds timestamptz,
  ADD COLUMN IF NOT EXISTS dlm_pedido_compra varchar(2),
  ADD COLUMN IF NOT EXISTS desabilita_remessa char(1),
  ADD COLUMN IF NOT EXISTS ccdescontoobtido numeric(10,0),
  ADD COLUMN IF NOT EXISTS ccacresjuroobtido numeric(10,0),
  ADD COLUMN IF NOT EXISTS aluguel numeric(13,2),
  ADD COLUMN IF NOT EXISTS idcliente_fgf numeric(10,0),
  ADD COLUMN IF NOT EXISTS token_fgf varchar(200),
  ADD COLUMN IF NOT EXISTS hashpaf varchar(32),
  ADD COLUMN IF NOT EXISTS cnae_principal varchar(7),
  ADD COLUMN IF NOT EXISTS cnae_secundario varchar(7),
  ADD COLUMN IF NOT EXISTS csc_id numeric(10,0),
  ADD COLUMN IF NOT EXISTS csc varchar(100),
  ADD COLUMN IF NOT EXISTS csc_id_teste numeric(10,0),
  ADD COLUMN IF NOT EXISTS csc_teste varchar(100),
  ADD COLUMN IF NOT EXISTS nfce_autenticacao varchar(255),
  ADD COLUMN IF NOT EXISTS nomeloja varchar(100),
  ADD COLUMN IF NOT EXISTS codplcfechamentoconvenio numeric(10,0),
  ADD COLUMN IF NOT EXISTS mensagempromocao varchar(255),
  ADD COLUMN IF NOT EXISTS ultimo_nsu_serv varchar(15),
  ADD COLUMN IF NOT EXISTS cancelmax numeric(13,2),
  ADD COLUMN IF NOT EXISTS codfornecedor_voucher numeric(10,0),
  ADD COLUMN IF NOT EXISTS codfornecedor_recarga numeric(10,0),
  ADD COLUMN IF NOT EXISTS codfornecedor_correspondente numeric(10,0),
  ADD COLUMN IF NOT EXISTS codplc_voucher numeric(10,0),
  ADD COLUMN IF NOT EXISTS codplc_recarga numeric(10,0),
  ADD COLUMN IF NOT EXISTS codplc_correspondente numeric(10,0),
  ADD COLUMN IF NOT EXISTS fab_escala_nao_relevante char(1),
  ADD COLUMN IF NOT EXISTS crescevendas_token varchar(50),
  ADD COLUMN IF NOT EXISTS crescevendas_email varchar(100),
  ADD COLUMN IF NOT EXISTS crescevendas_url varchar(200),
  ADD COLUMN IF NOT EXISTS cod_estabelecimento_cielo varchar(20),
  ADD COLUMN IF NOT EXISTS nome_loja_tricard varchar(100),
  ADD COLUMN IF NOT EXISTS cod_estabelecimento_redecard varchar(50),
  ADD COLUMN IF NOT EXISTS izio_token varchar(50),
  ADD COLUMN IF NOT EXISTS izio_url varchar(200),
  ADD COLUMN IF NOT EXISTS certificado text,
  ADD COLUMN IF NOT EXISTS certificado_senha varchar(50),
  ADD COLUMN IF NOT EXISTS codconta_baixa_recarga numeric(10,0),
  ADD COLUMN IF NOT EXISTS codconta_baixa_correspondente numeric(10,0),
  ADD COLUMN IF NOT EXISTS email_aut_tls char(1),
  ADD COLUMN IF NOT EXISTS email_aut_ssl char(1),
  ADD COLUMN IF NOT EXISTS email_senha varchar(50),
  ADD COLUMN IF NOT EXISTS email_texto_nfc varchar(600),
  ADD COLUMN IF NOT EXISTS tef_loja varchar(20),
  ADD COLUMN IF NOT EXISTS tef_servidor varchar(20),
  ADD COLUMN IF NOT EXISTS tef_cartao_funcao varchar(100),
  ADD COLUMN IF NOT EXISTS tef_cartao_restricao varchar(100),
  ADD COLUMN IF NOT EXISTS tef_recarga_funcao varchar(100),
  ADD COLUMN IF NOT EXISTS tef_recarga_restricao varchar(100),
  ADD COLUMN IF NOT EXISTS tef_voucher_funcao varchar(100),
  ADD COLUMN IF NOT EXISTS tef_voucher_restricao varchar(100),
  ADD COLUMN IF NOT EXISTS tef_correspondente_funcao varchar(100),
  ADD COLUMN IF NOT EXISTS tef_correspondente_restricao varchar(100),
  ADD COLUMN IF NOT EXISTS tef_administrativo_funcao varchar(100),
  ADD COLUMN IF NOT EXISTS tef_administrativo_restricao varchar(100),
  ADD COLUMN IF NOT EXISTS chamafila_url varchar(200),
  ADD COLUMN IF NOT EXISTS dtcontingencia_inicio_nfc timestamptz,
  ADD COLUMN IF NOT EXISTS dtcontingencia_fim_nfc timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_contingencia_nfc varchar(200),
  ADD COLUMN IF NOT EXISTS cod_ajus_ipi numeric(10,0),
  ADD COLUMN IF NOT EXISTS cod_ajus_icms_st numeric(10,0),
  ADD COLUMN IF NOT EXISTS cod_ajus_sn numeric(10,0),
  ADD COLUMN IF NOT EXISTS codplc_nf_pdv numeric(10,0),
  ADD COLUMN IF NOT EXISTS idsituacao_nf_pdv numeric(10,0),
  ADD COLUMN IF NOT EXISTS serie_mdfe char(3),
  ADD COLUMN IF NOT EXISTS numeroinicial_mdfe char(3),
  ADD COLUMN IF NOT EXISTS autenticacao_mdfe varchar(255),
  ADD COLUMN IF NOT EXISTS certificado_mdfe text,
  ADD COLUMN IF NOT EXISTS certificado_senha_mdfe varchar(50),
  ADD COLUMN IF NOT EXISTS tptransp_mdfe numeric(10,0),
  ADD COLUMN IF NOT EXISTS seriecte char(3),
  ADD COLUMN IF NOT EXISTS cte_autenticacao varchar(255),
  ADD COLUMN IF NOT EXISTS certificado_cte text,
  ADD COLUMN IF NOT EXISTS certificado_cte_senha varchar(50),
  ADD COLUMN IF NOT EXISTS loja_token varchar(50),
  ADD COLUMN IF NOT EXISTS loja_email varchar(100),
  ADD COLUMN IF NOT EXISTS loja_url varchar(200),
  ADD COLUMN IF NOT EXISTS scanntech_token varchar(50),
  ADD COLUMN IF NOT EXISTS mercafacil_url varchar(200),
  ADD COLUMN IF NOT EXISTS mercafacil_token varchar(1000),
  ADD COLUMN IF NOT EXISTS codperfil_proprietario numeric,
  ADD COLUMN IF NOT EXISTS percent_compra_prop numeric(13,2),
  ADD COLUMN IF NOT EXISTS codconta_pagamento numeric(10,0),
  ADD COLUMN IF NOT EXISTS auth_fgf_api varchar(1000),
  ADD COLUMN IF NOT EXISTS valor_perc_multa char(1),
  ADD COLUMN IF NOT EXISTS url_fgf_api varchar(200),
  ADD COLUMN IF NOT EXISTS aream2 numeric(10,2),
  ADD COLUMN IF NOT EXISTS hab_cod_beneficio_fis char(1),
  ADD COLUMN IF NOT EXISTS dtconsulta_webservice_sefaz timestamptz,
  ADD COLUMN IF NOT EXISTS suframa varchar(10),
  ADD COLUMN IF NOT EXISTS pc_curva_abc_a_qtde numeric(13,2),
  ADD COLUMN IF NOT EXISTS pc_curva_abc_b_qtde numeric(13,2),
  ADD COLUMN IF NOT EXISTS pc_curva_abc_c_qtde numeric(13,2),
  ADD COLUMN IF NOT EXISTS aream2_venda numeric(10,2),
  ADD COLUMN IF NOT EXISTS serie_nfc varchar(3),
  ADD COLUMN IF NOT EXISTS valor_informar_cliente numeric(13,2),
  ADD COLUMN IF NOT EXISTS valor_maximo_informar_cliente numeric(13,2),
  ADD COLUMN IF NOT EXISTS vlr_produto numeric(13,2),
  ADD COLUMN IF NOT EXISTS urlbasewl varchar(100),
  ADD COLUMN IF NOT EXISTS codigoempresawl varchar(5),
  ADD COLUMN IF NOT EXISTS filialempresawl varchar(3),
  ADD COLUMN IF NOT EXISTS tokenwl varchar(100),
  ADD COLUMN IF NOT EXISTS remessaativa char(1),
  ADD COLUMN IF NOT EXISTS usuario_remessaativa numeric(10,0),
  ADD COLUMN IF NOT EXISTS data_remessaativa timestamptz,
  ADD COLUMN IF NOT EXISTS mercafacil_idpgto numeric,
  ADD COLUMN IF NOT EXISTS auth_fgf_api_v2 varchar(4000),
  ADD COLUMN IF NOT EXISTS pc_curva_abc_d numeric(13,2),
  ADD COLUMN IF NOT EXISTS pc_curva_abc_d_qtde numeric(13,2),
  ADD COLUMN IF NOT EXISTS codempresa_finan numeric(10,0),
  ADD COLUMN IF NOT EXISTS pc_curva_abc_e numeric(13,2),
  ADD COLUMN IF NOT EXISTS pc_curva_abc_e_qtde numeric(13,2),
  ADD COLUMN IF NOT EXISTS stef_integrador_token varchar(50),
  ADD COLUMN IF NOT EXISTS stef_integrador_cnpj varchar(14),
  ADD COLUMN IF NOT EXISTS stef_integrador_jwt varchar(1000),
  ADD COLUMN IF NOT EXISTS stef_loja_token varchar(50),
  ADD COLUMN IF NOT EXISTS pc_curva_comp_a numeric(13,2),
  ADD COLUMN IF NOT EXISTS pc_curva_comp_b numeric(13,2),
  ADD COLUMN IF NOT EXISTS pc_curva_comp_c numeric(13,2),
  ADD COLUMN IF NOT EXISTS pc_curva_comp_d numeric(13,2),
  ADD COLUMN IF NOT EXISTS pc_curva_comp_e numeric(13,2),
  ADD COLUMN IF NOT EXISTS pc_curva_comp_a_qtde numeric(13,2),
  ADD COLUMN IF NOT EXISTS pc_curva_comp_b_qtde numeric(13,2),
  ADD COLUMN IF NOT EXISTS pc_curva_comp_c_qtde numeric(13,2),
  ADD COLUMN IF NOT EXISTS pc_curva_comp_d_qtde numeric(13,2),
  ADD COLUMN IF NOT EXISTS pc_curva_comp_e_qtde numeric(13,2),
  ADD COLUMN IF NOT EXISTS alertafiscal_ambiente varchar(1),
  ADD COLUMN IF NOT EXISTS alertafiscal_idcliente numeric(10,0),
  ADD COLUMN IF NOT EXISTS alertafiscal_token varchar(1000),
  ADD COLUMN IF NOT EXISTS alertafiscal_url_consulta varchar(200),
  ADD COLUMN IF NOT EXISTS alertafiscal_url_webhook varchar(200),
  ADD COLUMN IF NOT EXISTS alertafiscal_url_consulta_prod varchar(200),
  ADD COLUMN IF NOT EXISTS alertafiscal_url_webhook_prod varchar(200),
  ADD COLUMN IF NOT EXISTS alertafiscal_tempo_envio_prod numeric(10,0),
  ADD COLUMN IF NOT EXISTS alertafiscal_tempo_retorno_api numeric(10,0),
  ADD COLUMN IF NOT EXISTS alertafiscal_tempo_receb_prod numeric(10,0),
  ADD COLUMN IF NOT EXISTS alertafiscal_ult_envio_prod timestamptz,
  ADD COLUMN IF NOT EXISTS alertafiscal_ult_receb_prod timestamptz,
  ADD COLUMN IF NOT EXISTS alertafiscal_ult_retorno_api timestamptz,
  ADD COLUMN IF NOT EXISTS percentual_acresc_prod numeric(13,2);

-- estoque ← ESTOQUE (203.696 linhas; 25 colunas)
ALTER TABLE estoque
  ADD COLUMN IF NOT EXISTS hashpaf varchar(32),
  ADD COLUMN IF NOT EXISTS origem varchar(10),
  ADD COLUMN IF NOT EXISTS idorigem numeric,
  ADD COLUMN IF NOT EXISTS qtde_venda numeric(13,3),
  ADD COLUMN IF NOT EXISTS qtde_venda_anterior numeric(13,3),
  ADD COLUMN IF NOT EXISTS qtde_ent_anterior numeric(13,3),
  ADD COLUMN IF NOT EXISTS dtent_anterior timestamptz,
  ADD COLUMN IF NOT EXISTS idorigem_ent numeric(10,0),
  ADD COLUMN IF NOT EXISTS qtdetroca numeric(13,3),
  ADD COLUMN IF NOT EXISTS qtde_almoxarifado numeric(13,3),
  ADD COLUMN IF NOT EXISTS local_almoxarifado varchar(50),
  ADD COLUMN IF NOT EXISTS minimo_almoxarifado numeric(13,3),
  ADD COLUMN IF NOT EXISTS maximo_almoxarifado numeric(13,3),
  ADD COLUMN IF NOT EXISTS qtde_cong_almoxarifado numeric(13,3),
  ADD COLUMN IF NOT EXISTS qtde_bk_almoxarifado numeric(13,3),
  ADD COLUMN IF NOT EXISTS qtdetroca_almoxarifado numeric(13,3),
  ADD COLUMN IF NOT EXISTS qtde_ent_almoxarifado numeric(13,3),
  ADD COLUMN IF NOT EXISTS qtde_ent_anterior_almoxarifado numeric(13,3),
  ADD COLUMN IF NOT EXISTS dtent_almoxarifado timestamptz,
  ADD COLUMN IF NOT EXISTS dtent_anterior_almoxarifado timestamptz,
  ADD COLUMN IF NOT EXISTS idorigem_ent_almoxarifado numeric(10,0),
  ADD COLUMN IF NOT EXISTS origem_almoxarifado varchar(10),
  ADD COLUMN IF NOT EXISTS codestoque_local numeric(10,0),
  ADD COLUMN IF NOT EXISTS estoque_bruno varchar(10),
  ADD COLUMN IF NOT EXISTS gondola numeric(13,3);

-- estoque_dep ← ESTOQUE_DEP (198.566 linhas; 4 colunas)
ALTER TABLE estoque_dep
  ADD COLUMN IF NOT EXISTS local varchar(50),
  ADD COLUMN IF NOT EXISTS minimo numeric(13,3),
  ADD COLUMN IF NOT EXISTS maximo numeric(13,3),
  ADD COLUMN IF NOT EXISTS qtdetroca numeric(13,3);

-- familias_prod ← FAMILIAS_PROD (2.452 linhas; 23 colunas)
ALTER TABLE familias_prod
  ADD COLUMN IF NOT EXISTS idempresa numeric(10,0),
  ADD COLUMN IF NOT EXISTS usultalteracao numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS comissao numeric(13,2),
  ADD COLUMN IF NOT EXISTS dtcadastro timestamptz,
  ADD COLUMN IF NOT EXISTS excluido char(1),
  ADD COLUMN IF NOT EXISTS coddeptosecao numeric(10,0),
  ADD COLUMN IF NOT EXISTS departamentos_secao varchar(1000),
  ADD COLUMN IF NOT EXISTS codplc numeric(10,0),
  ADD COLUMN IF NOT EXISTS exibesicomanda varchar(1),
  ADD COLUMN IF NOT EXISTS coberturamaxima numeric(10,0),
  ADD COLUMN IF NOT EXISTS ativo char(1),
  ADD COLUMN IF NOT EXISTS codperfil_compra numeric(10,0),
  ADD COLUMN IF NOT EXISTS codsetor numeric(10,0),
  ADD COLUMN IF NOT EXISTS codsetor_perda_padrao char(1),
  ADD COLUMN IF NOT EXISTS fp_despesa_operacional numeric(15,2),
  ADD COLUMN IF NOT EXISTS vrmargemmin numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrmargemmax numeric(13,2),
  ADD COLUMN IF NOT EXISTS desconsidera_conferencia_peso char(1),
  ADD COLUMN IF NOT EXISTS modeloeitqueta varchar(200),
  ADD COLUMN IF NOT EXISTS vrmargemfixa numeric(13,2),
  ADD COLUMN IF NOT EXISTS referencia varchar(15),
  ADD COLUMN IF NOT EXISTS checkout varchar(1);

-- figura_fiscal ← FIGURA_FISCAL (16.838 linhas; 7 colunas)
ALTER TABLE figura_fiscal
  ADD COLUMN IF NOT EXISTS origem_tipo_tributario varchar(2),
  ADD COLUMN IF NOT EXISTS origem_tipo_classificacao varchar(2),
  ADD COLUMN IF NOT EXISTS origem_uf varchar(2),
  ADD COLUMN IF NOT EXISTS destino_uf varchar(2),
  ADD COLUMN IF NOT EXISTS destino_tipo varchar(3),
  ADD COLUMN IF NOT EXISTS integracao_id varchar(32),
  ADD COLUMN IF NOT EXISTS integracao_data timestamptz;

-- formas_pgto ← FORMAS_PGTO (47 linhas; 25 colunas)
ALTER TABLE formas_pgto
  ADD COLUMN IF NOT EXISTS codcontabil varchar(30),
  ADD COLUMN IF NOT EXISTS comissao numeric(13,2),
  ADD COLUMN IF NOT EXISTS cfopdentrodoestado numeric(10,0),
  ADD COLUMN IF NOT EXISTS cfopforadoestado numeric(10,0),
  ADD COLUMN IF NOT EXISTS acre_desc numeric(13,2),
  ADD COLUMN IF NOT EXISTS codcontabil_deb numeric(10,0),
  ADD COLUMN IF NOT EXISTS codcontabil_cred numeric(10,0),
  ADD COLUMN IF NOT EXISTS modalidade_pdv varchar(30),
  ADD COLUMN IF NOT EXISTS parcela numeric(10,0),
  ADD COLUMN IF NOT EXISTS parcela_maxima numeric(10,0),
  ADD COLUMN IF NOT EXISTS codconpagto numeric(10,0),
  ADD COLUMN IF NOT EXISTS valor_minimo_fv numeric(13,2),
  ADD COLUMN IF NOT EXISTS troco_limite numeric(13,2),
  ADD COLUMN IF NOT EXISTS baixa_documento_automatico char(1),
  ADD COLUMN IF NOT EXISTS idpgto_pai numeric(10,0),
  ADD COLUMN IF NOT EXISTS exige_permissao varchar(1),
  ADD COLUMN IF NOT EXISTS codparceiro numeric(10,0),
  ADD COLUMN IF NOT EXISTS cartao_bin varchar(100),
  ADD COLUMN IF NOT EXISTS smart_tef varchar(1),
  ADD COLUMN IF NOT EXISTS smart_tef_destino varchar(1),
  ADD COLUMN IF NOT EXISTS tipo_transacao numeric(10,0),
  ADD COLUMN IF NOT EXISTS parcelado varchar(1),
  ADD COLUMN IF NOT EXISTS parcelado_despesa varchar(1),
  ADD COLUMN IF NOT EXISTS parcelado_parcelas numeric(10,0);

-- historico_envio_nfe ← HISTORICO_ENVIO_NFE (5.009 linhas; 2 colunas)
ALTER TABLE historico_envio_nfe
  ADD COLUMN IF NOT EXISTS usultalteracao numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtultalteracao timestamptz;

-- historico_processamento_nf ← HISTORICO_PROCESSAMENTO_NF (858.452 linhas; 3 colunas)
ALTER TABLE historico_processamento_nf
  ADD COLUMN IF NOT EXISTS geraestoque char(1),
  ADD COLUMN IF NOT EXISTS usuconsumo char(1),
  ADD COLUMN IF NOT EXISTS origem_estoque char(1);

-- historico_prod ← HISTORICO_PROD (13.968.279 linhas; 1 colunas)
ALTER TABLE historico_prod
  ADD COLUMN IF NOT EXISTS codtroca numeric(10,0);

-- indexador_tributario ← INDEXADOR_TRIBUTARIO (11.778 linhas; 1 colunas)
ALTER TABLE indexador_tributario
  ADD COLUMN IF NOT EXISTS old_codparceiro numeric(10,0);

-- inventario ← INVENTARIO (15.441 linhas; 2 colunas)
ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS datainventario timestamptz,
  ADD COLUMN IF NOT EXISTS importado char(1);

-- inventario_livro ← INVENTARIO_LIVRO (5 linhas; 9 colunas)
ALTER TABLE inventario_livro
  ADD COLUMN IF NOT EXISTS paginas varchar(20),
  ADD COLUMN IF NOT EXISTS dtiniciolivro timestamptz,
  ADD COLUMN IF NOT EXISTS dtfimlivro timestamptz,
  ADD COLUMN IF NOT EXISTS atividadecomercial varchar(100),
  ADD COLUMN IF NOT EXISTS atividadeprimaria varchar(50),
  ADD COLUMN IF NOT EXISTS atividadesecundaria varchar(50),
  ADD COLUMN IF NOT EXISTS nroabertura numeric(10,0),
  ADD COLUMN IF NOT EXISTS nrofechamento numeric(10,0),
  ADD COLUMN IF NOT EXISTS nrolivro numeric(10,0);

-- itens_integracao_contabil ← ITENS_INTEGRACAO_CONTABIL (222 linhas; 8 colunas)
ALTER TABLE itens_integracao_contabil
  ADD COLUMN IF NOT EXISTS valor numeric(13,2),
  ADD COLUMN IF NOT EXISTS modulo varchar(100),
  ADD COLUMN IF NOT EXISTS data timestamptz,
  ADD COLUMN IF NOT EXISTS percentual numeric(5,2),
  ADD COLUMN IF NOT EXISTS formula varchar(100),
  ADD COLUMN IF NOT EXISTS usultalteracao numeric,
  ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS dtcadastro timestamptz;

-- itens_producao_receita ← ITENS_PRODUCAO_RECEITA (513 linhas; 6 colunas)
ALTER TABLE itens_producao_receita
  ADD COLUMN IF NOT EXISTS usultalteracao numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS fator_conversao numeric(13,6),
  ADD COLUMN IF NOT EXISTS unidade_produto varchar(5),
  ADD COLUMN IF NOT EXISTS fator_conversao_cx_prod numeric(13,3),
  ADD COLUMN IF NOT EXISTS fator_conversao_cx_prod_util numeric(13,3);

-- itens_troca ← ITENS_TROCA (309 linhas; 1 colunas)
ALTER TABLE itens_troca
  ADD COLUMN IF NOT EXISTS origem_fechamento varchar(10);

-- log_impressao_etiqueta ← LOG_IMPRESSAO_ETIQUETA (114.917 linhas; 3 colunas)
ALTER TABLE log_impressao_etiqueta
  ADD COLUMN IF NOT EXISTS valor_impressao numeric(15,2),
  ADD COLUMN IF NOT EXISTS valor_apresentacao numeric(15,2),
  ADD COLUMN IF NOT EXISTS dados_etiqueta varchar(4000);

-- lote_contabil ← LOTE_CONTABIL (0 linhas; 6 colunas)
ALTER TABLE lote_contabil
  ADD COLUMN IF NOT EXISTS qtdedeb numeric(10,0),
  ADD COLUMN IF NOT EXISTS qtdecred numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS dtcadastro timestamptz,
  ADD COLUMN IF NOT EXISTS codperiodo numeric(10,0),
  ADD COLUMN IF NOT EXISTS usultalteracao numeric(10,0);

-- lote_preco ← LOTEPRECO (96.876 linhas; 4 colunas)
ALTER TABLE lote_preco
  ADD COLUMN IF NOT EXISTS etiqueta_impressa char(1),
  ADD COLUMN IF NOT EXISTS permitealteracao char(1),
  ADD COLUMN IF NOT EXISTS vrcusto_anterior numeric(10,2),
  ADD COLUMN IF NOT EXISTS codpedcomp numeric(10,0);

-- motivos_operacao ← MOTIVOS_OPERACAO (38 linhas; 1 colunas)
ALTER TABLE motivos_operacao
  ADD COLUMN IF NOT EXISTS motivo_operacao_perda_padrao char(1);

-- mov_contas_bancarias ← MOV_CONTAS_BANCARIAS (276.852 linhas; 14 colunas)
ALTER TABLE mov_contas_bancarias
  ADD COLUMN IF NOT EXISTS tipo char(1),
  ADD COLUMN IF NOT EXISTS coddestino numeric(10,0),
  ADD COLUMN IF NOT EXISTS chave varchar(14),
  ADD COLUMN IF NOT EXISTS bkpidpgto numeric(10,0),
  ADD COLUMN IF NOT EXISTS bkpidpgto2 numeric(10,0),
  ADD COLUMN IF NOT EXISTS identificador varchar(100),
  ADD COLUMN IF NOT EXISTS idempresa_fechamento numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtpgtobx timestamptz,
  ADD COLUMN IF NOT EXISTS revertido varchar(1),
  ADD COLUMN IF NOT EXISTS codcontagem_cedulas numeric(10,0),
  ADD COLUMN IF NOT EXISTS usucad_lancamento_saldo numeric(10,0),
  ADD COLUMN IF NOT EXISTS lancamento_saldo char(1),
  ADD COLUMN IF NOT EXISTS codconta_destino numeric(10,0),
  ADD COLUMN IF NOT EXISTS recurso varchar(50);

-- movimentacao_bancaria_ofx ← MOVIMENTACAO_BANCARIA_OFX (64.759 linhas; 3 colunas)
ALTER TABLE movimentacao_bancaria_ofx
  ADD COLUMN IF NOT EXISTS indr varchar(1),
  ADD COLUMN IF NOT EXISTS indr_usuario numeric(10,0),
  ADD COLUMN IF NOT EXISTS indr_data timestamptz;

-- multi_preco ← MULTI_PRECO (203.695 linhas; 50 colunas)
ALTER TABLE multi_preco
  ADD COLUMN IF NOT EXISTS codlotepreco numeric(10,0),
  ADD COLUMN IF NOT EXISTS vrdescpreco2 numeric(13,2),
  ADD COLUMN IF NOT EXISTS codimportacao numeric(10,0),
  ADD COLUMN IF NOT EXISTS aliquota char(3),
  ADD COLUMN IF NOT EXISTS margem_comissao numeric(13,2),
  ADD COLUMN IF NOT EXISTS bc_reduzida char(1),
  ADD COLUMN IF NOT EXISTS hashpaf varchar(32),
  ADD COLUMN IF NOT EXISTS ippt char(1),
  ADD COLUMN IF NOT EXISTS iat char(1),
  ADD COLUMN IF NOT EXISTS codusualt numeric(10,0),
  ADD COLUMN IF NOT EXISTS entcodnf numeric(10,0),
  ADD COLUMN IF NOT EXISTS entdatault timestamptz,
  ADD COLUMN IF NOT EXISTS entqtd numeric(13,3),
  ADD COLUMN IF NOT EXISTS vennropedido varchar(20),
  ADD COLUMN IF NOT EXISTS vendatault timestamptz,
  ADD COLUMN IF NOT EXISTS venqtd numeric(13,3),
  ADD COLUMN IF NOT EXISTS atacarejo_ativo char(1),
  ADD COLUMN IF NOT EXISTS vrajcustodec47530 numeric(13,2),
  ADD COLUMN IF NOT EXISTS status_izio varchar(20),
  ADD COLUMN IF NOT EXISTS data_izio timestamptz,
  ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS comissao numeric(13,2),
  ADD COLUMN IF NOT EXISTS usa_flex varchar(1),
  ADD COLUMN IF NOT EXISTS vrclube_fidelidade numeric(13,2),
  ADD COLUMN IF NOT EXISTS tipopis char(1),
  ADD COLUMN IF NOT EXISTS prod_exibe_forca_vendas varchar(1),
  ADD COLUMN IF NOT EXISTS agenda_produto_qtd numeric(13,3),
  ADD COLUMN IF NOT EXISTS codagenda_produto_item numeric(10,0),
  ADD COLUMN IF NOT EXISTS bernardao char(2),
  ADD COLUMN IF NOT EXISTS ferreira char(2),
  ADD COLUMN IF NOT EXISTS vrvenda_bernardao numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrvenda_ferreira numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrvenda_mana numeric(13,2),
  ADD COLUMN IF NOT EXISTS bkpvrvendaperticasa numeric(13,2),
  ADD COLUMN IF NOT EXISTS mana char(2),
  ADD COLUMN IF NOT EXISTS preconegativo char(2),
  ADD COLUMN IF NOT EXISTS idprodutohiper numeric(10,0),
  ADD COLUMN IF NOT EXISTS abc char(1),
  ADD COLUMN IF NOT EXISTS perc_abc numeric(5,2),
  ADD COLUMN IF NOT EXISTS data_abc timestamptz,
  ADD COLUMN IF NOT EXISTS dtintegracao_totvs timestamptz,
  ADD COLUMN IF NOT EXISTS agenda_codgrupopreco numeric(10,0),
  ADD COLUMN IF NOT EXISTS agenda_promocao_codgrupopreco numeric(10,0),
  ADD COLUMN IF NOT EXISTS agenda_promocao_maximo numeric(13,3),
  ADD COLUMN IF NOT EXISTS vrcusto_medio numeric(13,2),
  ADD COLUMN IF NOT EXISTS dtalteracao_integracao timestamptz,
  ADD COLUMN IF NOT EXISTS tipo_integracao varchar(250),
  ADD COLUMN IF NOT EXISTS tpdescpreco2 varchar(1),
  ADD COLUMN IF NOT EXISTS preco2dtini timestamptz,
  ADD COLUMN IF NOT EXISTS preco2dtfim timestamptz;

-- ncm ← NCM (11.344 linhas; 1 colunas)
ALTER TABLE ncm
  ADD COLUMN IF NOT EXISTS gerar_m220_m620 varchar(1);

-- nf ← NF (49.655 linhas; 105 colunas)
ALTER TABLE nf
  ADD COLUMN IF NOT EXISTS nropedido varchar(20),
  ADD COLUMN IF NOT EXISTS totalvroutros numeric(13,2),
  ADD COLUMN IF NOT EXISTS totaldescfinal numeric(13,2),
  ADD COLUMN IF NOT EXISTS printsucess char(1),
  ADD COLUMN IF NOT EXISTS codcontabil numeric(10,0),
  ADD COLUMN IF NOT EXISTS totalfrete2 numeric(13,2),
  ADD COLUMN IF NOT EXISTS servicoprestado varchar(600),
  ADD COLUMN IF NOT EXISTS valorservico numeric(13,2),
  ADD COLUMN IF NOT EXISTS issqn numeric(13,2),
  ADD COLUMN IF NOT EXISTS valorissqn numeric(13,2),
  ADD COLUMN IF NOT EXISTS qtde numeric(13,2),
  ADD COLUMN IF NOT EXISTS rntrc varchar(20),
  ADD COLUMN IF NOT EXISTS codvendedor numeric(10,0),
  ADD COLUMN IF NOT EXISTS taxa_importacao_nfe numeric(13,2),
  ADD COLUMN IF NOT EXISTS nfe_importacao char(1),
  ADD COLUMN IF NOT EXISTS codpai numeric(10,0),
  ADD COLUMN IF NOT EXISTS stexterno char(1),
  ADD COLUMN IF NOT EXISTS nf_importacao_nfe char(1),
  ADD COLUMN IF NOT EXISTS validatotalnf numeric(13,2),
  ADD COLUMN IF NOT EXISTS rateio_ipi char(1),
  ADD COLUMN IF NOT EXISTS rateio_st char(1),
  ADD COLUMN IF NOT EXISTS codimportacao numeric(10,0),
  ADD COLUMN IF NOT EXISTS codpedidoprod numeric(10,0),
  ADD COLUMN IF NOT EXISTS produc_status varchar(50),
  ADD COLUMN IF NOT EXISTS produc_status_receb varchar(15),
  ADD COLUMN IF NOT EXISTS cancela_faturamento char(1),
  ADD COLUMN IF NOT EXISTS cupons_ref_devolucao varchar(4000),
  ADD COLUMN IF NOT EXISTS old_codparceiro numeric(10,0),
  ADD COLUMN IF NOT EXISTS old_codparceiro_end numeric(10,0),
  ADD COLUMN IF NOT EXISTS vtoticmsufdest numeric(13,2),
  ADD COLUMN IF NOT EXISTS vtoticmsufremet numeric(13,2),
  ADD COLUMN IF NOT EXISTS vtotfcpufdest numeric(13,2),
  ADD COLUMN IF NOT EXISTS rateio_desconto char(1),
  ADD COLUMN IF NOT EXISTS total_icms_uf_dest_bc numeric(13,2),
  ADD COLUMN IF NOT EXISTS total_fcp_bc numeric(13,2),
  ADD COLUMN IF NOT EXISTS total_fcp numeric(13,2),
  ADD COLUMN IF NOT EXISTS nfe_xml text,
  ADD COLUMN IF NOT EXISTS total_icms_st_nota numeric(13,2),
  ADD COLUMN IF NOT EXISTS total_icms_st_bc_nota numeric(13,2),
  ADD COLUMN IF NOT EXISTS fisco_emit_cnpj varchar(20),
  ADD COLUMN IF NOT EXISTS fisco_emit_orgao varchar(60),
  ADD COLUMN IF NOT EXISTS fisco_emit_matr varchar(60),
  ADD COLUMN IF NOT EXISTS fisco_emit_agente varchar(60),
  ADD COLUMN IF NOT EXISTS fisco_emit_fone varchar(20),
  ADD COLUMN IF NOT EXISTS fisco_emit_uf char(2),
  ADD COLUMN IF NOT EXISTS fisco_emit_reparticao varchar(60),
  ADD COLUMN IF NOT EXISTS fisco_emit_dar_nro varchar(60),
  ADD COLUMN IF NOT EXISTS fisco_emit_dar_dtemis timestamptz,
  ADD COLUMN IF NOT EXISTS fisco_emit_dar_valor numeric(13,3),
  ADD COLUMN IF NOT EXISTS fisco_emit_dar_dtpgto timestamptz,
  ADD COLUMN IF NOT EXISTS ignorar_manifesto char(1),
  ADD COLUMN IF NOT EXISTS ignorar_manifesto_motivo varchar(255),
  ADD COLUMN IF NOT EXISTS calculapeso varchar(1),
  ADD COLUMN IF NOT EXISTS codoperador_libera_nfserv numeric(10,0),
  ADD COLUMN IF NOT EXISTS libera_nf_indexador char(1),
  ADD COLUMN IF NOT EXISTS codoperador_lib_nf_index numeric(10,0),
  ADD COLUMN IF NOT EXISTS totalicm_stexterno_sepnf numeric(13,2),
  ADD COLUMN IF NOT EXISTS imp_manifesto char(1),
  ADD COLUMN IF NOT EXISTS imp_importadormassa char(1),
  ADD COLUMN IF NOT EXISTS total_desc_acordo numeric(13,2),
  ADD COLUMN IF NOT EXISTS codproducao_req numeric(10,0),
  ADD COLUMN IF NOT EXISTS tipproducao_req char(1),
  ADD COLUMN IF NOT EXISTS rateio_ipi_devolucao char(1),
  ADD COLUMN IF NOT EXISTS baixar_estoque_exclusao char(1),
  ADD COLUMN IF NOT EXISTS icms_st_apagar_old numeric(13,2),
  ADD COLUMN IF NOT EXISTS codnotafiscal numeric(10,0),
  ADD COLUMN IF NOT EXISTS exportada varchar(1),
  ADD COLUMN IF NOT EXISTS total_desc_pedido numeric(13,2),
  ADD COLUMN IF NOT EXISTS alterar_base_ret_inss_manual char(1),
  ADD COLUMN IF NOT EXISTS alterar_base_ret_irrf_manual char(1),
  ADD COLUMN IF NOT EXISTS ult_codnfprod_repasse numeric(10,0),
  ADD COLUMN IF NOT EXISTS comissao numeric(13,2),
  ADD COLUMN IF NOT EXISTS ufembarq varchar(2),
  ADD COLUMN IF NOT EXISTS xlocembarq varchar(60),
  ADD COLUMN IF NOT EXISTS ufsaidapais varchar(2),
  ADD COLUMN IF NOT EXISTS xlocexporta varchar(60),
  ADD COLUMN IF NOT EXISTS xlocdespacho varchar(60),
  ADD COLUMN IF NOT EXISTS origem varchar(10),
  ADD COLUMN IF NOT EXISTS cod_parc_intermediador numeric,
  ADD COLUMN IF NOT EXISTS obsnfusuario varchar(2000),
  ADD COLUMN IF NOT EXISTS conferenciacoletor char(1),
  ADD COLUMN IF NOT EXISTS usuconferenciacoletor numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtconferenciacoletor timestamptz,
  ADD COLUMN IF NOT EXISTS recepcionada char(1),
  ADD COLUMN IF NOT EXISTS nota_neutra char(1),
  ADD COLUMN IF NOT EXISTS confcoletorpend char(1),
  ADD COLUMN IF NOT EXISTS desc_natop_alter varchar(60),
  ADD COLUMN IF NOT EXISTS total_vrcfop_abatido numeric(13,2),
  ADD COLUMN IF NOT EXISTS data_exportacao timestamptz,
  ADD COLUMN IF NOT EXISTS app_exportacao varchar(100),
  ADD COLUMN IF NOT EXISTS perc_aliquota_ret_senar numeric(13,2),
  ADD COLUMN IF NOT EXISTS total_ret_senar numeric(13,2),
  ADD COLUMN IF NOT EXISTS data_exportacao_integracao timestamptz,
  ADD COLUMN IF NOT EXISTS app_exportacao_integracao varchar(100),
  ADD COLUMN IF NOT EXISTS exportada_integracao varchar(1),
  ADD COLUMN IF NOT EXISTS abater_icms_deson char(1),
  ADD COLUMN IF NOT EXISTS data_exportacao_borba timestamptz,
  ADD COLUMN IF NOT EXISTS app_exportacao_borba varchar(100),
  ADD COLUMN IF NOT EXISTS exportada_borba varchar(1),
  ADD COLUMN IF NOT EXISTS nroreceituario_agro varchar(20),
  ADD COLUMN IF NOT EXISTS cpfresptec_agro varchar(11),
  ADD COLUMN IF NOT EXISTS uf_guia_transito varchar(2),
  ADD COLUMN IF NOT EXISTS tipo_guia_transito numeric(1,0),
  ADD COLUMN IF NOT EXISTS serie_guia_transito varchar(9),
  ADD COLUMN IF NOT EXISTS nro_guia_transito varchar(9);

-- nf_contabil ← CODCONTABILNF (45.722 linhas; 1 colunas)
ALTER TABLE nf_contabil
  ADD COLUMN IF NOT EXISTS codcontabil numeric(10,0);

-- nf_forma_pagamento ← NF_FORMA_PAGAMENTO (41.180 linhas; 2 colunas)
ALTER TABLE nf_forma_pagamento
  ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS bkpcodoperadoras numeric(10,0);

-- nf_prod ← NF_PROD (498.439 linhas; 71 colunas)
ALTER TABLE nf_prod
  ADD COLUMN IF NOT EXISTS vrpis numeric(13,2),
  ADD COLUMN IF NOT EXISTS beneficio numeric(10,0),
  ADD COLUMN IF NOT EXISTS markupl numeric(13,2),
  ADD COLUMN IF NOT EXISTS codcontabil numeric(10,0),
  ADD COLUMN IF NOT EXISTS creditoicm numeric(13,2),
  ADD COLUMN IF NOT EXISTS creditopiscofins numeric(13,2),
  ADD COLUMN IF NOT EXISTS indexadortrib numeric(10,0),
  ADD COLUMN IF NOT EXISTS ultvenda numeric(13,2),
  ADD COLUMN IF NOT EXISTS ncm_importacao varchar(8),
  ADD COLUMN IF NOT EXISTS produc_estocagem char(1),
  ADD COLUMN IF NOT EXISTS produc_tara_primaria numeric(13,2),
  ADD COLUMN IF NOT EXISTS produc_tara_secundaria numeric(13,2),
  ADD COLUMN IF NOT EXISTS produc_tara_balanca numeric(13,2),
  ADD COLUMN IF NOT EXISTS produc_dtproducao timestamptz,
  ADD COLUMN IF NOT EXISTS produc_dtvalidade timestamptz,
  ADD COLUMN IF NOT EXISTS produc_lote numeric(10,0),
  ADD COLUMN IF NOT EXISTS produc_peso_liq_recebido numeric(13,2),
  ADD COLUMN IF NOT EXISTS produc_peso_bruto_recebido numeric(13,2),
  ADD COLUMN IF NOT EXISTS produc_dtrecebimento timestamptz,
  ADD COLUMN IF NOT EXISTS repassado char(1),
  ADD COLUMN IF NOT EXISTS liberar_variacaocusto char(1),
  ADD COLUMN IF NOT EXISTS produc_abatido char(1),
  ADD COLUMN IF NOT EXISTS vicmsufdest numeric(13,2),
  ADD COLUMN IF NOT EXISTS vicmsufremet numeric(13,2),
  ADD COLUMN IF NOT EXISTS vfcpufdest numeric(13,2),
  ADD COLUMN IF NOT EXISTS nropedido varchar(20),
  ADD COLUMN IF NOT EXISTS nroitemped numeric(10,0),
  ADD COLUMN IF NOT EXISTS decomposicao char(1),
  ADD COLUMN IF NOT EXISTS produc_peso_liq_exp numeric(13,4),
  ADD COLUMN IF NOT EXISTS produc_peso_bruto_exp numeric(13,4),
  ADD COLUMN IF NOT EXISTS fcp_bc numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_uf_dest_bc numeric(13,2),
  ADD COLUMN IF NOT EXISTS vl_unitario numeric(13,4),
  ADD COLUMN IF NOT EXISTS idproduto_filho numeric(10,0),
  ADD COLUMN IF NOT EXISTS aliquota_validada char(1),
  ADD COLUMN IF NOT EXISTS vricms_stexterno_separadonf numeric(13,2),
  ADD COLUMN IF NOT EXISTS codscrap numeric(10,0),
  ADD COLUMN IF NOT EXISTS coditensqtde_troca numeric(10,0),
  ADD COLUMN IF NOT EXISTS quantidade_pre_coleta numeric(13,2),
  ADD COLUMN IF NOT EXISTS codprodutopai_decomposicao numeric(10,0),
  ADD COLUMN IF NOT EXISTS item_perda_total char(1),
  ADD COLUMN IF NOT EXISTS atualiza_multipreco_decomp char(1),
  ADD COLUMN IF NOT EXISTS descricao_prodpai_decomp varchar(150),
  ADD COLUMN IF NOT EXISTS produc_tipo_dev varchar(40),
  ADD COLUMN IF NOT EXISTS codoperador_lib_estoqueneg numeric(10,0),
  ADD COLUMN IF NOT EXISTS vrcustoajustenf numeric(13,2),
  ADD COLUMN IF NOT EXISTS frete2_temp numeric(13,4),
  ADD COLUMN IF NOT EXISTS sincronizado_cfop char(1),
  ADD COLUMN IF NOT EXISTS sincronizado_cst char(1),
  ADD COLUMN IF NOT EXISTS sincronizado_aliq char(1),
  ADD COLUMN IF NOT EXISTS origemproducao char(1),
  ADD COLUMN IF NOT EXISTS nroitem_decomp numeric(10,0),
  ADD COLUMN IF NOT EXISTS estoqueretiradatroca varchar(12),
  ADD COLUMN IF NOT EXISTS usoconsumo char(1),
  ADD COLUMN IF NOT EXISTS vrsaldoflex numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrcomissao numeric(13,2),
  ADD COLUMN IF NOT EXISTS codvendedor numeric(10,0),
  ADD COLUMN IF NOT EXISTS codnfdecimp numeric(10,0),
  ADD COLUMN IF NOT EXISTS nroitem_venda numeric(10,0),
  ADD COLUMN IF NOT EXISTS destacicmssn char(1),
  ADD COLUMN IF NOT EXISTS idproacumulativa numeric(10,0),
  ADD COLUMN IF NOT EXISTS idpromocao numeric(10,0),
  ADD COLUMN IF NOT EXISTS especificacao varchar(300),
  ADD COLUMN IF NOT EXISTS custo_recalculo_bonif numeric(13,4),
  ADD COLUMN IF NOT EXISTS usuario_precifica numeric(10,0),
  ADD COLUMN IF NOT EXISTS data_precifica timestamptz,
  ADD COLUMN IF NOT EXISTS codigobenfiscal varchar(10),
  ADD COLUMN IF NOT EXISTS strealnovo numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrcfop_abatido numeric(13,2),
  ADD COLUMN IF NOT EXISTS ind_deduz_deson varchar(4),
  ADD COLUMN IF NOT EXISTS codtribbebida numeric(10,0);

-- nf_prod_ibscbs ← NF_PROD_IBSCBS (99.052 linhas; 2 colunas)
ALTER TABLE nf_prod_ibscbs
  ADD COLUMN IF NOT EXISTS predaliq numeric(13,4),
  ADD COLUMN IF NOT EXISTS paliqefet numeric(13,4);

-- nf_referencia ← NF_REFERENCIA (11.064 linhas; 2 colunas)
ALTER TABLE nf_referencia
  ADD COLUMN IF NOT EXISTS modelo numeric(10,0),
  ADD COLUMN IF NOT EXISTS chavenfe varchar(50);

-- nfe_evento ← NFE_EVENTOS (107.150 linhas; 6 colunas)
ALTER TABLE nfe_evento
  ADD COLUMN IF NOT EXISTS orgao_recepcao varchar(50),
  ADD COLUMN IF NOT EXISTS cnpj_cpf_autor_evento varchar(145),
  ADD COLUMN IF NOT EXISTS mensagem_autorizacao varchar(200),
  ADD COLUMN IF NOT EXISTS just_op_nao_realizada varchar(255),
  ADD COLUMN IF NOT EXISTS razao varchar(255),
  ADD COLUMN IF NOT EXISTS correcao text;

-- nfe_nao_cadastradas ← NFE_NAO_CADASTRADAS (43.818 linhas; 4 colunas)
ALTER TABLE nfe_nao_cadastradas
  ADD COLUMN IF NOT EXISTS cnpj_destinatario varchar(30),
  ADD COLUMN IF NOT EXISTS razao_destinatario varchar(255),
  ADD COLUMN IF NOT EXISTS cancelada_sefaz char(1),
  ADD COLUMN IF NOT EXISTS data_mod_canc_sefaz timestamptz;

-- operadoras ← OPERADORAS (70 linhas; 10 colunas)
ALTER TABLE operadoras
  ADD COLUMN IF NOT EXISTS idrds numeric(10,0),
  ADD COLUMN IF NOT EXISTS txgestao numeric(10,3),
  ADD COLUMN IF NOT EXISTS txanuidade numeric(10,3),
  ADD COLUMN IF NOT EXISTS diafechamento varchar(5),
  ADD COLUMN IF NOT EXISTS obs varchar(1000),
  ADD COLUMN IF NOT EXISTS empresas varchar(300),
  ADD COLUMN IF NOT EXISTS pos char(1),
  ADD COLUMN IF NOT EXISTS operadora_pdv varchar(50),
  ADD COLUMN IF NOT EXISTS flg_validar_nsu char(1),
  ADD COLUMN IF NOT EXISTS smart_tef varchar(1);

-- operadoras_taxa ← OPERADORAS_TAXA (3 linhas; 3 colunas)
ALTER TABLE operadoras_taxa
  ADD COLUMN IF NOT EXISTS txgestao numeric(10,3),
  ADD COLUMN IF NOT EXISTS txanuidade numeric(10,3),
  ADD COLUMN IF NOT EXISTS txantecipacao numeric(13,2);

-- operadores ← OPERADORES (291 linhas; 9 colunas)
ALTER TABLE operadores
  ADD COLUMN IF NOT EXISTS senha varchar(50),
  ADD COLUMN IF NOT EXISTS menu numeric(10,0),
  ADD COLUMN IF NOT EXISTS senhapdv varchar(30),
  ADD COLUMN IF NOT EXISTS senharetaguarda varchar(30),
  ADD COLUMN IF NOT EXISTS biometria bytea,
  ADD COLUMN IF NOT EXISTS login_senha varchar(50),
  ADD COLUMN IF NOT EXISTS cliquex char(1),
  ADD COLUMN IF NOT EXISTS permissaopdv varchar(100),
  ADD COLUMN IF NOT EXISTS bloquearsuperliberarprop char(1);

-- operadores_restricao_acesso ← OPERADORES_RESTRICAO_ACESSO (0 linhas; 2 colunas)
ALTER TABLE operadores_restricao_acesso
  ADD COLUMN IF NOT EXISTS indr_usuario numeric(10,0),
  ADD COLUMN IF NOT EXISTS indr_data timestamptz;

-- parceiros ← PARCEIROS (19.069 linhas; 107 colunas)
ALTER TABLE parceiros
  ADD COLUMN IF NOT EXISTS comissao numeric(13,2),
  ADD COLUMN IF NOT EXISTS printecf varchar(300),
  ADD COLUMN IF NOT EXISTS cod_export numeric(10,0),
  ADD COLUMN IF NOT EXISTS senha varchar(30),
  ADD COLUMN IF NOT EXISTS diasfinan numeric(10,0),
  ADD COLUMN IF NOT EXISTS placa varchar(20),
  ADD COLUMN IF NOT EXISTS ufplaca varchar(2),
  ADD COLUMN IF NOT EXISTS codconpagto numeric(10,0),
  ADD COLUMN IF NOT EXISTS telefoneempresa varchar(30),
  ADD COLUMN IF NOT EXISTS temposervico numeric(10,0),
  ADD COLUMN IF NOT EXISTS cargoempresa varchar(50),
  ADD COLUMN IF NOT EXISTS todospgtos char(1),
  ADD COLUMN IF NOT EXISTS sugpgto numeric(10,0),
  ADD COLUMN IF NOT EXISTS tipoparceiro char(3),
  ADD COLUMN IF NOT EXISTS obs2 varchar(800),
  ADD COLUMN IF NOT EXISTS obs3 varchar(800),
  ADD COLUMN IF NOT EXISTS vencimentos varchar(100),
  ADD COLUMN IF NOT EXISTS setor numeric(10,0),
  ADD COLUMN IF NOT EXISTS regiao numeric(10,0),
  ADD COLUMN IF NOT EXISTS diavisita numeric(10,0),
  ADD COLUMN IF NOT EXISTS codaux varchar(20),
  ADD COLUMN IF NOT EXISTS categoria numeric(10,0),
  ADD COLUMN IF NOT EXISTS ordemvisita numeric(10,0),
  ADD COLUMN IF NOT EXISTS percsalario numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrseguro numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrexame numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrxerox numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrspc numeric(13,2),
  ADD COLUMN IF NOT EXISTS vroutros numeric(13,2),
  ADD COLUMN IF NOT EXISTS despreza_bloqueio char(1),
  ADD COLUMN IF NOT EXISTS senha_autpdv varchar(30),
  ADD COLUMN IF NOT EXISTS sincronizado varchar(1),
  ADD COLUMN IF NOT EXISTS idcategoria numeric(10,0),
  ADD COLUMN IF NOT EXISTS obs_troca varchar(1400),
  ADD COLUMN IF NOT EXISTS contrato char(1),
  ADD COLUMN IF NOT EXISTS tipotroca char(1),
  ADD COLUMN IF NOT EXISTS codigo_bloqueio numeric(10,0),
  ADD COLUMN IF NOT EXISTS site char(1),
  ADD COLUMN IF NOT EXISTS visualiza_pc_parc char(1),
  ADD COLUMN IF NOT EXISTS possui_servico char(1),
  ADD COLUMN IF NOT EXISTS valorservicofixo numeric(13,2),
  ADD COLUMN IF NOT EXISTS codconta numeric(10,0),
  ADD COLUMN IF NOT EXISTS base_retencao_inss_dif char(1),
  ADD COLUMN IF NOT EXISTS campanha_izio char(1),
  ADD COLUMN IF NOT EXISTS cod_izio numeric(18,0),
  ADD COLUMN IF NOT EXISTS codperfil_compra numeric(10,0),
  ADD COLUMN IF NOT EXISTS vendedor_desc_flexivel numeric(13,2),
  ADD COLUMN IF NOT EXISTS vendedor_periodo_flexivel char(3),
  ADD COLUMN IF NOT EXISTS par_valor_limite_conveniados numeric(15,2),
  ADD COLUMN IF NOT EXISTS publicidade_sms char(1),
  ADD COLUMN IF NOT EXISTS publicidade_email char(1),
  ADD COLUMN IF NOT EXISTS publicidade_whatsapp char(1),
  ADD COLUMN IF NOT EXISTS id_preco numeric(10,0),
  ADD COLUMN IF NOT EXISTS codperfil_parceiro numeric(10,0),
  ADD COLUMN IF NOT EXISTS clubefidelidade char(1),
  ADD COLUMN IF NOT EXISTS despesa_fixa varchar(1),
  ADD COLUMN IF NOT EXISTS par_altera_nome_dig_pedidos varchar(1),
  ADD COLUMN IF NOT EXISTS perc_aliquota_funr numeric(15,3),
  ADD COLUMN IF NOT EXISTS libera_digitar_retencoes char(1),
  ADD COLUMN IF NOT EXISTS df varchar(1),
  ADD COLUMN IF NOT EXISTS descpadraoboleto numeric(13,2),
  ADD COLUMN IF NOT EXISTS dispensado_coleta char(1),
  ADD COLUMN IF NOT EXISTS mensalidade2501 numeric(13,2),
  ADD COLUMN IF NOT EXISTS "2017" numeric(13,2),
  ADD COLUMN IF NOT EXISTS "2018" numeric(13,2),
  ADD COLUMN IF NOT EXISTS "2019" numeric(13,2),
  ADD COLUMN IF NOT EXISTS "2020" numeric(13,2),
  ADD COLUMN IF NOT EXISTS apollo char(1),
  ADD COLUMN IF NOT EXISTS codparceiroorig numeric(10,0),
  ADD COLUMN IF NOT EXISTS dispensado_pedido_compra char(1),
  ADD COLUMN IF NOT EXISTS cod_intermediador_trans char(60),
  ADD COLUMN IF NOT EXISTS diasvencepedido numeric(10,0),
  ADD COLUMN IF NOT EXISTS retencao_cooperativa varchar(1),
  ADD COLUMN IF NOT EXISTS biometria bytea,
  ADD COLUMN IF NOT EXISTS dtcartaofidelidade timestamptz,
  ADD COLUMN IF NOT EXISTS idgrupoemp numeric(10,0),
  ADD COLUMN IF NOT EXISTS cnae varchar(100),
  ADD COLUMN IF NOT EXISTS suframa varchar(10),
  ADD COLUMN IF NOT EXISTS dtprimeiracompraatrasada timestamptz,
  ADD COLUMN IF NOT EXISTS dtultalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS url_integrador varchar(250),
  ADD COLUMN IF NOT EXISTS "2022" numeric(13,2),
  ADD COLUMN IF NOT EXISTS codparceiro_matriz numeric(10,0),
  ADD COLUMN IF NOT EXISTS tipo_saida char(3),
  ADD COLUMN IF NOT EXISTS participa_cotacao char(1),
  ADD COLUMN IF NOT EXISTS identificador varchar(30),
  ADD COLUMN IF NOT EXISTS soma_st_bonificacao char(1),
  ADD COLUMN IF NOT EXISTS perc_aliquota_senar numeric(13,3),
  ADD COLUMN IF NOT EXISTS habilita_retencao_senar_nf char(1),
  ADD COLUMN IF NOT EXISTS empresas varchar(50),
  ADD COLUMN IF NOT EXISTS obs_fgf varchar(500),
  ADD COLUMN IF NOT EXISTS hab_ret_pis_nf_sai varchar(1),
  ADD COLUMN IF NOT EXISTS hab_ret_cofins_nf_sai varchar(1),
  ADD COLUMN IF NOT EXISTS hab_ret_csll_nf_sai varchar(1),
  ADD COLUMN IF NOT EXISTS hab_ret_ir_nf_sai varchar(1),
  ADD COLUMN IF NOT EXISTS hab_ret_inss_nf_sai varchar(1),
  ADD COLUMN IF NOT EXISTS hab_ret_issqn_nf_sai varchar(1),
  ADD COLUMN IF NOT EXISTS hab_ret_funrural_nf_sai varchar(1),
  ADD COLUMN IF NOT EXISTS hab_ret_senar_nf_sai varchar(1),
  ADD COLUMN IF NOT EXISTS libera_digitar_retencoes_sai varchar(1),
  ADD COLUMN IF NOT EXISTS retencao_cooperativa_sai varchar(1),
  ADD COLUMN IF NOT EXISTS codparceiro_ent_issqn_sai numeric(10,0),
  ADD COLUMN IF NOT EXISTS perc_aliquota_issqn_sai numeric(7,4),
  ADD COLUMN IF NOT EXISTS perc_aliquota_ir_sai numeric(7,4),
  ADD COLUMN IF NOT EXISTS perc_aliquota_funr_sai numeric(7,4),
  ADD COLUMN IF NOT EXISTS perc_aliquota_senar_sai numeric(7,4),
  ADD COLUMN IF NOT EXISTS codvendedor_balanca numeric(10,0);

-- parceiros_end ← PARCEIROS_END (19.021 linhas; 8 colunas)
ALTER TABLE parceiros_end
  ADD COLUMN IF NOT EXISTS sincronizado varchar(1),
  ADD COLUMN IF NOT EXISTS site char(1),
  ADD COLUMN IF NOT EXISTS referencia varchar(200),
  ADD COLUMN IF NOT EXISTS codparceiroorig numeric(10,0),
  ADD COLUMN IF NOT EXISTS cod_endorig numeric(10,0),
  ADD COLUMN IF NOT EXISTS codplc numeric(10,0),
  ADD COLUMN IF NOT EXISTS mercafacil char(1),
  ADD COLUMN IF NOT EXISTS mixfiscal_dt timestamptz;

-- parceiros_pgto ← PARCEIROS_PGTO (274 linhas; 3 colunas)
ALTER TABLE parceiros_pgto
  ADD COLUMN IF NOT EXISTS ativado char(1),
  ADD COLUMN IF NOT EXISTS old_codparceiros_pgto numeric(10,0),
  ADD COLUMN IF NOT EXISTS old_codparceiro numeric(10,0);

-- parceiros_rel ← PARCEIROS_REL (3 linhas; 3 colunas)
ALTER TABLE parceiros_rel
  ADD COLUMN IF NOT EXISTS ativado char(1),
  ADD COLUMN IF NOT EXISTS senha_autpdv varchar(30),
  ADD COLUMN IF NOT EXISTS biometria bytea;

-- pedido_devolucao_compra ← PEDIDO_DEVOLUCAO_COMPRA (885 linhas; 1 colunas)
ALTER TABLE pedido_devolucao_compra
  ADD COLUMN IF NOT EXISTS cnpj_cpf varchar(80);

-- pedidocompra ← PEDIDOCOMPRA (12.948 linhas; 9 colunas)
ALTER TABLE pedidocompra
  ADD COLUMN IF NOT EXISTS nronf numeric(10,0),
  ADD COLUMN IF NOT EXISTS old_codparceiro numeric(10,0),
  ADD COLUMN IF NOT EXISTS operador_ultima_analise numeric(10,0),
  ADD COLUMN IF NOT EXISTS idtf numeric(10,0),
  ADD COLUMN IF NOT EXISTS compra_1_para_n_lojas varchar(1),
  ADD COLUMN IF NOT EXISTS sincronizado char(1),
  ADD COLUMN IF NOT EXISTS novo_limite numeric(13,2),
  ADD COLUMN IF NOT EXISTS codfornvendedor numeric(10,0),
  ADD COLUMN IF NOT EXISTS codpedcomp_bonificado numeric(10,0);

-- pedidocompra_i ← PEDIDOCOMPRA_I (210.138 linhas; 3 colunas)
ALTER TABLE pedidocompra_i
  ADD COLUMN IF NOT EXISTS vlrunitario numeric(12,4),
  ADD COLUMN IF NOT EXISTS vrcustoitempedcompra numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrvendaitem numeric(13,2);

-- pedidos ← PEDIDOS (37.079 linhas; 52 colunas)
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS obs varchar(600),
  ADD COLUMN IF NOT EXISTS referencia varchar(300),
  ADD COLUMN IF NOT EXISTS codigo numeric(10,0),
  ADD COLUMN IF NOT EXISTS nromapa numeric(10,0),
  ADD COLUMN IF NOT EXISTS origem_import char(1),
  ADD COLUMN IF NOT EXISTS arquivo_importacao varchar(250),
  ADD COLUMN IF NOT EXISTS dtentrega timestamptz,
  ADD COLUMN IF NOT EXISTS idrds numeric(10,0),
  ADD COLUMN IF NOT EXISTS impressao char(1),
  ADD COLUMN IF NOT EXISTS nrocupom numeric(10,0),
  ADD COLUMN IF NOT EXISTS nrocomanda varchar(30),
  ADD COLUMN IF NOT EXISTS codunidade numeric(10,0),
  ADD COLUMN IF NOT EXISTS zerofila char(1),
  ADD COLUMN IF NOT EXISTS old_codparceiro_end numeric(10,0),
  ADD COLUMN IF NOT EXISTS old_codparceiro numeric(10,0),
  ADD COLUMN IF NOT EXISTS desistencia char(1),
  ADD COLUMN IF NOT EXISTS conferido varchar(10),
  ADD COLUMN IF NOT EXISTS qtdeconf numeric(13,2),
  ADD COLUMN IF NOT EXISTS sicomanda varchar(1),
  ADD COLUMN IF NOT EXISTS idmobile varchar(128),
  ADD COLUMN IF NOT EXISTS end_logradouro varchar(255),
  ADD COLUMN IF NOT EXISTS end_numero numeric(10,0),
  ADD COLUMN IF NOT EXISTS end_complemento varchar(30),
  ADD COLUMN IF NOT EXISTS end_referencia varchar(100),
  ADD COLUMN IF NOT EXISTS end_bairro varchar(100),
  ADD COLUMN IF NOT EXISTS end_cidade varchar(100),
  ADD COLUMN IF NOT EXISTS end_estado char(2),
  ADD COLUMN IF NOT EXISTS end_cep varchar(8),
  ADD COLUMN IF NOT EXISTS vrcustoreal numeric(13,2),
  ADD COLUMN IF NOT EXISTS desc_acre_comissao numeric(13,2),
  ADD COLUMN IF NOT EXISTS valor_base numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrcomissao numeric(13,2),
  ADD COLUMN IF NOT EXISTS acre_desc_fp numeric(13,3),
  ADD COLUMN IF NOT EXISTS idproacumulativa numeric(13,3),
  ADD COLUMN IF NOT EXISTS vr_comissao_perc numeric(15,3),
  ADD COLUMN IF NOT EXISTS chaveaux numeric(10,0),
  ADD COLUMN IF NOT EXISTS duplicado char(1),
  ADD COLUMN IF NOT EXISTS nropedidoorigem varchar(20),
  ADD COLUMN IF NOT EXISTS nromapaold numeric(10,0),
  ADD COLUMN IF NOT EXISTS complemento varchar(1),
  ADD COLUMN IF NOT EXISTS ipterminal varchar(15),
  ADD COLUMN IF NOT EXISTS versao varchar(20),
  ADD COLUMN IF NOT EXISTS idpromocao numeric,
  ADD COLUMN IF NOT EXISTS pibsuf numeric(13,4),
  ADD COLUMN IF NOT EXISTS pibsmun numeric(13,4),
  ADD COLUMN IF NOT EXISTS pcbs numeric(13,4),
  ADD COLUMN IF NOT EXISTS predaliq_cbs numeric(13,4),
  ADD COLUMN IF NOT EXISTS paliqefet_cbs numeric(13,4),
  ADD COLUMN IF NOT EXISTS predaliq_ibsuf numeric(13,4),
  ADD COLUMN IF NOT EXISTS paliqefet_ibsuf numeric(13,4),
  ADD COLUMN IF NOT EXISTS predaliq_ibsmun numeric(13,4),
  ADD COLUMN IF NOT EXISTS paliqefet_ibsmun numeric(13,4);

-- plano_contas ← PLANO_CONTAS (11.028 linhas; 3 colunas)
ALTER TABLE plano_contas
  ADD COLUMN IF NOT EXISTS cnpj varchar(20),
  ADD COLUMN IF NOT EXISTS codplanocontas_aux numeric(10,0),
  ADD COLUMN IF NOT EXISTS codplanoreferencial numeric(10,0);

-- plc ← PLC (385 linhas; 13 colunas)
ALTER TABLE plc
  ADD COLUMN IF NOT EXISTS descplccontabil varchar(200),
  ADD COLUMN IF NOT EXISTS usultalteracao numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS dtcadastro timestamptz,
  ADD COLUMN IF NOT EXISTS apenas_proprietario varchar(1),
  ADD COLUMN IF NOT EXISTS flg_uso_setor varchar(1),
  ADD COLUMN IF NOT EXISTS nao_mostrar_scrap_rel_partset varchar(1),
  ADD COLUMN IF NOT EXISTS flg_perda varchar(1),
  ADD COLUMN IF NOT EXISTS plc_obriga_motivo_perda varchar(1),
  ADD COLUMN IF NOT EXISTS indr varchar(1),
  ADD COLUMN IF NOT EXISTS indr_usuario numeric(10,0),
  ADD COLUMN IF NOT EXISTS indr_data timestamptz,
  ADD COLUMN IF NOT EXISTS limiteplc numeric(10,0);

-- produtos ← PRODUTOS (47.730 linhas; 93 colunas)
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS taraembalagem numeric(13,2),
  ADD COLUMN IF NOT EXISTS codpromotor numeric(10,0),
  ADD COLUMN IF NOT EXISTS indicador numeric(10,0),
  ADD COLUMN IF NOT EXISTS grplog varchar(5),
  ADD COLUMN IF NOT EXISTS codigo_anp varchar(9),
  ADD COLUMN IF NOT EXISTS vrdescpreco2 numeric(13,2),
  ADD COLUMN IF NOT EXISTS codimportacao numeric(10,0),
  ADD COLUMN IF NOT EXISTS prazovidautil numeric(10,0),
  ADD COLUMN IF NOT EXISTS vidautilem char(1),
  ADD COLUMN IF NOT EXISTS bkpcodinfnutri numeric(10,0),
  ADD COLUMN IF NOT EXISTS precopadraorebaixa numeric(13,2),
  ADD COLUMN IF NOT EXISTS id_tabela numeric(10,0),
  ADD COLUMN IF NOT EXISTS tpdescpreco2 char(1),
  ADD COLUMN IF NOT EXISTS visivel_rel varchar(1),
  ADD COLUMN IF NOT EXISTS ultimavenda timestamptz,
  ADD COLUMN IF NOT EXISTS preco2dtini timestamptz,
  ADD COLUMN IF NOT EXISTS preco2dtfim timestamptz,
  ADD COLUMN IF NOT EXISTS ncmoriginalwil varchar(15),
  ADD COLUMN IF NOT EXISTS dt_atualizacao_fgf timestamptz,
  ADD COLUMN IF NOT EXISTS pallet_prudutos_por_pallet numeric(10,0),
  ADD COLUMN IF NOT EXISTS desapacessorio numeric(13,2),
  ADD COLUMN IF NOT EXISTS dtultcompra timestamptz,
  ADD COLUMN IF NOT EXISTS forcvarejo numeric(10,0),
  ADD COLUMN IF NOT EXISTS dt_verificacao_fgf timestamptz,
  ADD COLUMN IF NOT EXISTS registro_agrodefesa varchar(13),
  ADD COLUMN IF NOT EXISTS hashpaf varchar(32),
  ADD COLUMN IF NOT EXISTS estoquecomposicao char(1),
  ADD COLUMN IF NOT EXISTS codcomposicao varchar(22),
  ADD COLUMN IF NOT EXISTS chavecomposicao varchar(25),
  ADD COLUMN IF NOT EXISTS codplanocontas numeric(10,0),
  ADD COLUMN IF NOT EXISTS dias_validade_minimo numeric(10,0),
  ADD COLUMN IF NOT EXISTS percentual_perdas numeric(15,3),
  ADD COLUMN IF NOT EXISTS quantidade numeric(13,3),
  ADD COLUMN IF NOT EXISTS produz_escala_nao_rel char(1),
  ADD COLUMN IF NOT EXISTS perc_gas_petroleo numeric(13,2),
  ADD COLUMN IF NOT EXISTS perc_gas_nacional numeric(13,2),
  ADD COLUMN IF NOT EXISTS perc_gas_importado numeric(13,2),
  ADD COLUMN IF NOT EXISTS gas_valor_partida numeric(13,2),
  ADD COLUMN IF NOT EXISTS entrada_decomposta char(1),
  ADD COLUMN IF NOT EXISTS calculo_valor_custo_decomp char(2),
  ADD COLUMN IF NOT EXISTS atualiza_multipreco_decomp char(1),
  ADD COLUMN IF NOT EXISTS uso_consumo char(1),
  ADD COLUMN IF NOT EXISTS receitaqtde numeric(13,2),
  ADD COLUMN IF NOT EXISTS idproduto_vasilhame numeric(10,0),
  ADD COLUMN IF NOT EXISTS qtd_min_transf_producao numeric(13,4),
  ADD COLUMN IF NOT EXISTS qtde_maxima_pdv numeric(13,3),
  ADD COLUMN IF NOT EXISTS codperfil_compra numeric(10,0),
  ADD COLUMN IF NOT EXISTS codsetorarmazen numeric(10,0),
  ADD COLUMN IF NOT EXISTS tara_id numeric(10,0),
  ADD COLUMN IF NOT EXISTS atualiza_estoque char(1),
  ADD COLUMN IF NOT EXISTS produto_notavel char(1),
  ADD COLUMN IF NOT EXISTS saida_expedicao char(1),
  ADD COLUMN IF NOT EXISTS vrmargemmin numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrmargemmax numeric(13,2),
  ADD COLUMN IF NOT EXISTS nao_atu_produtos_entrada varchar(1),
  ADD COLUMN IF NOT EXISTS unidade_apresentacao char(2),
  ADD COLUMN IF NOT EXISTS conteudo_embalagem numeric(13,4),
  ADD COLUMN IF NOT EXISTS apresentacao_etiqueta numeric(13,4),
  ADD COLUMN IF NOT EXISTS imprime_voucher char(1),
  ADD COLUMN IF NOT EXISTS tipo_produto char(1),
  ADD COLUMN IF NOT EXISTS cod_benef_fiscal numeric(10,0),
  ADD COLUMN IF NOT EXISTS codservico varchar(6),
  ADD COLUMN IF NOT EXISTS tipo_item numeric(10,0),
  ADD COLUMN IF NOT EXISTS fci varchar(37),
  ADD COLUMN IF NOT EXISTS custo_importacao_fci numeric(13,2),
  ADD COLUMN IF NOT EXISTS conteudo_importacao_fci numeric(13,2),
  ADD COLUMN IF NOT EXISTS custo_interestadual_fci numeric(13,2),
  ADD COLUMN IF NOT EXISTS codlocal_impressao numeric(10,0),
  ADD COLUMN IF NOT EXISTS modeloeitqueta varchar(200),
  ADD COLUMN IF NOT EXISTS gluten char(1),
  ADD COLUMN IF NOT EXISTS conservacao varchar(1000),
  ADD COLUMN IF NOT EXISTS alergicos varchar(1000),
  ADD COLUMN IF NOT EXISTS decomposicao_un char(1),
  ADD COLUMN IF NOT EXISTS modo_preparo_receita varchar(4000),
  ADD COLUMN IF NOT EXISTS receitaunidade char(2),
  ADD COLUMN IF NOT EXISTS aliq_adrem_glp numeric(15,4),
  ADD COLUMN IF NOT EXISTS decomposicao_livre char(1),
  ADD COLUMN IF NOT EXISTS receitarentabilidade numeric(13,3),
  ADD COLUMN IF NOT EXISTS receitapercas numeric(13,3),
  ADD COLUMN IF NOT EXISTS qtde numeric(13,3),
  ADD COLUMN IF NOT EXISTS exibesicomandamobile char(1),
  ADD COLUMN IF NOT EXISTS valor_variavel numeric(13,2),
  ADD COLUMN IF NOT EXISTS tipo_valor_variavel varchar(1),
  ADD COLUMN IF NOT EXISTS dtalteracao_integracao timestamptz,
  ADD COLUMN IF NOT EXISTS tipo_integracao varchar(250),
  ADD COLUMN IF NOT EXISTS idctc numeric(10,0),
  ADD COLUMN IF NOT EXISTS produto_ancora char(1),
  ADD COLUMN IF NOT EXISTS saida_decomposta char(1),
  ADD COLUMN IF NOT EXISTS nao_decompor_saida char(1),
  ADD COLUMN IF NOT EXISTS produto_voucher char(1),
  ADD COLUMN IF NOT EXISTS gerar_m220_m620 varchar(1),
  ADD COLUMN IF NOT EXISTS uf_orig_comb_nac varchar(2),
  ADD COLUMN IF NOT EXISTS uf_orig_comb_imp varchar(2);

-- receita_prod ← RECEITA_PROD (86 linhas; 3 colunas)
ALTER TABLE receita_prod
  ADD COLUMN IF NOT EXISTS codetapas numeric(10,0),
  ADD COLUMN IF NOT EXISTS ordem numeric(10,0),
  ADD COLUMN IF NOT EXISTS flg_ingrediente_principal varchar(1);

-- relacao_operador_perfil ← RELACAO_OPERADOR_PERFIL (62 linhas; 2 colunas)
ALTER TABLE relacao_operador_perfil
  ADD COLUMN IF NOT EXISTS indr_usuario numeric(10,0),
  ADD COLUMN IF NOT EXISTS indr_data timestamptz;

-- saldo_operador ← SALDO_OPERADOR (25.460 linhas; 1 colunas)
ALTER TABLE saldo_operador
  ADD COLUMN IF NOT EXISTS chave varchar(14);

-- scrap ← SCRAP (3.794 linhas; 2 colunas)
ALTER TABLE scrap
  ADD COLUMN IF NOT EXISTS old_codparceiro numeric(10,0),
  ADD COLUMN IF NOT EXISTS codpedidos numeric(10,0);

-- scrap_item ← SCRAP_ITEM (133.324 linhas; 4 colunas)
ALTER TABLE scrap_item
  ADD COLUMN IF NOT EXISTS imp_vendas char(1),
  ADD COLUMN IF NOT EXISTS origem_perda char(2),
  ADD COLUMN IF NOT EXISTS vr_custo_reposi numeric(15,4),
  ADD COLUMN IF NOT EXISTS codtroca numeric;

-- situacao_nf ← SITUACAO_NF (194 linhas; 22 colunas)
ALTER TABLE situacao_nf
  ADD COLUMN IF NOT EXISTS usultalteracao numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS dtcadastro timestamptz,
  ADD COLUMN IF NOT EXISTS exige_pedido_compra char(1),
  ADD COLUMN IF NOT EXISTS valida_estoque_disponivel char(1),
  ADD COLUMN IF NOT EXISTS transferencia_mercadorias char(1),
  ADD COLUMN IF NOT EXISTS permite_basecalc_maior100 char(1),
  ADD COLUMN IF NOT EXISTS idpgto_nfe numeric(10,0),
  ADD COLUMN IF NOT EXISTS codoperadoras_nfe numeric(10,0),
  ADD COLUMN IF NOT EXISTS importacao_auto_nf char(2),
  ADD COLUMN IF NOT EXISTS codplanocontas_deb_baixa_cp numeric(10,0),
  ADD COLUMN IF NOT EXISTS codplanocontas_cred_baixa_cr numeric(10,0),
  ADD COLUMN IF NOT EXISTS idsituacao_nf_financeiro numeric(10,0),
  ADD COLUMN IF NOT EXISTS gerar_contas_receber varchar(1),
  ADD COLUMN IF NOT EXISTS dias_prazo numeric(10,0),
  ADD COLUMN IF NOT EXISTS estoque char(2),
  ADD COLUMN IF NOT EXISTS exige_mapa_carga char(1),
  ADD COLUMN IF NOT EXISTS exige_scrap char(1),
  ADD COLUMN IF NOT EXISTS exige_cheque char(1),
  ADD COLUMN IF NOT EXISTS valida_conteudo_emb char(1),
  ADD COLUMN IF NOT EXISTS codclass_trib numeric(10,0),
  ADD COLUMN IF NOT EXISTS ativo char(1);

-- situacao_nf_parceiros ← SITUACAO_NF_PARCEIROS (146 linhas; 2 colunas)
ALTER TABLE situacao_nf_parceiros
  ADD COLUMN IF NOT EXISTS dtcadastro timestamptz,
  ADD COLUMN IF NOT EXISTS codoperador numeric(10,0);

-- troca ← TROCA (107 linhas; 1 colunas)
ALTER TABLE troca
  ADD COLUMN IF NOT EXISTS status numeric(10,0);

-- unidade ← UNIDADE (11 linhas; 11 colunas)
ALTER TABLE unidade
  ADD COLUMN IF NOT EXISTS producao char(1),
  ADD COLUMN IF NOT EXISTS indr varchar(1),
  ADD COLUMN IF NOT EXISTS indr_usuario numeric(10,0),
  ADD COLUMN IF NOT EXISTS indr_data timestamptz,
  ADD COLUMN IF NOT EXISTS usualteracao numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS dtcadastro timestamptz,
  ADD COLUMN IF NOT EXISTS ativo varchar(1),
  ADD COLUMN IF NOT EXISTS fracionado varchar(1),
  ADD COLUMN IF NOT EXISTS usultalteracao numeric(10,0),
  ADD COLUMN IF NOT EXISTS mixfiscal_dt timestamptz;

-- vendas ← VENDAS (18.995.349 linhas; 141 colunas)
ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS idempresa_bk numeric,
  ADD COLUMN IF NOT EXISTS comissao numeric(13,2),
  ADD COLUMN IF NOT EXISTS state char(1),
  ADD COLUMN IF NOT EXISTS ccf char(10),
  ADD COLUMN IF NOT EXISTS importado_devolucao char(1),
  ADD COLUMN IF NOT EXISTS desc_ajustado_unit numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrfechamento numeric(15,2),
  ADD COLUMN IF NOT EXISTS qtdelibambev numeric(13,2),
  ADD COLUMN IF NOT EXISTS desclibambev numeric(13,2),
  ADD COLUMN IF NOT EXISTS codimportacao numeric(10,0),
  ADD COLUMN IF NOT EXISTS atualiza_estoque char(1),
  ADD COLUMN IF NOT EXISTS cnpj_cpf varchar(30),
  ADD COLUMN IF NOT EXISTS nrocomanda varchar(30),
  ADD COLUMN IF NOT EXISTS idclubedesconto numeric(10,0),
  ADD COLUMN IF NOT EXISTS qtde_clubedesconto numeric(13,3),
  ADD COLUMN IF NOT EXISTS desc_clubedesconto numeric(13,2),
  ADD COLUMN IF NOT EXISTS qtde_promocao numeric(13,3),
  ADD COLUMN IF NOT EXISTS idproacumulativa numeric(10,0),
  ADD COLUMN IF NOT EXISTS promocao_departamento varchar(100),
  ADD COLUMN IF NOT EXISTS pedidonro varchar(20),
  ADD COLUMN IF NOT EXISTS pedidoitem numeric(10,0),
  ADD COLUMN IF NOT EXISTS vrdescpreco2 numeric(13,2),
  ADD COLUMN IF NOT EXISTS codproduto_pai numeric(10,0),
  ADD COLUMN IF NOT EXISTS idproduto_pai numeric(10,0),
  ADD COLUMN IF NOT EXISTS nve varchar(6),
  ADD COLUMN IF NOT EXISTS ex_tipi numeric(10,0),
  ADD COLUMN IF NOT EXISTS total_tributos numeric(13,2),
  ADD COLUMN IF NOT EXISTS entra_total numeric(10,0),
  ADD COLUMN IF NOT EXISTS pis_aliquota_valor numeric(13,2),
  ADD COLUMN IF NOT EXISTS cofins_aliquota_valor numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_csosn char(3),
  ADD COLUMN IF NOT EXISTS icms_modalidade_bc numeric(10,0),
  ADD COLUMN IF NOT EXISTS icms_valor_operacao numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_diferimento_percentual numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_valor_diferido numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_motivo_desoneracao numeric(10,0),
  ADD COLUMN IF NOT EXISTS icms_valor_desonerado numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_modalidade_bc_st numeric(10,0),
  ADD COLUMN IF NOT EXISTS icms_mva_st_percentual numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_reducao_bc_st_percentual numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_valor_base_calculo_st numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_aliquota_st numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_valor_st numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_valor_bc_st_retido numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_valor_st_retido numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_valor_bc_st_destino numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_valor_st_destino numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_aliquota_credito_sn numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_valor_credito_sn numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_bc_operacao_propria_perc numeric(13,2),
  ADD COLUMN IF NOT EXISTS icms_uf_st char(2),
  ADD COLUMN IF NOT EXISTS issqn_base_calculo numeric(13,2),
  ADD COLUMN IF NOT EXISTS issqn_aliquota numeric(13,2),
  ADD COLUMN IF NOT EXISTS issqn_valor numeric(13,2),
  ADD COLUMN IF NOT EXISTS issqn_municipio numeric(10,0),
  ADD COLUMN IF NOT EXISTS issqn_item_lista_servicos numeric(10,0),
  ADD COLUMN IF NOT EXISTS issqn_valor_deducao numeric(13,2),
  ADD COLUMN IF NOT EXISTS issqn_valor_outras_retencoes numeric(13,2),
  ADD COLUMN IF NOT EXISTS issqn_vr_desc_incondicionado numeric(13,2),
  ADD COLUMN IF NOT EXISTS issqn_vr_desc_condicionado numeric(13,2),
  ADD COLUMN IF NOT EXISTS issqn_valor_retencao_iss numeric(13,2),
  ADD COLUMN IF NOT EXISTS issqn_indic_exigibilidade_iss numeric(10,0),
  ADD COLUMN IF NOT EXISTS issqn_codigo_servico varchar(20),
  ADD COLUMN IF NOT EXISTS issqn_municipio_incidencia numeric(10,0),
  ADD COLUMN IF NOT EXISTS issqn_pais_sevico_prestado numeric(10,0),
  ADD COLUMN IF NOT EXISTS issqn_numero_processo varchar(30),
  ADD COLUMN IF NOT EXISTS issqn_indic_incentivo_fiscal numeric(10,0),
  ADD COLUMN IF NOT EXISTS hashpaf varchar(32),
  ADD COLUMN IF NOT EXISTS desc_acre_operador numeric(10,0),
  ADD COLUMN IF NOT EXISTS ibpt_federal numeric(13,2),
  ADD COLUMN IF NOT EXISTS ibpt_estadual numeric(13,2),
  ADD COLUMN IF NOT EXISTS ibpt_municipal numeric(13,2),
  ADD COLUMN IF NOT EXISTS ibpt_importado numeric(13,2),
  ADD COLUMN IF NOT EXISTS crz numeric(10,0),
  ADD COLUMN IF NOT EXISTS cro numeric(10,0),
  ADD COLUMN IF NOT EXISTS estoquecomposicao char(1),
  ADD COLUMN IF NOT EXISTS codcomposicao varchar(22),
  ADD COLUMN IF NOT EXISTS ippt char(1),
  ADD COLUMN IF NOT EXISTS chave varchar(14),
  ADD COLUMN IF NOT EXISTS versao varchar(20),
  ADD COLUMN IF NOT EXISTS desc_scanntech numeric(13,2),
  ADD COLUMN IF NOT EXISTS desc_categoria numeric(13,2),
  ADD COLUMN IF NOT EXISTS desc_categoria_mf numeric(13,2),
  ADD COLUMN IF NOT EXISTS idclubedesconto_categoria numeric(10,0),
  ADD COLUMN IF NOT EXISTS idclubedesconto_categoria_mf numeric(10,0),
  ADD COLUMN IF NOT EXISTS idmarca numeric(10,0),
  ADD COLUMN IF NOT EXISTS codparceirocpfpromocao numeric(10,0),
  ADD COLUMN IF NOT EXISTS idclubedesconto_combo numeric(10,0),
  ADD COLUMN IF NOT EXISTS desc_combo numeric(13,2),
  ADD COLUMN IF NOT EXISTS codscrap numeric(10,0),
  ADD COLUMN IF NOT EXISTS chave_cancelamento varchar(14),
  ADD COLUMN IF NOT EXISTS ipterminal varchar(50),
  ADD COLUMN IF NOT EXISTS idclubedesconto_atacarejo numeric(10,0),
  ADD COLUMN IF NOT EXISTS desc_atacarejo numeric(13,2),
  ADD COLUMN IF NOT EXISTS idmultiprecoatacarejo numeric(10,0),
  ADD COLUMN IF NOT EXISTS crescevendas_valor numeric(13,2),
  ADD COLUMN IF NOT EXISTS crescevendas_qtde numeric(13,3),
  ADD COLUMN IF NOT EXISTS crescevendas_vrcd numeric(13,2),
  ADD COLUMN IF NOT EXISTS crescevendas_vrsd numeric(13,2),
  ADD COLUMN IF NOT EXISTS crescevendas_vrp2 numeric(13,2),
  ADD COLUMN IF NOT EXISTS bonificacao numeric(13,2),
  ADD COLUMN IF NOT EXISTS vrajcustodec47530 numeric(13,2),
  ADD COLUMN IF NOT EXISTS mva numeric(15,4),
  ADD COLUMN IF NOT EXISTS end_logradouro varchar(255),
  ADD COLUMN IF NOT EXISTS end_numero numeric(10,0),
  ADD COLUMN IF NOT EXISTS end_complemento varchar(30),
  ADD COLUMN IF NOT EXISTS end_referencia varchar(100),
  ADD COLUMN IF NOT EXISTS end_bairro varchar(100),
  ADD COLUMN IF NOT EXISTS end_idcidade numeric(10,0),
  ADD COLUMN IF NOT EXISTS end_cidade varchar(100),
  ADD COLUMN IF NOT EXISTS end_estado char(2),
  ADD COLUMN IF NOT EXISTS end_cep varchar(8),
  ADD COLUMN IF NOT EXISTS entrega char(1),
  ADD COLUMN IF NOT EXISTS entrega_obs varchar(255),
  ADD COLUMN IF NOT EXISTS entrega_volume numeric(10,0),
  ADD COLUMN IF NOT EXISTS entrega_entregador varchar(100),
  ADD COLUMN IF NOT EXISTS entrega_empacotador varchar(100),
  ADD COLUMN IF NOT EXISTS nroitem_nf numeric(10,0),
  ADD COLUMN IF NOT EXISTS modelo_nf numeric(10,0),
  ADD COLUMN IF NOT EXISTS chavecomposicao varchar(25),
  ADD COLUMN IF NOT EXISTS idempresanew numeric(10,0),
  ADD COLUMN IF NOT EXISTS operadornew numeric(10,0),
  ADD COLUMN IF NOT EXISTS codparceironew numeric(10,0),
  ADD COLUMN IF NOT EXISTS saida_expedicao char(1),
  ADD COLUMN IF NOT EXISTS mercafacil_valor numeric(13,2),
  ADD COLUMN IF NOT EXISTS mercafacil_qtde numeric(13,3),
  ADD COLUMN IF NOT EXISTS ibpt_chave varchar(20),
  ADD COLUMN IF NOT EXISTS idintegracao varchar(40),
  ADD COLUMN IF NOT EXISTS codigobenfiscal varchar(10),
  ADD COLUMN IF NOT EXISTS tipo_venda varchar(3),
  ADD COLUMN IF NOT EXISTS atendimento_avaliacao numeric(10,0),
  ADD COLUMN IF NOT EXISTS atendimento_nota numeric(10,0),
  ADD COLUMN IF NOT EXISTS atendimento_satisfacao numeric(10,0),
  ADD COLUMN IF NOT EXISTS fator numeric(13,3),
  ADD COLUMN IF NOT EXISTS codbarra_promocao varchar(14),
  ADD COLUMN IF NOT EXISTS dtentrega timestamptz,
  ADD COLUMN IF NOT EXISTS mercafacil varchar(1),
  ADD COLUMN IF NOT EXISTS vrcusto_medio numeric(13,2),
  ADD COLUMN IF NOT EXISTS codcclass_trib_ncm_anexos numeric(10,0),
  ADD COLUMN IF NOT EXISTS codvendedor_balanca numeric(10,0),
  ADD COLUMN IF NOT EXISTS data_balanca timestamptz;
