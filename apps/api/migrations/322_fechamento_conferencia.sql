-- 322 — FECHAMENTO DE CAIXA, corte 1 (conferência + rascunho): as tabelas que a finalização lê e grava.
--
-- A finalização (`UfinalizaFechamento.pas`) confere o turno do PDV contra os documentos e guarda o RASCUNHO em
-- FINALIZA_FECHAMENTO + DOC_FECHAMENTO a cada fechamento da tela (`ProcessaFinalizaFechamento :2056-2189`).
-- Medido em produção (24/09/2026): o que faltava no destino para ela funcionar igual.

-- 1) HIST_SANGRIA_SUPRIMENTO (71.538 linhas): a mig 142 trouxe só as colunas do relatório. A finalização lê o total
--    por tipo×destino (`:1468-1516`) e INSERE a sangria/o suprimento que o PDV não gravou (`:1838-1874`, 9 SAN e 19 SUP
--    em 2026); o cheque liga por IDENTIFICADOR (`UConsDocs.dfm:530`). As colunas de fechamento/autenticação/lote são
--    do binário novo (1.731 FECHADO e 7.095 AUTENTICADO em 2026). Estava EXCLUÍDA do plano como "PDV" — errado: o
--    retaguarda lê e grava.
ALTER TABLE hist_sangria_suprimento ADD COLUMN IF NOT EXISTS identificador           varchar(100);
ALTER TABLE hist_sangria_suprimento ADD COLUMN IF NOT EXISTS identificador_movcb     varchar(100);
ALTER TABLE hist_sangria_suprimento ADD COLUMN IF NOT EXISTS codoperador_cadastro    integer;
ALTER TABLE hist_sangria_suprimento ADD COLUMN IF NOT EXISTS codoperador_fechado     integer;
ALTER TABLE hist_sangria_suprimento ADD COLUMN IF NOT EXISTS lote_fechado            integer;
ALTER TABLE hist_sangria_suprimento ADD COLUMN IF NOT EXISTS data_fechado            timestamptz;
ALTER TABLE hist_sangria_suprimento ADD COLUMN IF NOT EXISTS codoperador_autenticado integer;
ALTER TABLE hist_sangria_suprimento ADD COLUMN IF NOT EXISTS data_autenticado        timestamptz;
ALTER TABLE hist_sangria_suprimento ADD COLUMN IF NOT EXISTS lote_autenticado        integer;
CREATE SEQUENCE IF NOT EXISTS seq_hist_sangria;                               -- ID_CODHISTSANGRIA
ALTER SEQUENCE seq_hist_sangria OWNED BY hist_sangria_suprimento.codhistsangria;
SELECT setval('seq_hist_sangria', (coalesce((SELECT max(codhistsangria) FROM hist_sangria_suprimento), 0) + 1)::bigint, false);
ALTER TABLE hist_sangria_suprimento ALTER COLUMN codhistsangria SET DEFAULT nextval('seq_hist_sangria');
CREATE INDEX IF NOT EXISTS ix_hist_sangria_chave ON hist_sangria_suprimento (chave);

-- 2) TICKET (49 linhas): a finalização CRIA o ticket que falta a partir do CX_VENDAS da modalidade (`:2254-2280`) e
--    confere pelo VALORLIQ. O fonte não grava a CHAVE; a produção tem CHAVE em 49/49 — o binário novo grava.
--    Sem PK no Oracle; CODTICKET é NOT NULL, vem de ID_CODTICKET e é único (49/49).
CREATE SEQUENCE IF NOT EXISTS seq_ticket;
CREATE TABLE IF NOT EXISTS ticket (
  codticket      integer PRIMARY KEY DEFAULT nextval('seq_ticket'),
  data           timestamptz,
  valor          numeric(13,2),
  valorliq       numeric(13,2),
  nropedido      varchar(30),
  codpdv         integer,
  idpgto         integer,
  idempresa      integer,
  consiliado     char(1),
  codoperador    integer,
  liberado       char(1),
  dtfechamentocx timestamptz,
  chave          varchar(14)
);
ALTER SEQUENCE seq_ticket OWNED BY ticket.codticket;
CREATE INDEX IF NOT EXISTS ix_ticket_empresa_pdv ON ticket (idempresa, codpdv, data);

-- 3) Os ADICIONAIS do total do fechamento (`GetTotalHist :1544-1562`): quando o CAIXA_PDV do turno não traz recarga,
--    correspondente, voucher ou troco solidário, a finalização soma o histórico do PDV. Troco solidário tem 11.134
--    linhas (11 em 2026); recarga, correspondente, voucher e devolução estão vazias na produção, mas a tela as lê —
--    a estrutura vem inteira, com todas as colunas do Oracle.
CREATE TABLE IF NOT EXISTS hist_troco_solidario (
  codhisttrocosolidario integer PRIMARY KEY,
  idempresa      integer NOT NULL,
  codcaixa       integer NOT NULL,
  nropedido      varchar(20),
  nrodocumento   numeric(10,0),
  dtvenda        timestamptz NOT NULL,
  valor          numeric(13,2) NOT NULL,
  codpdv         integer NOT NULL,
  codoperador    integer NOT NULL,
  nsu            varchar(10),
  nsuhost        varchar(30),
  autorizacao    varchar(30),
  numerosorte    varchar(20),
  numeroproposta varchar(20),
  codigo         varchar(50),
  chave          varchar(14) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_hist_troco_solidario_chave ON hist_troco_solidario (chave);

CREATE TABLE IF NOT EXISTS hist_recarga (                                     -- sem PK no Oracle, CODHISTRECARGA anulável
  codhistrecarga integer,
  data           timestamptz,
  codoperadora   integer,
  vl_recarga     numeric(13,2),
  op_telefonia   varchar(100),
  telefone       varchar(50),
  codpdv         integer,
  codcaixa       integer,
  idempresa      integer,
  chave          varchar(14),
  nsu            varchar(10),
  nsuhost        varchar(30)
);
CREATE INDEX IF NOT EXISTS ix_hist_recarga_chave ON hist_recarga (chave);

CREATE TABLE IF NOT EXISTS hist_correspondente (
  codhistcorrespondente integer,
  data           timestamptz,
  codoperadora   integer,
  vl_lancamento  numeric(13,2),
  codpdv         integer,
  codcaixa       integer,
  idempresa      integer,
  codcorresp     integer PRIMARY KEY,
  chave          varchar(14),
  nsu            varchar(10),
  nsuhost        varchar(30)
);
CREATE INDEX IF NOT EXISTS ix_hist_correspondente_chave ON hist_correspondente (chave);

CREATE TABLE IF NOT EXISTS hist_voucher (
  codhistvoucher      integer PRIMARY KEY,
  idempresa           integer,
  codcaixa            integer,
  nropedido           varchar(20),
  nrodocumento        numeric(10,0),
  dtvenda             timestamptz,
  valor               numeric(13,2),
  codpdv              integer,
  origem              varchar(20),
  codoperador         integer,
  codoperadora        integer,
  operadora           varchar(50),
  nsu                 varchar(10),
  nsuhost             varchar(30),
  autorizacao         varchar(30),
  tipomodalidade      integer,
  codrede             integer,
  codbandeira         integer,
  modalidadeoperadora varchar(100),
  codprodutositef     varchar(20),
  nomeprodutositef    varchar(100),
  qtdeprodutositef    integer,
  codfornecedorsitef  integer,
  nomefornecedorsitef varchar(100),
  chave               varchar(14),
  stregistro          char(1),
  cancelado           char(1),
  codhistvoucher_cancelado numeric                                          -- NUMBER sem precisão no Oracle
);
CREATE INDEX IF NOT EXISTS ix_hist_voucher_chave ON hist_voucher (chave);

-- A devolução do tipo DEV (`RealizaConf :2522-2568`): na produção a modalidade DEVOLUCAO tem DESTINO 'RCB' e a tabela
-- está vazia, mas o ramo existe e o rascunho aponta para ela (DOC_FECHAMENTO.CODIGO = CODHISTDEVOLUCAO).
CREATE TABLE IF NOT EXISTS hist_devolucao (
  codhistdevolucao integer PRIMARY KEY,
  idempresa        integer,
  codcaixa         integer,
  nropedido        varchar(20),
  nrodocumento     varchar(30),
  dtvenda          timestamptz,
  valor            numeric(13,2),
  codpdv           integer,
  codoperador      integer,
  chave            varchar(14),
  conciliado       varchar(1),
  dtfechamentocx   date,
  tipo_devolucao   varchar(1),
  sequencia        integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz,
  usultalteracao   integer
);
CREATE INDEX IF NOT EXISTS ix_hist_devolucao_chave ON hist_devolucao (chave);

-- 4) O RASCUNHO: CODIFINFECH (386.146/386.146 distintos) e CODDOCFEH (2.097.211/2.097.211) são NOT NULL e únicos no
--    Oracle, vindos de ID_CODIFINFECH e ID_CODDOCFEH — viram a PK e ganham a sequência (a carga a reposiciona).
ALTER TABLE finaliza_fechamento ALTER COLUMN codifinfech SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'finaliza_fechamento'::regclass AND contype = 'p') THEN
    ALTER TABLE finaliza_fechamento ADD PRIMARY KEY (codifinfech);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'doc_fechamento'::regclass AND contype = 'p') THEN
    ALTER TABLE doc_fechamento ALTER COLUMN coddocfeh SET NOT NULL;
    ALTER TABLE doc_fechamento ADD PRIMARY KEY (coddocfeh);
  END IF;
END $$;
CREATE SEQUENCE IF NOT EXISTS seq_codifinfech;
ALTER SEQUENCE seq_codifinfech OWNED BY finaliza_fechamento.codifinfech;
SELECT setval('seq_codifinfech', (coalesce((SELECT max(codifinfech) FROM finaliza_fechamento), 0) + 1)::bigint, false);
ALTER TABLE finaliza_fechamento ALTER COLUMN codifinfech SET DEFAULT nextval('seq_codifinfech');
CREATE SEQUENCE IF NOT EXISTS seq_coddocfeh;
ALTER SEQUENCE seq_coddocfeh OWNED BY doc_fechamento.coddocfeh;
SELECT setval('seq_coddocfeh', (coalesce((SELECT max(coddocfeh) FROM doc_fechamento), 0) + 1)::bigint, false);
ALTER TABLE doc_fechamento ALTER COLUMN coddocfeh SET DEFAULT nextval('seq_coddocfeh');
CREATE INDEX IF NOT EXISTS ix_finaliza_fechamento_turno ON finaliza_fechamento (idempresa, pdv, operador, chave);
CREATE INDEX IF NOT EXISTS ix_doc_fechamento_linha ON doc_fechamento (codifinfech);

-- 5) Os documentos da conferência são procurados pela CHAVE do turno (`UConsDocs.pas:1112-1161`).
CREATE INDEX IF NOT EXISTS ix_cartao_chave   ON cartao (chave);
CREATE INDEX IF NOT EXISTS ix_areceber_chave ON areceber (chave);
CREATE INDEX IF NOT EXISTS ix_cheque_chave   ON cheque (chave);
