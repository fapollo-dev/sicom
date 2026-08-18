-- 153 — CNAB de COBRANÇA, corte-1: a REMESSA (envio) no layout ITAÚ 400. Dossiê:
-- docs/04-screen-dossier/dossiers/retaguarda/uConfBoleto-CNAB.md (layout validado byte a byte contra os 306
-- arquivos REAIS do Oracle — o CLOB ARQUIVO está em Base64 e decodifica no arquivo que foi ao banco).
-- Golden: 306 arquivos (2022-02 → 2025-03) · 3.787 títulos Itaú · REMESSAS_BOLETOS 457 (Itaú 386 = 84%).
--
-- 1) CONF_INTEG_BANCARIA — a configuração da integração por conta/banco (4 linhas reais no golden: 3× layout
--    C400 [Itaú ×2, BB] e 1× C240). SEQUENCIAREMESSA é ESTADO: gerar remessa incrementa (lock na txn).
CREATE SEQUENCE IF NOT EXISTS seq_conf_integ_bancaria;
CREATE TABLE IF NOT EXISTS conf_integ_bancaria (
  codconf             integer PRIMARY KEY DEFAULT nextval('seq_conf_integ_bancaria'),
  codempresa          integer NOT NULL,
  codbco              integer NOT NULL,          -- banco INTERNO (BANCOS.CODBANCO — ex. 526 = Itaú no golden)
  agencia             varchar(10),
  nrconta             varchar(10),
  codfornbco          varchar(20),               -- código FEBRABAN do banco ('341' Itaú · '001' BB)
  arqteste            char(1) DEFAULT 'N',       -- 'S' = arquivo de homologação bancária ('N' nas 4 do golden)
  usultalteracao      integer,
  dtultimalteracao    timestamptz,
  dtcadastro          timestamptz NOT NULL DEFAULT now(),
  layoutremessa       varchar(10),               -- 'C400' | 'C240'
  codempresa_arquivo  integer,
  dias_baixa_boleto   integer,
  tipo_integ_bancaria varchar(1),                -- 'B' (boleto) nas 4 do golden
  identempresabco     varchar(20),               -- convênio/identificação do cedente no banco
  sequenciaremessa    integer NOT NULL DEFAULT 0,-- sequencial do ARQUIVO (estado — incrementa a cada remessa)
  obs_boleto          varchar(600),
  iniciais_arquivo    varchar(5),                -- prefixo do nome do arquivo (NULL ⇒ 'CB' como no golden)
  nosso_numero_inicial integer,
  habilitar_bolecode  char(1)
);
ALTER SEQUENCE seq_conf_integ_bancaria OWNED BY conf_integ_bancaria.codconf;
CREATE INDEX IF NOT EXISTS ix_conf_integ_emp ON conf_integ_bancaria (codempresa, codbco);

-- 2) ARQUIVO_REMESSA_ARECEBER — 1 linha por arquivo gerado, com o CONTEÚDO.
--    DIVERGÊNCIA DELIBERADA: no Oracle o CLOB guarda o arquivo em BASE64 (artefato do legado: o ACBr grava o
--    .TXT e o app encoda para arquivar). Aqui guardamos TEXTO PURO — o cutover decodifica na carga. O
--    conteúdo continua byte-idêntico ao que vai ao banco.
CREATE SEQUENCE IF NOT EXISTS seq_arquivo_remessa_areceber;
CREATE TABLE IF NOT EXISTS arquivo_remessa_areceber (
  cod_remessa_areceber integer PRIMARY KEY DEFAULT nextval('seq_arquivo_remessa_areceber'),
  arquivo              text NOT NULL,            -- o CNAB em texto puro (linhas de 400 + CRLF)
  nomearquivo          varchar(100) NOT NULL,    -- 'CB' + DDMM + contador(2) + ext (golden: CB100305.TXT)
  -- COLUNA NOSSA (o Oracle não tem): o escopo de tenant não pode depender de JOIN na conta bancária — a conta
  -- é hard-delete no cadastro, e uma remessa órfã ficaria legível por QUALQUER empresa (fold auditoria [ALTA]).
  codempresa           integer NOT NULL,
  codcontacorrente     integer,                  -- a conta bancária (CONTAS_BANCARIAS.CODCONTA)
  usucadastro          integer,
  dtcadastro           timestamptz NOT NULL DEFAULT now(),
  indr                 varchar(1),               -- indicador de reenvio/indisponível (livre no legado)
  indr_usuario         integer,
  indr_data            timestamptz
);
ALTER SEQUENCE seq_arquivo_remessa_areceber OWNED BY arquivo_remessa_areceber.cod_remessa_areceber;
CREATE INDEX IF NOT EXISTS ix_arq_remessa_conta ON arquivo_remessa_areceber (codempresa, dtcadastro);
-- nome do arquivo é ÚNICO por empresa: o banco rejeita/ignora remessa com nome repetido, e sem isto duas
-- configs do mesmo banco (o golden tem DUAS Itaú C400) gerariam o mesmo nome no mesmo dia (fold auditoria).
CREATE UNIQUE INDEX IF NOT EXISTS ux_arq_remessa_nome ON arquivo_remessa_areceber (codempresa, nomearquivo);

-- 3) REF_REMESSA_ARECEBER — os títulos de cada remessa (5.142 no golden). PK composta (o Oracle é heap,
--    mas o par é único de fato e é o que impede duplicar título na mesma remessa).
CREATE TABLE IF NOT EXISTS ref_remessa_areceber (
  cod_remessa_areceber integer NOT NULL REFERENCES arquivo_remessa_areceber(cod_remessa_areceber) ON DELETE CASCADE,
  codrcb               integer NOT NULL,
  PRIMARY KEY (cod_remessa_areceber, codrcb)
);

-- 4) REMESSAS_BOLETOS — o LOG da remessa por banco/conta (457 no golden; TIPOREMESSA 'E'=envio 456 · 'AV'=1).
CREATE SEQUENCE IF NOT EXISTS seq_remessas_boletos;
CREATE TABLE IF NOT EXISTS remessas_boletos (
  codremessa         integer PRIMARY KEY DEFAULT nextval('seq_remessas_boletos'),
  dtgeracao          timestamptz NOT NULL DEFAULT now(),
  nomearquivoremessa varchar(50),
  tiporemessa        char(2),                    -- 'E' envio · 'AV' alteração de vencimento (corte-2)
  codbanco           integer NOT NULL,           -- código FEBRABAN (341/001/033 no golden)
  nomebanco          varchar(50) NOT NULL,       -- o legado conta o arquivo do dia por NOMEBANCO + ano
  nroconta           varchar(30) NOT NULL,
  agencia            varchar(30) NOT NULL,
  codremessabanco    integer                     -- sequencial GLOBAL do banco (NRSEQREMESSAITAU: 1022→3131)
);
ALTER SEQUENCE seq_remessas_boletos OWNED BY remessas_boletos.codremessa;
-- o sequencial global da remessa POR BANCO (o legado usa GetID('NRSEQREMESSAITAU'); começa depois do golden)
CREATE SEQUENCE IF NOT EXISTS seq_remessa_banco_itau START 3132;

-- 4b) REMESSAS_BOLETOS_CONTAS — 1 linha por título da remessa (7.459 no golden). É DELA que o legado lê a
--     consulta da remessa e o CANCELAMENTO (corte-2), então sem os filhos o log fica sem títulos.
CREATE TABLE IF NOT EXISTS remessas_boletos_contas (
  codremessa integer NOT NULL REFERENCES remessas_boletos(codremessa) ON DELETE CASCADE,
  codrcb     integer NOT NULL,
  PRIMARY KEY (codremessa, codrcb)
);

-- 5) o título carimbado (ARECEBER). `desconto_boleto` já existe (mig anterior); entram as colunas do fluxo
--    boleto→remessa que o legado usa como MÁQUINA DE ESTADO:
--      status_boleto        'E' = boleto emitido, ELEGÍVEL à remessa de envio (o filtro do taGerarRemessa)
--                           'C' = cancelamento (remessa de baixa — corte-2)
--      registro_arq_remessa 'S' = já foi ao banco (bloqueia reemissão) · 'C' = cancelado
ALTER TABLE areceber
  ADD COLUMN IF NOT EXISTS status_boleto        char(1),
  ADD COLUMN IF NOT EXISTS nosso_numero_boleto  integer,        -- golden: = CODRCB (8 dígitos no arquivo)
  ADD COLUMN IF NOT EXISTS desconto_boleto_tipo char(1),
  ADD COLUMN IF NOT EXISTS registro_arq_remessa char(1),
  ADD COLUMN IF NOT EXISTS nome_arq_remessa     varchar(50),
  ADD COLUMN IF NOT EXISTS login_arq_remessa    varchar(50),  -- o LOGIN do operador (texto), como no Oracle
  ADD COLUMN IF NOT EXISTS data_arq_remessa     timestamptz,
  ADD COLUMN IF NOT EXISTS remessa              char(1),
  -- DOCNF entra porque é o 2º termo do "seu número" do boleto (duplicata → docnf → codrcb, uConfBoleto:2717).
  -- No Oracle: varchar2(20), 702 títulos preenchidos — e em ZERO deles a duplicata está vazia, ou seja o ramo
  -- do docnf é cópia-fiel-negativa hoje (mantido porque a regra existe e o dado pode mudar).
  ADD COLUMN IF NOT EXISTS docnf                varchar(20);
CREATE INDEX IF NOT EXISTS ix_areceber_status_boleto ON areceber (codempresa, status_boleto);

-- (a configuração da integração NÃO é semeada: fold auditoria [BAIXA] — uma conf de teste em produção
--  conviveria com a real e as duas manteriam sequenciais paralelos, duplicando nome/sequência de arquivo no
--  banco. O smoke cria a sua própria conf e a remove no cleanup; o cutover carrega as 4 reais.)

-- RBAC do form (a tela de boleto/remessa) — operador 7, empresas 1 e 2.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCONFBOLETO', 'FRMCONFBOLETO',   7, 1), ('FRMCONFBOLETO', 'FRMCONFBOLETO',   7, 2),
  ('FRMCONFBOLETO', 'BTNBOLETO',       7, 1), ('FRMCONFBOLETO', 'BTNGERARREMESSA', 7, 1)
ON CONFLICT DO NOTHING;
