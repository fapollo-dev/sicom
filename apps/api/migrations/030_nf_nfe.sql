-- NOTA FISCAL — Fase 6: NFe modelo 55 (transmissão/cancelamento/CCe) atrás da PORTA SEFAZ.
-- A camada PORTÁVEL (máquina de estados STATUSNFE, chave de acesso 44+DV, eventos, auditoria).
-- A transmissão REAL à SEFAZ (SOAP ve400, assinatura A1, XSD, geração do XML) fica atrás de
-- uma porta (SefazPort) — no corte 1 o provider é um SIMULADOR de homologação; o provider real
-- (ACBrLibNFe / lib NFe Node / microserviço) pluga depois sem tocar no resto. Doc: dossiê §8.
-- A tabela `nf` JÁ nasceu (F1) com as colunas NFe (chavenfe/protocolo_nfe/statusnfe/...) → aqui
-- só entram as tabelas-satélite + a config fiscal mínima da empresa. SEM trigger.

-- Config fiscal mínima por empresa (origem dos campos da CHAVE: cUF/CNPJ/série/ambiente).
-- No legado isto vive em EMPRESAS (não migrada); certificado/CSC/senha ficam de fora (a senha
-- em texto claro do legado é passivo de segurança → vault, fase de cutover). Corte 1: só o
-- necessário p/ montar a chave e marcar o ambiente.
CREATE TABLE IF NOT EXISTS empresa_fiscal (
  idempresa    integer PRIMARY KEY,
  cnpj         varchar(14),
  uf           char(2),
  cuf          integer,                  -- código IBGE da UF (2 díg) — entra na chave de acesso
  serie_nfe    varchar(3) DEFAULT '1',
  ambiente     char(1)    DEFAULT '2',   -- 1=produção / 2=homologação
  razao_social varchar(150)
);

-- Eventos da NFe UNIFICADOS (cancelamento 110111 + carta de correção 110110) — espelha
-- NFE_EVENTOS do legado (que também unifica). seq_evento = nSeqEvento (1..n por nota+tipo).
CREATE SEQUENCE IF NOT EXISTS seq_nfe_evento;
CREATE TABLE IF NOT EXISTS nfe_evento (
  codnfe_evento         integer PRIMARY KEY DEFAULT nextval('seq_nfe_evento'),
  codnf                 integer NOT NULL REFERENCES nf(codnf) ON DELETE CASCADE,
  idempresa             integer,
  chavenfe              varchar(44),
  tipo_evento           integer NOT NULL,            -- 110111 cancelamento / 110110 CCe
  seq_evento            integer DEFAULT 1,           -- nSeqEvento
  ambiente              char(1),
  descricao             varchar(100),
  texto                 text,                         -- xJust (cancel) ou xCorrecao (CCe)
  protocolo_autorizacao varchar(20),
  ver_aplic             varchar(20),                  -- verAplic do retorno (legado NF_CARTA_CORRECAO.VERSAO)
  id_evento             varchar(100),                 -- Id do evento na SEFAZ (preenchido pelo provider real)
  cstat                 integer,
  data_evento           timestamptz,
  data_autorizacao      timestamptz,
  xml                   text,
  simulado              char(1) DEFAULT 'N',
  codoperador           integer,
  UNIQUE (codnf, tipo_evento, seq_evento)
);
ALTER SEQUENCE seq_nfe_evento OWNED BY nfe_evento.codnfe_evento;
CREATE INDEX IF NOT EXISTS ix_nfe_evento_nf ON nfe_evento (codnf);

-- XML autorizado da NFe (fiel a NFE_XML: CLOB inline). Aqui `text`.
CREATE SEQUENCE IF NOT EXISTS seq_nfe_xml;
CREATE TABLE IF NOT EXISTS nfe_xml (
  codnfexml  integer PRIMARY KEY DEFAULT nextval('seq_nfe_xml'),
  codnf      integer NOT NULL REFERENCES nf(codnf) ON DELETE CASCADE,
  idempresa  integer,
  chavenfe   varchar(44),
  modelo     integer,
  ambiente   char(1),
  xml        text,
  simulado   char(1) DEFAULT 'N',
  dtcadastro timestamptz
);
ALTER SEQUENCE seq_nfe_xml OWNED BY nfe_xml.codnfexml;
CREATE INDEX IF NOT EXISTS ix_nfe_xml_nf ON nfe_xml (codnf);

-- Auditoria de envios à SEFAZ (fiel a HISTORICO_ENVIO_NFE).
CREATE SEQUENCE IF NOT EXISTS seq_historico_envio_nfe;
CREATE TABLE IF NOT EXISTS historico_envio_nfe (
  codhistenvnfe integer PRIMARY KEY DEFAULT nextval('seq_historico_envio_nfe'),
  codnf         integer NOT NULL REFERENCES nf(codnf) ON DELETE CASCADE,
  nronf         varchar(12),
  nrolote       varchar(20),
  idempresa     integer,
  tipo          char(1),                  -- S=sucesso / E=erro
  chavenfe      varchar(44),
  cstat         integer,
  mensagem      varchar(255),
  dtenvio       timestamptz
);
ALTER SEQUENCE seq_historico_envio_nfe OWNED BY historico_envio_nfe.codhistenvnfe;
CREATE INDEX IF NOT EXISTS ix_historico_envio_nfe_nf ON historico_envio_nfe (codnf);

-- Seed mínimo da config fiscal da empresa de teste (idempresa 1). CNPJ/UF fictícios de homolog.
INSERT INTO empresa_fiscal (idempresa, cnpj, uf, cuf, serie_nfe, ambiente, razao_social) VALUES
  (1, '03923857000155', 'MG', 31, '1', '2', 'EMPRESA HOMOLOGACAO LTDA')
ON CONFLICT (idempresa) DO NOTHING;

-- RBAC das ações de NFe (operador 7, empresa 1).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMNF', 'BTNTRANSMITIR', 7, 1),
  ('FRMNF', 'BTNCANCELAR',   7, 1),
  ('FRMNF', 'BTNCCE',        7, 1);
