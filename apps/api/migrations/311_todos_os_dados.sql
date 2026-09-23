-- 311 — TODOS OS DADOS: as tabelas do legado com dado de negócio que a carga deixaria para trás (FILA, Achado 20).
--
-- Continuação da ordem do usuário ("tem que ter todos os campos", 23/09/2026): depois das colunas (mig 310), as TABELAS.
-- A triagem tabela a tabela das 329 com dado fora do plano — contra a PRODUÇÃO, com a prova de cada veredito no Achado 20
-- — separou o que é cópia, temporária, auditoria técnica, PDV ou sistema de terceiros (fica de fora, com a prova) do que é
-- DADO DE NEGÓCIO: o que uma tela já convertida usa e o Apollo não tinha onde guardar, e o que é de uma tela ainda não
-- convertida mas se perderia na virada. Estas entram aqui, com TODAS as colunas e o tipo do Oracle (gerado do
-- `user_tab_columns`; PK quando o legado tem). O plano de carga é derivado do destino (`plano-universo.py`): criada a
-- tabela, ela entra sozinha na carga.
--
-- ⚠️ A mais importante é a LOG: não é log técnico — é o "Registros de Log" que 21 telas abrem (controle de acesso,
-- produto, NF, contas a pagar/receber, cartão, parceiro…), com o nome do usuário e o valor anterior/atual de cada campo.
-- É o ÚNICO registro de quem mudou permissão de quem (1.501 linhas de PERMISSOES) — a `audit_permissoes` só guarda o
-- programa e a máquina Windows.

-- ═══ o histórico de alterações que o usuário vê em 21 telas (Registros de Log) — inclusive o CONTROLE DE ACESSO ═══
-- log ← LOG (2.490.647 linhas; 11 colunas)
CREATE TABLE IF NOT EXISTS log (
  idlog numeric(10,0),
  acao varchar(30),
  formulario varchar(150),
  tabela varchar(100),
  chave varchar(50),
  valor numeric(10,0),
  codusuario numeric(10,0),
  usuario varchar(100),
  datahora timestamptz,
  historico varchar(4000),
  idempresa numeric(10,0),
  PRIMARY KEY (idlog)
);

-- ═══ agenda de promoção multi-loja ═══
-- agenda_promocao_empresa ← AGENDA_PROMOCAO_EMPRESA (3.191 linhas; 2 colunas)
CREATE TABLE IF NOT EXISTS agenda_promocao_empresa (
  codagenda numeric(10,0),
  codempresa numeric(10,0),
  PRIMARY KEY (codagenda, codempresa)
);

-- ═══ situação da NF: CFOPs permitidos e centros de custo ═══
-- isituacao_nf ← ISITUACAO_NF (148 linhas; 3 colunas)
CREATE TABLE IF NOT EXISTS isituacao_nf (
  idisituacao_nf numeric(10,0),
  idsituacao_nf numeric(10,0),
  codcfop numeric(10,0),
  PRIMARY KEY (idisituacao_nf)
);
-- situacao_nf_plc ← SITUACAO_NF_PLC (333 linhas; 4 colunas)
CREATE TABLE IF NOT EXISTS situacao_nf_plc (
  idsituacao_nf numeric(10,0),
  codplc numeric(10,0),
  dtcadastro timestamptz,
  codoperador numeric(10,0),
  PRIMARY KEY (idsituacao_nf, codplc)
);

-- ═══ NF / SPED / manifesto ═══
-- nfe_ref_dev_ent_vinculo ← NFE_REF_DEV_ENT_VINCULO (589 linhas; 2 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS nfe_ref_dev_ent_vinculo (
  chavenfe_dev varchar(50),
  chavenfe varchar(50)
);
-- tb_speed_aux ← TB_SPEED_AUX (7.796 linhas; 9 colunas)
CREATE TABLE IF NOT EXISTS tb_speed_aux (
  cod_speed_aux numeric(10,0),
  tipo_registro varchar(4),
  codigo_registro numeric(10,0),
  vl_anterior varchar(100),
  vl_atual varchar(100),
  campo varchar(50),
  dt_ini timestamptz,
  dt_fim timestamptz,
  reg_informado char(1),
  PRIMARY KEY (cod_speed_aux)
);
-- decomposicao_nf_qtde ← DECOMPOSICAO_NF_QTDE (290 linhas; 8 colunas)
CREATE TABLE IF NOT EXISTS decomposicao_nf_qtde (
  coddecompnfqtd numeric(10,0),
  codnf numeric(10,0),
  codnfprod numeric(10,0),
  codproduto numeric(10,0),
  codproduto_principal numeric(10,0),
  nroitem numeric(10,0),
  qtde numeric(13,3),
  percentual numeric(13,2),
  PRIMARY KEY (coddecompnfqtd)
);
-- pc_basecredito ← PC_BASECREDITO (18 linhas; 2 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS pc_basecredito (
  idbasecredito numeric(10,0),
  descricao varchar(200)
);
-- pc_tab_ajuste_pis ← PC_TAB_AJUSTE_PIS (10 linhas; 4 colunas)
CREATE TABLE IF NOT EXISTS pc_tab_ajuste_pis (
  cod_aj varchar(10),
  descricao varchar(255),
  tipo char(1),
  ativo char(1),
  PRIMARY KEY (cod_aj)
);
-- pc_tab_ajuste_cofins ← PC_TAB_AJUSTE_COFINS (2 linhas; 4 colunas)
CREATE TABLE IF NOT EXISTS pc_tab_ajuste_cofins (
  cod_aj varchar(10),
  descricao varchar(255),
  tipo char(1),
  ativo char(1),
  PRIMARY KEY (cod_aj)
);
-- md_service_config ← MD_SERVICE_CONFIG (1 linhas; 11 colunas)
CREATE TABLE IF NOT EXISTS md_service_config (
  mdsconfig_id numeric,
  diretorio varchar(255),
  evento varchar(100),
  tempo numeric,
  dtcadastro timestamptz,
  codoperador numeric(10,0),
  inicioautomatico char(1),
  protocolo_seguranca varchar(15),
  criptografia char(1),
  hora_inicial timestamptz,
  hora_final timestamptz,
  PRIMARY KEY (mdsconfig_id)
);
-- md_service_config_emp ← MD_SERVICE_CONFIG_EMP (2 linhas; 4 colunas)
CREATE TABLE IF NOT EXISTS md_service_config_emp (
  mdsconfigemp_id numeric,
  mdsconfig_id numeric,
  codempresa numeric,
  certificado varchar(255),
  PRIMARY KEY (mdsconfigemp_id)
);

-- ═══ compras e produto ═══
-- pedido_nf ← PEDIDO_NF (3.531 linhas; 7 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS pedido_nf (
  codpedido numeric(10,0),
  codnf numeric(10,0),
  tipo char(1),
  modelo char(1),
  indr varchar(1),
  indr_usuario numeric(10,0),
  indr_data timestamptz
);
-- produtos_forn_desassociados ← PRODUTOS_FORN_DESASSOCIADOS (304 linhas; 3 colunas)
CREATE TABLE IF NOT EXISTS produtos_forn_desassociados (
  pfd_id numeric(10,0),
  codparceiro numeric(10,0),
  idproduto numeric(10,0),
  PRIMARY KEY (pfd_id)
);
-- receita_prod_hist ← RECEITA_PROD_HIST (858 linhas; 13 colunas)
CREATE TABLE IF NOT EXISTS receita_prod_hist (
  codreceitahist numeric(10,0),
  codreceita numeric(10,0),
  idproduto numeric(10,0),
  qtde numeric(13,4),
  valor numeric(13,2),
  idproduto_receita numeric(10,0),
  servico char(1),
  unidade char(2),
  fatorcxprod numeric(13,3),
  fatorcxprod_util numeric(13,3),
  dthistorico timestamptz,
  codusuario numeric(10,0),
  operacao char(1),
  PRIMARY KEY (codreceitahist)
);
-- tabela_fornecedores ← TABELA_FORNECEDORES (3 linhas; 24 colunas)
CREATE TABLE IF NOT EXISTS tabela_fornecedores (
  idtf numeric(10,0),
  codfor numeric(10,0),
  usultalteracao numeric(10,0),
  dtultimalteracao timestamptz,
  dtcadastro timestamptz,
  idempresa numeric,
  liberado char(1),
  usuliberacaopri numeric,
  dtliberacaousupri timestamptz,
  usuliberacaoseg numeric,
  dtliberacaoususeg timestamptz,
  usubloqueiopri numeric,
  dtbloqueiousupri timestamptz,
  usubloqueioseg numeric,
  dtbloqueioususeg timestamptz,
  origem varchar(1),
  cd1 numeric(10,0),
  cd2 numeric(10,0),
  cd3 numeric(10,0),
  cd4 numeric(10,0),
  cd5 numeric(10,0),
  cd6 numeric(10,0),
  cd7 numeric(10,0),
  cd8 numeric(10,0),
  PRIMARY KEY (idtf)
);
-- tabela_fornecedores_item ← TABELA_FORNECEDORES_ITEM (96 linhas; 9 colunas)
CREATE TABLE IF NOT EXISTS tabela_fornecedores_item (
  idtfitem numeric(10,0),
  idtf numeric(10,0),
  idproduto numeric(10,0),
  codparceiro numeric(10,0),
  vrcustotabela numeric(13,2),
  uf char(2),
  codbarraaux varchar(14),
  descricaoaux varchar(150),
  codref varchar(20),
  PRIMARY KEY (idtfitem)
);
-- cotacao_participantes ← COTACAO_PARTICIPANTES (5 linhas; 7 colunas)
CREATE TABLE IF NOT EXISTS cotacao_participantes (
  codctcpart numeric(10,0),
  codctc numeric(10,0),
  codparceiro numeric(10,0),
  codoperador numeric(10,0),
  email varchar(100),
  data_envio_email timestamptz,
  whatsapp varchar(20),
  PRIMARY KEY (codctcpart)
);
-- agenda_lote_preco ← AGENDA_LOTE_PRECO (5 linhas; 10 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS agenda_lote_preco (
  idagenda numeric(10,0),
  processado char(1),
  keyfield varchar(50),
  subject varchar(200),
  empresas varchar(200),
  notes varchar(500),
  starttime varchar(30),
  endtime varchar(30),
  idempresa numeric(10,0),
  data timestamptz
);
-- sugest_promo_prod ← SUGEST_PROMO_PROD (471 linhas; 8 colunas)
CREATE TABLE IF NOT EXISTS sugest_promo_prod (
  idsugest_promo_prod numeric(10,0),
  idproduto numeric(10,0),
  operador numeric(10,0),
  idempresa numeric(10,0),
  dtcadastro timestamptz,
  indr char(1),
  indr_usuario numeric(10,0),
  indr_data timestamptz,
  PRIMARY KEY (idsugest_promo_prod)
);
-- acordo_comercial ← ACORDO_COMERCIAL (7 linhas; 37 colunas)
CREATE TABLE IF NOT EXISTS acordo_comercial (
  idacordo numeric(10,0),
  idempresa numeric(10,0),
  nome varchar(150),
  contratado varchar(150),
  razaosocial varchar(150),
  cnpj varchar(30),
  replegal varchar(150),
  nracordo varchar(10),
  tipoacordo varchar(100),
  dtinicio timestamptz,
  dtfim timestamptz,
  vracordo numeric(15,2),
  dtvencto timestamptz,
  duplicata varchar(1),
  bonificacao varchar(1),
  deposito varchar(1),
  outros varchar(4000),
  codparceiro numeric(10,0),
  tipovlr char(1),
  flg_forma_devolucao char(1),
  cod_sit_doc numeric(10,0),
  ndias numeric(10,0),
  codplc numeric(10,0),
  flg_fin_aluguel_gerado varchar(1),
  flg_tipo_acordo char(3),
  flg_config_vencto char(2),
  flg_forma_troca char(20),
  flg_fin_verba_gerado char(1),
  flg_operacao_acordo char(1),
  ativo varchar(1),
  indr varchar(1),
  indr_usuario numeric(10,0),
  indr_data timestamptz,
  usultalteracao numeric(10,0),
  dtultimalteracao timestamptz,
  dtcadastro timestamptz,
  flg_tipo_calculo_nf char(1),
  PRIMARY KEY (idacordo)
);
-- aux_acordo_comercial ← AUX_ACORDO_COMERCIAL (14 linhas; 8 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS aux_acordo_comercial (
  id_auxacordo numeric(10,0),
  codacordo numeric(10,0),
  codaux numeric(10,0),
  tabela varchar(20),
  ativo varchar(1),
  indr varchar(1),
  indr_usuario numeric(10,0),
  indr_data timestamptz
);
-- metas ← METAS (21 linhas; 13 colunas)
CREATE TABLE IF NOT EXISTS metas (
  metacod numeric(10,0),
  idempresa varchar(30),
  meta_ano varchar(4),
  meta_mes varchar(2),
  meta_tipo varchar(1),
  meta_perc numeric(13,2),
  indr varchar(1),
  indr_usuario numeric(10,0),
  indr_data timestamptz,
  usultalteracao numeric(10,0),
  dtultimalteracao timestamptz,
  dtcadastro timestamptz,
  mes_anterior char(1),
  PRIMARY KEY (metacod)
);
-- meta_valores_dpto ← META_VALORES_DPTO (8.129 linhas; 8 colunas)
CREATE TABLE IF NOT EXISTS meta_valores_dpto (
  metacod numeric(10,0),
  mv_dia numeric(10,0),
  idempresa varchar(30),
  coddpto numeric(10,0),
  valor_anterior numeric(13,2),
  valor_atual numeric(13,2),
  valor_meta numeric(13,2),
  valor_esperado numeric(13,2),
  PRIMARY KEY (metacod, mv_dia, coddpto)
);

-- ═══ concorrentes ═══
-- concorrencia ← CONCORRENCIA (20 linhas; 8 colunas)
CREATE TABLE IF NOT EXISTS concorrencia (
  idconcorrencia numeric(10,0),
  desc_concorrencia varchar(150),
  usultalteracao numeric(10,0),
  dtultimalteracao timestamptz,
  dtcadastro timestamptz,
  indr varchar(1),
  indr_data timestamptz,
  indr_usuario numeric(10,0),
  PRIMARY KEY (idconcorrencia)
);
-- analise_concorrencia ← ANALISE_CONCORRENCIA (1 linhas; 6 colunas)
CREATE TABLE IF NOT EXISTS analise_concorrencia (
  idanalise numeric(10,0),
  data_analise timestamptz,
  desc_analise varchar(150),
  usultalteracao numeric(10,0),
  dtultimalteracao timestamptz,
  dtcadastro timestamptz,
  PRIMARY KEY (idanalise)
);
-- ianalise_concorrencia ← IANALISE_CONCORRENCIA (5.824 linhas; 3 colunas)
CREATE TABLE IF NOT EXISTS ianalise_concorrencia (
  idianalise_concorrencia numeric(10,0),
  idanalise numeric(10,0),
  idproduto numeric(10,0),
  PRIMARY KEY (idianalise_concorrencia)
);
-- mov_analise_concorrente ← MOV_ANALISE_CONCORRENTE (6 linhas; 9 colunas)
CREATE TABLE IF NOT EXISTS mov_analise_concorrente (
  idmovanalise numeric(10,0),
  data_mov timestamptz,
  idempresa numeric(10,0),
  idanalise numeric(10,0),
  usultalteracao numeric(10,0),
  dtultimalteracao timestamptz,
  dtcadastro timestamptz,
  ativo char(1),
  analiselivre char(1),
  PRIMARY KEY (idmovanalise)
);
-- imov_analise_concorrente ← IMOV_ANALISE_CONCORRENTE (345.353 linhas; 16 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS imov_analise_concorrente (
  id_imovanalise numeric(10,0),
  idmovanalise numeric(10,0),
  idproduto numeric(10,0),
  idconcorrencia numeric(10,0),
  valor numeric(13,4),
  codbarra varchar(128),
  vratacado2 numeric(13,2),
  qtdatacado2 numeric(13,4),
  vratacado1 numeric(13,2),
  qtdatacado1 numeric(13,4),
  idmobile varchar(128),
  status char(1),
  indr varchar(1),
  indr_data timestamptz,
  indr_usuario numeric(10,0),
  data_captura timestamptz
);

-- ═══ financeiro, caixa e cartão ═══
-- arquivo_mancartao ← ARQUIVO_MANCARTAO (694 linhas; 10 colunas)
CREATE TABLE IF NOT EXISTS arquivo_mancartao (
  cod_arquivo_mancartao numeric(10,0),
  idempresa numeric(10,0),
  arquivo text,
  tipo char(1),
  nomearquivo varchar(100),
  usucadastro numeric(10,0),
  dtcadastro timestamptz,
  indr varchar(1),
  indr_usuario numeric(10,0),
  indr_data timestamptz,
  PRIMARY KEY (cod_arquivo_mancartao)
);
-- rede ← REDE (17 linhas; 2 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS rede (
  idrede numeric(10,0),
  rede varchar(100)
);
-- empresa_rede_estabelecimento ← EMPRESA_REDE_ESTABELECIMENTO (23 linhas; 3 colunas)
CREATE TABLE IF NOT EXISTS empresa_rede_estabelecimento (
  codempresa numeric(10,0),
  ere_rede numeric(10,0),
  ere_numero_estabelecimento varchar(30),
  PRIMARY KEY (codempresa, ere_rede, ere_numero_estabelecimento)
);
-- cx_pedidos ← CX_PEDIDOS (28 linhas; 20 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS cx_pedidos (
  codcxpedidos numeric(10,0),
  codoperadora numeric(10,0),
  nropedido varchar(20),
  operacao varchar(30),
  debito_credito char(1),
  valor numeric(13,2),
  data timestamptz,
  status char(1),
  codgrupo numeric(10,0),
  idempresa numeric(10,0),
  nroterminal numeric(10,0),
  faturado char(1),
  dt_processamento timestamptz,
  controle_fatpedido numeric(10,0),
  tesouraria char(1),
  idrds numeric(10,0),
  idcxpedidos numeric(10,0),
  chave varchar(14),
  troco numeric(13,2),
  idpgto numeric(10,0)
);
-- histareceber ← HISTARECEBER (16 linhas; 5 colunas)
CREATE TABLE IF NOT EXISTS histareceber (
  codhistareceber numeric(10,0),
  data timestamptz,
  codoperador numeric(10,0),
  codrcb numeric(10,0),
  historico varchar(500),
  PRIMARY KEY (codhistareceber)
);
-- contas_bancarias_empresas ← CONTAS_BANCARIAS_EMPRESAS (35 linhas; 2 colunas)
CREATE TABLE IF NOT EXISTS contas_bancarias_empresas (
  codconta numeric(10,0),
  codempresa numeric(10,0),
  PRIMARY KEY (codconta, codempresa)
);
-- contagem_cedulas ← CONTAGEM_CEDULAS (507 linhas; 25 colunas)
CREATE TABLE IF NOT EXISTS contagem_cedulas (
  codcontagem_cedulas numeric(10,0),
  idempresa numeric(10,0),
  data timestamptz,
  valor numeric(15,2),
  codoperador numeric(10,0),
  lote_fechado numeric(10,0),
  c1 numeric(15,0),
  c5 numeric(15,0),
  c10 numeric(15,0),
  c25 numeric(15,0),
  c50 numeric(15,0),
  r1 numeric(15,0),
  r2 numeric(15,0),
  r5 numeric(15,0),
  r10 numeric(15,0),
  r20 numeric(15,0),
  r50 numeric(15,0),
  r100 numeric(15,0),
  r200 numeric(15,0),
  dtcadastro timestamptz,
  usultalteracao numeric(10,0),
  dtultimalteracao timestamptz,
  indr varchar(1),
  indr_usuario numeric(10,0),
  indr_data timestamptz,
  PRIMARY KEY (codcontagem_cedulas)
);
-- finaliza_fechamento ← FINALIZA_FECHAMENTO (386.146 linhas; 10 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS finaliza_fechamento (
  data timestamptz,
  operador numeric(10,0),
  operacao varchar(30),
  vrreal numeric(13,2),
  idempresa numeric(10,0),
  pdv numeric(10,0),
  codifinfech numeric(10,0),
  consolidado char(1),
  tipo numeric(10,0),
  chave varchar(14)
);
-- doc_fechamento ← DOC_FECHAMENTO (2.097.211 linhas; 4 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS doc_fechamento (
  codigo numeric(10,0),
  operacao varchar(30),
  coddocfeh numeric(10,0),
  codifinfech numeric(10,0)
);
-- contacorrenteop ← CONTACORRENTEOP (425 linhas; 3 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS contacorrenteop (
  codoperador numeric(10,0),
  idpgto numeric(10,0),
  saldo numeric(13,2)
);
-- dadoscx ← DADOSCX (133 linhas; 11 colunas)
CREATE TABLE IF NOT EXISTS dadoscx (
  coddadoscx numeric(10,0),
  data timestamptz,
  codpdv numeric(10,0),
  codoperador numeric(10,0),
  codfiscalcaixa numeric(10,0),
  gtinicial numeric(15,2),
  gtfinal numeric(15,2),
  vendab numeric(15,2),
  vendal numeric(15,2),
  cancelamentos numeric(15,2),
  descontos numeric(15,2),
  PRIMARY KEY (coddadoscx)
);
-- caixa_obs ← CAIXA_OBS (21 linhas; 5 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS caixa_obs (
  codempresa numeric(10,0),
  codoperador numeric(10,0),
  data timestamptz,
  nropdv numeric(10,0),
  obs varchar(255)
);
-- cons_reg10_nao_encontrados ← CONS_REG10_NAO_ENCONTRADOS (91.871 linhas; 44 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS cons_reg10_nao_encontrados (
  nomearquivo varchar(200),
  tiporegistro varchar(10),
  ident_trans varchar(30),
  codestab varchar(15),
  dtvenda timestamptz,
  resumo varchar(15),
  comprovante varchar(12),
  nsu varchar(12),
  numerocartao varchar(19),
  vrbruto numeric(13,2),
  parcelas varchar(2),
  vrliquido numeric(13,2),
  valorliqorig numeric(13,2),
  dtcredito timestamptz,
  dtcreditooriginal timestamptz,
  nroparcela varchar(2),
  tipoproduto varchar(1),
  captura varchar(1),
  identrede varchar(3),
  codbco varchar(6),
  agencia varchar(6),
  contacorrente varchar(15),
  vrcomissao numeric(13,2),
  codlojasitef varchar(8),
  autorizacao varchar(30),
  cupomfiscal varchar(20),
  codbandeira varchar(4),
  dtvendasitef timestamptz,
  horavenda varchar(10),
  resumounico varchar(22),
  indarqrecup varchar(6),
  seqarq varchar(6),
  referencia char(1),
  txservico numeric(13,2),
  rede varchar(100),
  bandeira varchar(100),
  modocaptura varchar(50),
  nomeloja varchar(100),
  linha numeric(10,0),
  tipoconciliador varchar(20),
  descricao varchar(100),
  cnpj varchar(20),
  codestabelecimento varchar(20),
  idlote numeric(10,0)
);

-- ═══ conciliadora Boa Vista ═══
-- retorno_pag_boavista ← RETORNO_PAG_BOAVISTA (2.423.986 linhas; 30 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS retorno_pag_boavista (
  data_venda timestamptz,
  nsu varchar(50),
  autorizacao varchar(20),
  plano numeric(10,0),
  rede numeric(10,0),
  bandeira numeric(10,0),
  produto varchar(5),
  numero_lote varchar(20),
  area_cliente varchar(100),
  banco varchar(10),
  agencia varchar(10),
  conta varchar(20),
  codigo_loja_erp numeric(10,0),
  codigo_estabelecimento varchar(30),
  status_conciliacao numeric(10,0),
  valor_bruto numeric(10,2),
  taxa_administracao numeric(10,2),
  valor_administracao numeric(10,2),
  taxa_antecipacao numeric(10,2),
  valor_antecipacao numeric(10,2),
  modo_captura varchar(20),
  hora_venda varchar(10),
  tid varchar(50),
  data_pagamento timestamptz,
  valor_liquido numeric(10,2),
  valor_pago numeric(10,2),
  codigo_produto varchar(10),
  parcela varchar(1),
  status varchar(20),
  baixado char(1)
);
-- registros_boavista ← REGISTROS_BOAVISTA (977.994 linhas; 6 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS registros_boavista (
  codvendcartao numeric(10,0),
  reg_xml varchar(4000),
  tipo_registro char(1),
  observacao varchar(4000),
  codoeprador numeric(10,0),
  dtevento timestamptz
);
-- bandeiras_boavista ← BANDEIRAS_BOAVISTA (420 linhas; 4 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS bandeiras_boavista (
  codigo numeric(10,0),
  descricao varchar(200),
  codigo_depara numeric(10,0),
  idempresa numeric(10,0)
);
-- operadoras_boavista ← OPERADORAS_BOAVISTA (322 linhas; 4 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS operadoras_boavista (
  codigo numeric(10,0),
  descricao varchar(200),
  codigo_depara numeric(10,0),
  idempresa numeric(10,0)
);
-- contas_correntes_boavista ← CONTAS_CORRENTES_BOAVISTA (4 linhas; 4 colunas) — sem PK no legado
CREATE TABLE IF NOT EXISTS contas_correntes_boavista (
  codigo numeric(10,0),
  banco varchar(10),
  agencia varchar(10),
  conta varchar(20)
);

-- ═══ inventário rotativo (tela convertida, mig 170) ═══
-- confirma_inv_rot ← CONFIRMA_INV_ROT (5 linhas; 12 colunas) — a confirmação da coleta quando o lote EXIGECONFIRMACAO
CREATE TABLE IF NOT EXISTS confirma_inv_rot (
  codconfirma_inv_rot numeric(10,0),
  codinv_rotativo numeric(10,0),
  idproduto numeric(10,0),
  quantidade numeric(15,3),
  idempresa numeric(10,0),
  destino varchar(10),
  operacao varchar(15),
  operador numeric(10,0),
  data timestamptz,
  confirmada char(1),
  operador_confirmacao numeric(10,0),
  data_confirmacao timestamptz,
  PRIMARY KEY (codconfirma_inv_rot)
);

-- ═══ e as colunas de uma tabela que entrou no plano junto (vazia no Oracle, mas "todos os campos") ═══
-- reducaoz ← REDUCAOZ (0 linhas): o destino (PDV/SPED) tinha outra forma; as colunas do legado passam a existir
ALTER TABLE reducaoz
  ADD COLUMN IF NOT EXISTS cooi numeric(10,0),
  ADD COLUMN IF NOT EXISTS coof numeric(10,0),
  ADD COLUMN IF NOT EXISTS gtinicial numeric(15,2),
  ADD COLUMN IF NOT EXISTS gtfinal numeric(15,2),
  ADD COLUMN IF NOT EXISTS ntb numeric(13,2),
  ADD COLUMN IF NOT EXISTS stb numeric(13,2),
  ADD COLUMN IF NOT EXISTS descontos numeric(15,2),
  ADD COLUMN IF NOT EXISTS cro numeric(10,0),
  ADD COLUMN IF NOT EXISTS crz numeric(10,0),
  ADD COLUMN IF NOT EXISTS acres numeric(13,2),
  ADD COLUMN IF NOT EXISTS opnf numeric(13,2),
  ADD COLUMN IF NOT EXISTS verificado char(1),
  ADD COLUMN IF NOT EXISTS usultalteracao numeric(10,0),
  ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz,
  ADD COLUMN IF NOT EXISTS dtcadastro timestamptz,
  ADD COLUMN IF NOT EXISTS codimportacao numeric(10,0),
  ADD COLUMN IF NOT EXISTS contabilizado char(1),
  ADD COLUMN IF NOT EXISTS hashpaf varchar(32),
  ADD COLUMN IF NOT EXISTS datareducao timestamptz;
