-- 148 — MANIFESTO DO DFe (FRMMANIFESTODFE) — corte 1: o domínio LOCAL. A tela é a 2ª mais usada do sistema
-- (MENUEXPRESS: 27.086 acessos / 33 operadores) e estava fora por depender da SEFAZ; o corte 1 traz tudo que
-- NÃO depende: a fila das NF-e emitidas contra a empresa, o histórico de eventos e as ações locais (ignorar
-- com motivo, exportar XML, encaminhar para a importação de NF-e que já existe — mig 062).
-- O corte 2 (transmissão dos eventos 210200/210210/210220/210240 e distribuição DFe via certificado) fica
-- desenhado mas fora — decisão de ambiente.
--
-- 1) NFE_NAO_CADASTRADAS — a FILA da distribuição DFe. 20.581 linhas no golden; 19.442 (94%) já importadas
--    p/ o sistema, 1.139 pendentes. SITUACAO no golden: 1=20.393 · 3=186 · 2=2 (autorizada/denegada/cancelada
--    — a tela do legado filtra por canceladas via evento 110111, não por esta coluna).
CREATE TABLE IF NOT EXISTS nfe_nao_cadastradas (
  codnfe_naocad            integer PRIMARY KEY,
  chavenfe                 varchar(50) NOT NULL,
  cnpj                     varchar(30),
  razao                    varchar(255),
  ie                       varchar(30),
  dtemissao                timestamptz,
  tipo                     char(1),
  totalnf                  numeric(15,4),
  dtrecbo                  timestamptz,
  protocolo                varchar(50),
  situacao                 integer,
  idempresa                integer NOT NULL,
  modelo                   integer,
  arquivo                  varchar(255),
  dtconsulta               timestamptz,
  codoperador              integer,
  xml_resumido             text,
  importacao_manual        char(1),
  ignorar_manifesto        char(1),          -- 'S' = tirada da fila conscientemente (1 no golden)
  ignorar_manifesto_motivo varchar(255),     -- o MOTIVO é obrigatório na tela quando ignora
  nronf                    varchar(9),
  nfe_importada_sistema    char(1)           -- 'S' = já virou NF de entrada no sistema
);
CREATE INDEX IF NOT EXISTS ix_nfe_naocad_empresa ON nfe_nao_cadastradas (idempresa, dtemissao);
CREATE UNIQUE INDEX IF NOT EXISTS ux_nfe_naocad_chave ON nfe_nao_cadastradas (chavenfe);

-- 2) NFE_EVENTOS — TODOS os eventos por chave (50.782 no golden): manifestação do destinatário (210xxx),
--    eventos do EMITENTE (110111 = cancelamento! 110110 = CC-e) e do fisco (610xxx). A tela pinta a nota de
--    vermelho quando existe 110111 — cancelamento do emitente é REGRA DE NEGÓCIO aqui, não enfeite.
CREATE SEQUENCE IF NOT EXISTS seq_nfe_eventos;
CREATE TABLE IF NOT EXISTS nfe_eventos (
  codnfe_evento          integer PRIMARY KEY DEFAULT nextval('seq_nfe_eventos'),
  orgao_recepcao         varchar(50),
  ambiente               char(1),
  chave_acesso           varchar(200),
  id_evento              varchar(17),
  cnpj_cpf_autor_evento  varchar(145),
  data_evento            timestamptz,
  tipo_evento            integer,
  seq_evento             integer,
  descricao_evento       varchar(100),
  mensagem_autorizacao   varchar(200),
  protocolo_autorizacao  varchar(100),
  data_autorizacao       timestamptz,
  codoperador            integer,
  just_op_nao_realizada  varchar(255),
  razao                  varchar(255),
  correcao               text,
  xml                    text
);
ALTER SEQUENCE seq_nfe_eventos OWNED BY nfe_eventos.codnfe_evento;
CREATE INDEX IF NOT EXISTS ix_nfe_eventos_chave ON nfe_eventos (chave_acesso);

-- 3) NFE_XML — a mig 030 já criou esta tabela p/ o XML da NF EMITIDA e a ATRELOU à nf (codnf NOT NULL) —
--    uma adaptação nossa: no Oracle a NFE_XML não tem CODNF e guarda TAMBÉM o XML baixado pelo manifesto,
--    de nota que AINDA NÃO é NF no sistema. Correção de paridade: codnf vira OPCIONAL (o vínculo aparece
--    quando a nota é importada) e entram as 2 colunas do Oracle que faltavam.
ALTER TABLE nfe_xml ALTER COLUMN codnf DROP NOT NULL;
ALTER TABLE nfe_xml
  ADD COLUMN IF NOT EXISTS codoperador       integer,
  ADD COLUMN IF NOT EXISTS arquivo_exportado char(1);
CREATE INDEX IF NOT EXISTS ix_nfe_xml_chave ON nfe_xml (chavenfe);

-- RBAC — as 6 opções REAIS do Oracle para este form.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMMANIFESTODFE', 'FRMMANIFESTODFE',      7, 1),
  ('FRMMANIFESTODFE', 'BTNBUSCARNOTAS',       7, 1),
  ('FRMMANIFESTODFE', 'BTNIMPORTAR',          7, 1),
  ('FRMMANIFESTODFE', 'BTNMANIFESTACAO',      7, 1),
  ('FRMMANIFESTODFE', 'BTNPESQUISAAVANCADA',  7, 1),
  ('FRMMANIFESTODFE', 'BTNPESQUISARULTIMAS',  7, 1)
ON CONFLICT DO NOTHING;
