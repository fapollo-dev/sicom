-- 197 — `relatorios` e `relatorios_customizados`: os LAYOUTS do FastReport.
--
-- Correção de rumo. Eu havia concluído que a tela `FRMRELATORIO` não migrava porque "o Apollo não usa
-- FastReport" — o usuário corrigiu: **usa**. E o próprio código já dizia isso, se eu tivesse lido com atenção:
-- `rel-curva-abc.service.ts` porta a regra do **PascalScript de dentro do `.fr3`** (`MasterData1OnBeforePrint`),
-- e `rel-ticket-medio.service.ts:40` registra "ADIADO: impressão frx (`Rel_TicketMedio.fr3`)". Ou seja, o
-- layout não é decoração descartável: é **especificação de regra** e é a impressão que ainda devemos.
--
-- Independentemente de como o Apollo venha a renderizar, estes arquivos são DADO DO CLIENTE e não podem ficar
-- para trás na virada: 659 layouts distintos, dos quais **624 personalizados** por ele ao longo dos anos
-- (1.227 linhas / 54,5 MB em `RELATORIOS`; o maior arquivo tem 6 MB) mais 109 XMLs de dataset em
-- `RELATORIOS_CUSTOMIZADOS` (0,5 MB). Sem a tabela aqui, a carga simplesmente os descartaria.
--
-- `arquivo` é CLOB no Oracle (o extrator já converte LOB→texto). `md5_arquivo` é do legado e serve para
-- conferir se um layout mudou.
CREATE TABLE IF NOT EXISTS relatorios (
  codrelatorio      integer PRIMARY KEY,
  idempresa         integer NOT NULL,
  nome_relatorio    varchar(120) NOT NULL,   -- ex.: 'CurvaABCVendasQuantidade.fr3'
  descricao         varchar(255),
  tipo              varchar(20),             -- 'DEFAULT' (vem do produto) | 'PERSONALIZADO' (o cliente ajustou)
  md5_arquivo       varchar(40),
  arquivo           text,                    -- o .fr3 em si (XML do FastReport)
  usultalteracao    integer,
  dtultimalteracao  timestamptz,
  dtcadastro        timestamptz,
  indr              char(1),
  indr_usuario      integer,
  indr_data         timestamptz
);
CREATE INDEX IF NOT EXISTS ix_relatorios_nome ON relatorios (idempresa, nome_relatorio);

CREATE TABLE IF NOT EXISTS relatorios_customizados (
  codrelatorios_customizados integer PRIMARY KEY,
  idempresa         integer NOT NULL,
  nome_relatorio    varchar(120) NOT NULL,   -- ex.: 'GET_CP_CEN_SALDOFORNECEDORES.XML'
  tipo              varchar(20),
  md5_arquivo       varchar(40),
  arquivo           text,                    -- XML de definição do dataset
  usultalteracao    integer,
  dtultimalteracao  timestamptz,
  dtcadastro        timestamptz,
  indr              char(1),
  indr_usuario      integer,
  indr_data         timestamptz
);
CREATE INDEX IF NOT EXISTS ix_relatorios_cust_nome ON relatorios_customizados (idempresa, nome_relatorio);
