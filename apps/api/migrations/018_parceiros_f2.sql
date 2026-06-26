-- PARCEIROS Fase 2: sub-recursos 1:N (bancos / formas de pagamento / relacionamentos /
-- vendedores) + colunas condicionais por papel (Fornecedor/Cliente/Funcionário) + fiscal
-- essencial. Tudo sobre as tabelas canônicas de 014. Doc: dossiers/retaguarda/uCadClientes.md
-- Sub-tabelas confirmadas no Oracle (recon): PARCEIROS_BANCOS, PARCEIROS_PGTO,
-- PARCEIROS_REL, PARCEIROS_VENDEDORES (todas 1:N por CODPARCEIRO).

-- Colunas do master (abas condicionais por papel + fiscal essencial). ADD IF NOT EXISTS.
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS venc_prev        integer;       -- Fornecedor: dia vencimento prev.
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS dtultcompra      date;          -- Fornecedor: última compra
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS classfornecedor  integer;       -- Fornecedor: classe (EPP/ME/EGP)
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS codref           varchar(16);   -- Fornecedor: código de referência
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS codcontabil_for  varchar(30);   -- Fornecedor: conta contábil
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS limite_especial  numeric(15,2); -- Cliente: limite especial
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS codcontabil      varchar(30);   -- Cliente: conta contábil
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS renda            numeric(15,2); -- Funcionário: renda
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS cargo            varchar(60);   -- Funcionário: cargo
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS empresatrabalha  varchar(100);  -- Funcionário: empresa
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS contribuinte_icms char(1);      -- Fiscal essencial
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS classfiscal      char(2);       -- Fiscal essencial

-- Sub-tabela: dados bancários (CODBCO → BANCOS via lookup na tela).
CREATE SEQUENCE IF NOT EXISTS seq_parceiros_bancos;
CREATE TABLE IF NOT EXISTS parceiros_bancos (
  codparceirobanco integer PRIMARY KEY DEFAULT nextval('seq_parceiros_bancos'),
  codparceiro      integer NOT NULL REFERENCES parceiros(codparceiro) ON DELETE CASCADE,
  codbco           integer,        -- → bancos (lookup)
  agencia          varchar(15),
  nrconta          varchar(20)
);
ALTER SEQUENCE seq_parceiros_bancos OWNED BY parceiros_bancos.codparceirobanco;

-- Sub-tabela: formas de pagamento liberadas (IDPGTO → FORMAS_PGTO; lookup DEFERIDO p/ F3).
CREATE SEQUENCE IF NOT EXISTS seq_parceiros_pgto;
CREATE TABLE IF NOT EXISTS parceiros_pgto (
  codparceiros_pgto integer PRIMARY KEY DEFAULT nextval('seq_parceiros_pgto'),
  codparceiro       integer NOT NULL REFERENCES parceiros(codparceiro) ON DELETE CASCADE,
  idpgto            integer,
  modalidade        varchar(60)     -- denormalizado por ora (FORMAS_PGTO não migrada)
);
ALTER SEQUENCE seq_parceiros_pgto OWNED BY parceiros_pgto.codparceiros_pgto;

-- Sub-tabela: relacionamentos/contatos.
CREATE SEQUENCE IF NOT EXISTS seq_parceiros_rel;
CREATE TABLE IF NOT EXISTS parceiros_rel (
  codrelacionamento integer PRIMARY KEY DEFAULT nextval('seq_parceiros_rel'),
  codparceiro       integer NOT NULL REFERENCES parceiros(codparceiro) ON DELETE CASCADE,
  nome              varchar(150),
  doc1              varchar(30),
  doc2              varchar(30),
  tiporel           varchar(50),
  telefone          varchar(20),
  celular           varchar(20),
  endereco          varchar(150)
);
ALTER SEQUENCE seq_parceiros_rel OWNED BY parceiros_rel.codrelacionamento;

-- Sub-tabela: vendedores vinculados (CODVENDEDOR → parceiros FUN='S', lookup na tela).
CREATE SEQUENCE IF NOT EXISTS seq_parceiros_vendedores;
CREATE TABLE IF NOT EXISTS parceiros_vendedores (
  codparceirovendedor integer PRIMARY KEY DEFAULT nextval('seq_parceiros_vendedores'),
  codparceiro         integer NOT NULL REFERENCES parceiros(codparceiro) ON DELETE CASCADE,
  codvendedor         integer         -- → parceiros (FUN='S') — ref. lógica
);
ALTER SEQUENCE seq_parceiros_vendedores OWNED BY parceiros_vendedores.codparceirovendedor;

-- Seed: dá dados aos parceiros do 014 p/ a tela mostrar os sub-grids.
-- Cliente 20 (ALFA): 1 banco + 1 contato + 1 vendedor (codvendedor 1 = COBRADOR/FUN='S').
INSERT INTO parceiros_bancos (codparceiro, codbco, agencia, nrconta) VALUES
  (20, 1, '0204', '12345-6'),
  (1,  2, '0106', '98765-4');
INSERT INTO parceiros_pgto (codparceiro, idpgto, modalidade) VALUES
  (20, 1, 'A VISTA'),
  (20, 2, 'BOLETO');
INSERT INTO parceiros_rel (codparceiro, nome, tiporel, telefone) VALUES
  (20, 'MARIA CONTATO',  'FINANCEIRO', '(98) 98888-0001'),
  (1,  'JOSE COMPRADOR', 'COMERCIAL',  '(98) 98888-0002');
INSERT INTO parceiros_vendedores (codparceiro, codvendedor) VALUES
  (20, 1),
  (20, 2);
