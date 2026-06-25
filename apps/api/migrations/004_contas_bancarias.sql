-- 3ª tela: CONTAS_BANCARIAS — versão COMPLETA e fiel ao legado (UCadContasBancarias).
-- Exercita: FK/lookup → BANCOS, escopo por empresa (IDEMPRESA), flags S/N e grupo "Boleto".
-- PK CODCONTA via sequence app-side (no Oracle a sequence é ID_CODCONTA, sem trigger).
-- Sem trigger REM no legado → não replica.
-- TODO (Fase X): FK Plano de Contas / aba Operadores quando PLANO_CONTAS/OPERADORES migrarem.
--   (CODLANCCONTABIL é FK → PLANO_CONTAS no legado — coluna criada aqui, mas SEM FK/lookup;
--    a aba "Liberação de operadores" — mestre-detalhe sobre OPERADORES — não foi construída.)
CREATE SEQUENCE IF NOT EXISTS seq_conta_codconta;

CREATE TABLE IF NOT EXISTS contas_bancarias (
  codconta                    integer PRIMARY KEY DEFAULT nextval('seq_conta_codconta'),
  codbco                      integer NOT NULL REFERENCES bancos(codbco), -- FK → BANCOS (lookup, obrigatório)
  idempresa                   integer NOT NULL,                           -- escopo multi-tenant (carimbado no servidor)
  titular                     varchar(50),
  nroconta                    varchar(10),
  gerente                     varchar(50),
  dtabertura                  date,
  fone1                       varchar(15),
  obs                         varchar(300),                               -- MAIÚSCULAS (edtOBSKeyPress)
  codlanccontabil             varchar(30),                                -- FK → PLANO_CONTAS (lookup DEFERIDO)
  convenio                    integer,                                    -- INTEIRO (6 ou 7 dígitos quando informado)
  carteira_cobranca           integer,
  variacao_carteira           integer,
  tipo_cobranca               integer,                                    -- combo 1=Simples 2=Descontada 3=Vendor 4=Vinculada
  codigo_transmissao_cobranca varchar(30),
  nroconvenio_arqrem          varchar(12),
  conta_propria               char(1) NOT NULL DEFAULT 'N',
  exibe_rel_apuracao_caixa    char(1),
  ativo                       char(1) NOT NULL DEFAULT 'S',
  usultalteracao              integer,
  dtultimalteracao            timestamptz,
  dtcadastro                  timestamptz
);
ALTER SEQUENCE seq_conta_codconta OWNED BY contas_bancarias.codconta;

-- View de listagem/Pesquisa: expõe idempresa (engine filtra por empresa), faz LEFT JOIN
-- em BANCOS p/ mostrar o NOME do banco (padrão lookup), + colunas usadas na Pesquisa.
CREATE OR REPLACE VIEW get_contas_bancarias AS
SELECT
  c.codconta,
  c.idempresa,
  c.codbco,
  b.banco,
  c.titular,
  c.nroconta,
  c.gerente,
  c.ativo
FROM contas_bancarias c
LEFT JOIN bancos b ON b.codbco = c.codbco;

-- Seed (idempresa = 1; codbco existentes no seed de BANCOS): 3 contas realistas.
INSERT INTO contas_bancarias
  (codbco, idempresa, titular, nroconta, gerente, dtabertura, fone1, obs,
   convenio, carteira_cobranca, variacao_carteira, tipo_cobranca,
   conta_propria, exibe_rel_apuracao_caixa, ativo)
VALUES
  (1, 1, 'APOLLO MATRIZ LTDA',  '12345-6', 'CARLOS SOUZA',  DATE '2015-03-10', '(34)3266-1000',
   'CONTA MOVIMENTO PRINCIPAL', 123456, 18, 0, 1, 'S', 'S', 'S'),
  (5, 1, 'APOLLO FILIAL LTDA',  '98765-4', 'ANA PEREIRA',   DATE '2018-07-22', '(34)3266-2000',
   'CONTA COBRANCA BRADESCO',  1234567, 9, 0, 2, 'N', 'S', 'S'),
  (9, 1, 'APOLLO FOLHA LTDA',   '55500-1', 'JOSE ALMEIDA',  DATE '2020-01-05', '(34)3266-3000',
   'CONTA FOLHA DE PAGAMENTO',  NULL, NULL, NULL, NULL, 'N', 'N', 'S');

-- RBAC: concede ao operador 7 (empresa 1).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADCONTASBANCARIAS', 'BTNGRAVAR',  7, 1),
  ('FRMCADCONTASBANCARIAS', 'BTNEXCLUIR', 7, 1);
