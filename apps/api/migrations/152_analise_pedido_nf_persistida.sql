-- 152 — ANÁLISE PEDIDO × NF PERSISTIDA (corte-2a de FRMPENDENCIASOPERADOR). O corte-1 (mig 150) trouxe a fila;
-- este corte traz o DOMÍNIO que as pendências APN/RPN apontam: a análise gravada (UAnalisePedidosNF.pas persiste
-- em 7 tabelas; TDB.Inserir em :861-863 e :166/:202/:237). VIVO no golden: 9.030 análises (última 2025-01-09),
-- 17.072 divergências, 55.396 itens fora do pedido. PO_COMPLEMENTO da pendência APN/RPN = APN_ID (o fornecedor
-- da fila resolve por análise→pedido→parceiro — QryPendencias no UDMPendenciasOperador.dfm). O corte-2a é
-- LEITURA (abrir a análise vinculada); o motor NovaAnalise/ProcessarAnalise (escrita + RPN) é o corte-2b.
--
-- INTEGRIDADE (fold auditoria [MÉDIA]): PK composta + FK + NOT NULL COPIADAS do Oracle (user_constraints) — sem
-- elas uma carga repetida do cutover (ou um ProcessarAnalise re-executado no corte-2b) DUPLICARIA as filhas em
-- silêncio e a análise reportaria pedidos/divergências em dobro; e uma linha com codempresa nula ficaria
-- invisível p/ sempre (o `= emp` nunca casa). Larguras conferidas coluna a coluna no Oracle.
CREATE TABLE IF NOT EXISTS analise_pedido_nf (
  apn_id                 integer PRIMARY KEY,
  apn_data_analise       timestamptz NOT NULL,
  apn_status             char(1) NOT NULL, -- golden: F=6.613 · E=1.430 · A=987
  codoperador            integer NOT NULL,
  codempresa             integer NOT NULL,
  apn_total_parcial      char(1),          -- T(otal)=8.967 · P(arcial)=63
  codoperador_finalizado integer,
  apn_diferenca_valor    numeric(15,2),
  apn_status_finalizacao varchar(3)        -- F=5.836 · FEP=777 (finalizada-em-pendência → vira RPN) · null=2.417
);

-- pedidos da análise (N:1 pedido→análise; 9.073 no golden). PK (APN_ID, CODPEDCOMP) + FK p/ o pedido.
CREATE TABLE IF NOT EXISTS analise_pedido_nf_pedido (
  apn_id     integer NOT NULL REFERENCES analise_pedido_nf(apn_id) ON DELETE CASCADE,
  codpedcomp integer NOT NULL REFERENCES pedidocompra(codpedcomp),
  PRIMARY KEY (apn_id, codpedcomp)
);

-- notas da análise — a referência é a FILA DO MANIFESTO: APNN_TABELA='NFE_NAO_CADASTRADAS' em 100% do golden
-- (9.597/9.597) e APNN_REF_NF = CODNFE_NAOCAD (mig 148). A coluna de tabela existe no Oracle p/ generalizar
-- (varchar(50) como lá) e entra na PK, como no Oracle.
CREATE TABLE IF NOT EXISTS analise_pedido_nf_nf (
  apn_id      integer NOT NULL REFERENCES analise_pedido_nf(apn_id) ON DELETE CASCADE,
  apnn_ref_nf integer NOT NULL,
  apnn_tabela varchar(50) NOT NULL,
  PRIMARY KEY (apn_id, apnn_ref_nf, apnn_tabela)
);

-- divergências de quantidade/valor por produto (17.072 no golden; STATUS quase sempre null — 1 'D').
-- numeric(15,3) = NUMBER(15,3) do Oracle (o corte-2b calcula estes valores; a escala é contrato).
CREATE TABLE IF NOT EXISTS analise_pedido_nf_diverg (
  apn_id             integer NOT NULL REFERENCES analise_pedido_nf(apn_id) ON DELETE CASCADE,
  idproduto          integer NOT NULL,
  apnd_quantidade_nf numeric(15,3),
  apnd_quantidade_pc numeric(15,3),
  apnd_valor_nf      numeric(15,3),
  apnd_valor_pc      numeric(15,3),
  status             char(1),
  nronf              varchar(12),
  chavenfe           varchar(50),
  PRIMARY KEY (apn_id, idproduto)
);

-- itens da NF fora do pedido (55.396) e itens do pedido fora da NF (10.007)
CREATE TABLE IF NOT EXISTS analise_pedido_nf_ine_nf (
  apn_id           integer NOT NULL REFERENCES analise_pedido_nf(apn_id) ON DELETE CASCADE,
  idproduto        integer NOT NULL,
  apnin_quantidade numeric(15,3),
  apnin_valor      numeric(15,3),
  PRIMARY KEY (apn_id, idproduto)
);
CREATE TABLE IF NOT EXISTS analise_pedido_nf_ine_pc (
  apn_id           integer NOT NULL REFERENCES analise_pedido_nf(apn_id) ON DELETE CASCADE,
  idproduto        integer NOT NULL,
  apnip_quantidade numeric(15,3),
  apnip_valor      numeric(15,3),
  PRIMARY KEY (apn_id, idproduto)
);

-- conferência de recebimento vinculada (3 linhas no golden — quase morta; copiada por completude)
CREATE TABLE IF NOT EXISTS analise_pedido_nf_cr (
  apn_id integer NOT NULL REFERENCES analise_pedido_nf(apn_id) ON DELETE CASCADE,
  codrcb integer NOT NULL,
  PRIMARY KEY (apn_id, codrcb)
);
-- SEM sequence aqui (fold auditoria): o gerador de APN_ID pertence ao corte-2b, que a criará com OWNED BY e
-- setval a partir do MAX carregado — uma sequence começando em 1 colidiria com os 15.205 ids do golden.
