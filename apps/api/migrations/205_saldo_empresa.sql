-- 205 — SALDO DA EMPRESA (`FRMSALDOEMPRESA`, `uSaldoEmpresa.pas` 1.011 linhas + `udmSaldoEmpresa`).
-- Dossiê: `uSaldoEmpresa.md`. Próxima da fila por USO: **611 acessos, 19 operadores**.
--
-- A tela é um **fluxo de caixa projetado**: uma UNIÃO de cinco fontes por data de vencimento — a receber,
-- cheques de terceiros, cheques próprios, a pagar e cartões a receber (com a data de compensação projetada).
-- As três tabelas abaixo são as que faltavam; as outras já existem.
--
-- ⚠️ **volume real no cliente, medido antes de decidir**: `CHEQUE` tem **11 linhas**, `CHQ_PROPRIO` tem
-- **ZERO** e `AGENDA_PREV_PAGTO` tem **27**. O cliente praticamente não usa cheque — o que também explica a
-- origem 52 (baixa de cheque) estar zerada no razão. Mesmo assim as três entram **inteiras**: são dado do
-- cliente, a carga as descartaria, e 11 cheques em aberto são dinheiro que a empresa espera receber.
--
-- As colunas vêm do dicionário do Oracle, uma a uma — sem recorte, porque o custo é zero e o recorte teria de
-- ser justificado a cada coluna.
CREATE TABLE IF NOT EXISTS cheque (
  codchq                   integer NOT NULL PRIMARY KEY,
  nrocheque                varchar(15),
  valor                    numeric(15,2),
  titular                  varchar(50),
  dtemissao                timestamptz,
  bompara                  timestamptz,
  operador                 integer,
  codcx                    integer,
  codbco                   integer,
  codparceiro              integer,
  nropedido                varchar(20),
  databaixa                timestamptz,
  codopbx                  integer,
  baixado                  char(1),
  observacao               varchar(300),
  idempresa                integer,
  liberado                 char(1),
  qtdechq                  integer,
  idlotebxrcb              integer,
  idlote                   integer,
  devolvido                char(1),
  obsdevolucao             varchar(255),
  datadevolucao            timestamptz,
  tipo_devolucao           integer,
  codcontadevolucao        integer,
  usodevolucao             integer,
  total                    numeric(13,2),
  codpdv                   integer,
  idpgto                   integer,
  cpf_cnpj                 varchar(30),
  consiliado               char(1),
  acredesc                 numeric(13,2),
  valorpg                  numeric(13,2),
  usultalteracao           integer,
  dtultimalteracao         timestamptz,
  idrds                    integer,
  custodia                 char(1),
  codbcocustodia           integer,
  datacustodia             timestamptz,
  codconta                 integer,
  datatransf               timestamptz,
  lotetransf               integer,
  dtcadastro               timestamptz,
  txjuros                  numeric(13,2),
  old_codparceiro          integer,
  dtfechamentocx           timestamptz,
  chave                    varchar(14),
  data_operacao            timestamptz,
  codcobrador              integer,
  sequencia                integer,
  sangria                  varchar(1),
  identificador            varchar(100),
  contabilizado            varchar(1),
  codplc_acredesc          integer,
  codoperador_custodia     integer,
  codmapa                  integer,
  codmaparcb               integer,
  idnf                     integer,
  codchqref                integer
);

CREATE TABLE IF NOT EXISTS chq_proprio (
  codchqproprio            integer NOT NULL PRIMARY KEY,
  valor                    numeric(13,2),
  dtemissao                timestamptz,
  dtvenc                   timestamptz,
  nrocheque                integer,
  codconta                 integer,
  codparceiro              integer,
  operador                 integer,
  baixado                  char(1),
  dtbaixa                  timestamptz,
  operadorbx               integer,
  idempresa                integer,
  idlote                   integer,
  historico                varchar(150),
  idnf                     integer,
  cadastrado_manualmente   varchar(1),
  usultalteracao           integer,
  dtultimalteracao         timestamptz,
  dtcadastro               timestamptz
);

CREATE TABLE IF NOT EXISTS agenda_prev_pagto (
  cod_agenda_prev_pagto    integer NOT NULL PRIMARY KEY,
  ativo                    char(1),
  codparceiro              integer,
  valor                    numeric(15,2),
  dtvigencia               timestamptz,
  diapagto                 integer,
  codempresa               integer,
  usultalteracao           integer,
  dtultimalteracao         timestamptz,
  dtcadastro               timestamptz,
  indr                     varchar(1),
  indr_data                timestamptz,
  indr_usuario             integer,
  codcp                    varchar(200),
  codpai                   numeric(38,0)
);
CREATE INDEX IF NOT EXISTS ix_cheque_bompara ON cheque (idempresa, bompara) WHERE coalesce(baixado,'N') <> 'S';
CREATE INDEX IF NOT EXISTS ix_chq_proprio_venc ON chq_proprio (idempresa, dtvenc) WHERE coalesce(baixado,'N') <> 'S';
CREATE INDEX IF NOT EXISTS ix_agenda_prev_pagto_emp ON agenda_prev_pagto (codempresa, codparceiro);

-- RBAC: gate de tela (o cliente não separa por botão).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES ('FRMSALDOEMPRESA', 'FRMSALDOEMPRESA', 7, 1)
ON CONFLICT DO NOTHING;
