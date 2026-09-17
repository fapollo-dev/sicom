-- 230 — CONFIGURADOR DE CONCILIAÇÃO DE CARTÕES (`FRMCADCONFIGCONCILIADOR`). 82 acessos, 6 operadores.
--
-- É o cadastro do LAYOUT com que o Apollo lê a planilha de cada operadora de cartão. Sem ele a conciliação
-- não sabe em que coluna está a data da venda, em qual está o valor, e onde achar o NSU.
--
-- ⚠️ **procedência**: a tela NÃO veio no fonte clonado — zero ocorrências de `CadConfigConciliador` e de
-- `CONFIG_IMPORT_CONCILIADOR` em todo o repositório. A regra abaixo foi reconstruída do DADO, como o motor
-- contábil: os **7 layouts** e os **40 itens** da produção, mais as 245.984 linhas que eles produziram.
--
-- ── Que o mecanismo está VIVO, o dado prova ───────────────────────────────────────────────────────────
-- `ITENS_MANCARTAO` tem **245.984 linhas**, **todas** com `TIPOCONCILIADOR = 'CONFIGURAVEL'` — ou seja, todas
-- entraram por um destes layouts. Vão de **03/06/2024 a 03/05/2026** e **243.420 (98,96%)** casaram com uma
-- venda de cartão. O último layout foi criado em **30/12/2025** e o mais antigo alterado em **17/03/2025**:
-- é cadastro que se mantém, não relíquia.
--
-- ── O que um layout diz ───────────────────────────────────────────────────────────────────────────────
-- O cabeçalho diz de que tipo é o arquivo, em que linha começam os dados, e — o que mais importa — **por qual
-- chave casar** com a venda: data+estabelecimento+valor, data+valor+cartão, NSU ou autorização. Os sete do
-- cliente usam quatro combinações diferentes, e todos marcam pelo menos uma.
--
-- Cada item mapeia UMA coluna da planilha para UM campo de `ITENS_MANCARTAO`:
--   `Texto` (23 itens) · `Data` (9, sempre com formato `dd/MM/yyyy`) · `Valor` (5) · `Fixo` (3)
--
-- ⚠️ **`Fixo` não tem coluna**: o valor vem do cadastro, não do arquivo. É como SODEXO, VR e REDE VENDAS
-- informam o código do estabelecimento, que a planilha deles não traz. Medido: 3 de 3 itens `Fixo` com
-- `CICI_VALOR_FIXO` preenchido e `CICI_POSICAO` nula; e 37 de 37 dos outros tipos exatamente ao contrário.
--
-- ── As invariantes, todas medidas nos 7 layouts / 40 itens ────────────────────────────────────────────
--   · um campo não se repete dentro do layout (0 casos) e uma coluna também não (0 casos)
--   · `CODESTABELECIMENTO`, `VRBRUTO`, `DTVENDA` e `AUTORIZACAO` estão nos **7 de 7** layouts
--   · `dd/MM/yyyy` só aparece em item `Data`; os outros 31 têm formato nulo
--   · a descrição do layout é única
--   · `CICI_TAMANHO` trunca (o NSU da REDE em 8) e só foi usado 1 vez; `CICI_CASAS_DECIMAIS`, nenhuma
--   · `CICI_TABELA` é nula nos 40 e `CICI_VALOR_FORMATADO` é 'S' nos 40 — colunas que o legado tem e não usa
CREATE SEQUENCE IF NOT EXISTS seq_config_import_conciliador START 1;
CREATE SEQUENCE IF NOT EXISTS seq_config_import_conciliador_item START 1;

CREATE TABLE IF NOT EXISTS config_import_conciliador (
  cic_id                       integer PRIMARY KEY DEFAULT nextval('seq_config_import_conciliador'),
  cic_descricao                varchar(100) NOT NULL,
  -- 'EXCEL' nos 7 do cliente; a coluna existe porque o legado a tem e o layout pode mudar de tipo
  cic_tipo_importacao          varchar(20)  NOT NULL DEFAULT 'EXCEL',
  -- a linha em que os dados começam: 2, 3, 14 e 30 nos layouts do cliente (o resto é cabeçalho da operadora)
  cic_linha_inicio_importacao  integer      NOT NULL DEFAULT 1,
  cic_tipo_separacao_campos    varchar(30)  NOT NULL DEFAULT 'COLUNAS EXCEL',
  -- as quatro CHAVES DE CASAMENTO com a venda de cartão. Pelo menos uma tem de estar ligada — nos 7 layouts
  -- do cliente estão: 3 por autorização, 2 por NSU+autorização e 2 por data+estabelecimento+valor.
  buscadataempvlr              char(1) DEFAULT 'N',
  buscadatavlrcartao           char(1) DEFAULT 'N',
  buscansu                     char(1) DEFAULT 'N',
  buscaautorizacao             char(1) DEFAULT 'N',
  usultalteracao               integer,
  dtultimalteracao             timestamp,
  dtcadastro                   timestamp DEFAULT now()
);
ALTER SEQUENCE seq_config_import_conciliador OWNED BY config_import_conciliador.cic_id;
-- a descrição é única nos 7 do cliente, e é por ela que o operador escolhe o layout na importação
CREATE UNIQUE INDEX IF NOT EXISTS ux_config_import_conciliador_desc
  ON config_import_conciliador (upper(cic_descricao));

CREATE TABLE IF NOT EXISTS config_import_conciliador_item (
  cici_id               integer PRIMARY KEY DEFAULT nextval('seq_config_import_conciliador_item'),
  cic_id                integer NOT NULL REFERENCES config_import_conciliador(cic_id) ON DELETE CASCADE,
  -- o campo de ITENS_MANCARTAO que esta coluna alimenta
  cici_campo_tabela     varchar(40) NOT NULL,
  -- 'Texto' · 'Data' · 'Valor' · 'Fixo'
  cici_tipo_campo       varchar(20) NOT NULL,
  -- só faz sentido em 'Data': 'dd/MM/yyyy' nos 9 itens de data do cliente
  cici_formato_campo    varchar(30),
  -- a COLUNA da planilha ('A', 'H', 'AB'…). Nula — e só nula — quando o tipo é 'Fixo'
  cici_posicao          varchar(10),
  -- trunca o valor lido: o NSU da REDE vai a 8 caracteres
  cici_tamanho          integer,
  cici_casas_decimais   integer,
  cici_valor_formatado  char(1) DEFAULT 'S',
  cici_tabela           varchar(40),
  -- o valor que entra quando o tipo é 'Fixo' (o CNPJ do estabelecimento que a planilha não traz)
  cici_valor_fixo       varchar(100)
);
ALTER SEQUENCE seq_config_import_conciliador_item OWNED BY config_import_conciliador_item.cici_id;
-- as duas unicidades que o dado mostra: nem campo nem coluna se repetem dentro de um layout
CREATE UNIQUE INDEX IF NOT EXISTS ux_cici_campo ON config_import_conciliador_item (cic_id, upper(cici_campo_tabela));
CREATE UNIQUE INDEX IF NOT EXISTS ux_cici_posicao ON config_import_conciliador_item (cic_id, upper(cici_posicao))
  WHERE cici_posicao IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cici_cic ON config_import_conciliador_item (cic_id);

INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMCADCONFIGCONCILIADOR', 'FRMCADCONFIGCONCILIADOR', 7, 1)
ON CONFLICT DO NOTHING;

-- ── A TABELA PARA ONDE O LAYOUT APONTA ────────────────────────────────────────────────────────────────
-- `ITENS_MANCARTAO` é onde a planilha da operadora cai depois de lida. Sem ela o layout mapeia colunas para
-- lugar nenhum — e é dela que sai a guarda de exclusão (um layout que já importou não se apaga, porque a
-- linha importada guarda a DESCRIÇÃO do layout e ficaria sem dizer por qual mapa entrou).
--
-- No cliente: **245.984 linhas**, todas `TIPOCONCILIADOR = 'CONFIGURAVEL'`, de 03/06/2024 a 03/05/2026, com
-- **243.420 (98,96%)** já casadas a uma venda (`CODVENDCARTAO` preenchido, `ENCONTRADO = 'S'`).
-- As colunas são as do legado; a conciliação em si é o próximo corte.
CREATE SEQUENCE IF NOT EXISTS seq_itens_mancartao START 1;
CREATE TABLE IF NOT EXISTS itens_mancartao (
  cod_itens_mancartao   integer PRIMARY KEY DEFAULT nextval('seq_itens_mancartao'),
  cod_arquivo_mancartao integer,
  tiporegistro          varchar(10),
  ident_trans           varchar(30),
  codestab              varchar(15),
  dtvenda               timestamp,
  resumo                varchar(15),
  comprovante           varchar(12),
  nsu                   varchar(12),
  numerocartao          varchar(19),
  vrbruto               numeric(13,2),
  parcelas              varchar(2),
  vrliquido             numeric(13,2),
  valorliqorig          numeric(13,2),
  dtcredito             timestamp,
  dtcreditooriginal     timestamp,
  nroparcela            varchar(2),
  tipoproduto           varchar(1),
  captura               varchar(1),
  identrede             varchar(3),
  codbco                varchar(6),
  agencia               varchar(6),
  contacorrente         varchar(15),
  vrcomissao            numeric(13,2),
  txservico             numeric(13,2),
  codlojasitef          varchar(8),
  autorizacao           varchar(30),
  cupomfiscal           varchar(20),
  codbandeira           varchar(4),
  dtvendasitef          timestamp,
  horavenda             varchar(10),
  resumounico           varchar(22),
  indarqrecup           varchar(6),
  seqarq                varchar(6),
  referencia            char(1),
  rede                  varchar(100),
  bandeira              varchar(100),
  modocaptura           varchar(50),
  nomeloja              varchar(100),
  linha                 integer,
  encontrado            varchar(1),
  -- 'CONFIGURAVEL' nas 245.984 linhas do cliente: é o conciliador que lê pelo layout desta tela
  tipoconciliador       varchar(20),
  -- a DESCRIÇÃO do layout que importou a linha — o elo com `config_import_conciliador`
  descricao             varchar(100),
  cnpj                  varchar(20),
  codestabelecimento    varchar(20),
  -- a venda de cartão com que a linha casou
  codvendcartao         integer,
  mod_tab_cartao        varchar(1),
  finalizado            varchar(1),
  tipo_vinculo          varchar(100)
);
ALTER SEQUENCE seq_itens_mancartao OWNED BY itens_mancartao.cod_itens_mancartao;
CREATE INDEX IF NOT EXISTS ix_itens_mancartao_desc  ON itens_mancartao (upper(descricao));
CREATE INDEX IF NOT EXISTS ix_itens_mancartao_venda ON itens_mancartao (codvendcartao);
CREATE INDEX IF NOT EXISTS ix_itens_mancartao_dt    ON itens_mancartao (dtvenda);
