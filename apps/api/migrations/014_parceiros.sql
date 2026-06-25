-- PARCEIROS + PARCEIROS_END — tabela CANÔNICA (núcleo), tabela ÚNICA multi-papel.
-- Criada AQUI (014) porque é a 1ª migration que precisa dela: a tela "Lotes de Cobrança"
-- usa PARCEIROS como "Cobrador" (FUN='S') e como cliente do documento (ARECEBER.CODPARCEIRO),
-- e os endereços (PARCEIROS_END) no grid de itens. A tela de Parceiros (017) só adiciona a
-- view de listagem + índice de duplicidade + RBAC sobre estas mesmas tabelas.
--
-- Modela AMBAS as relações reais do legado:
--   - parceiros_end.codparceiro → parceiros  (1:N: quais endereços são do parceiro)
--   - parceiros.codend → parceiros_end.codend (1:1: qual é o endereço padrão/cobrança)
-- Documento fiscal (CNPJ/CPF, RG/IE) vive em PARCEIROS_END (por endereço), não no master.
-- Tipos Oracle→PG: NUMBER→integer/numeric, VARCHAR2→varchar, CHAR(1)→char(1), DATE→date.

CREATE SEQUENCE IF NOT EXISTS seq_parceiros_codparceiro;
CREATE SEQUENCE IF NOT EXISTS seq_parceiros_end_codend;

CREATE TABLE IF NOT EXISTS parceiros (
  codparceiro      integer PRIMARY KEY DEFAULT nextval('seq_parceiros_codparceiro'),
  idempresa        integer NOT NULL DEFAULT 1,        -- multi-tenant (engine empresaScoped carimba)
  razao            varchar(150) NOT NULL,
  fantasia         varchar(150),
  tipofj           char(1) DEFAULT 'F',               -- F/J/R/G/E (domínio NÃO fechado)
  codend           integer,                           -- endereço padrão/cobrança (1:1)
  -- papéis (6 flags 'S'/'N' INDEPENDENTES; FUN = funcionário/vendedor, NÃO fornecedor)
  cli              char(1) DEFAULT 'N',
  frn              char(1) DEFAULT 'N',
  fun              char(1) DEFAULT 'N',               -- 'S' = cobrador/vendedor (filtro do Lote)
  tra              char(1) DEFAULT 'N',
  con              char(1) DEFAULT 'N',
  ass              char(1) DEFAULT 'N',               -- legado morto (fidelidade)
  ativado          char(1) DEFAULT 'S',
  bloqued          char(1) DEFAULT 'N',
  email            varchar(100),
  dtnascimento     date,
  sexo             char(1),
  estado_civil     char(1),
  obs              varchar(800),
  -- financeiro essencial
  credito          numeric(15,2),
  txjuro           numeric(13,4),
  tolerancia       integer,                           -- dias de carência p/ juros (Lote)
  descpadrao       numeric(13,4),
  diasprazo        integer,
  codvendedor      integer,                           -- → parceiros (FUN='S')
  codconvenio      integer,                           -- → parceiros (CON='S')
  -- auditoria (carimbada pelo engine)
  usucadastro      integer,
  dtcadastro       timestamptz,
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  ultima_alter     varchar(50)
);
ALTER SEQUENCE seq_parceiros_codparceiro OWNED BY parceiros.codparceiro;

CREATE TABLE IF NOT EXISTS parceiros_end (
  codend           integer PRIMARY KEY DEFAULT nextval('seq_parceiros_end_codend'),
  codparceiro      integer NOT NULL REFERENCES parceiros(codparceiro) ON DELETE CASCADE,
  endereco         varchar(150),
  numero           varchar(20),
  complemento      varchar(100),
  bairro           varchar(50),
  cidade           varchar(60),
  idcidade         integer,                           -- ref. lógica p/ CIDADES (IBGE); sem FK (seed parcial)
  uf               char(2),
  cep              varchar(13),
  cnpj_cpf         varchar(30),                       -- documento fiscal vive AQUI
  rg_insc          varchar(30),
  telefone         varchar(20),
  celular          varchar(20),
  fax              varchar(20),
  tipo_endereco    varchar(100),
  endereco_padrao  char(1) DEFAULT 'N',
  ativado          char(1) DEFAULT 'S',
  codpais          integer
);
ALTER SEQUENCE seq_parceiros_end_codend OWNED BY parceiros_end.codend;

-- Seed (empresa 1). Cobradores (FUN='S', usados pelo smoke/testes de Lote: codparceiro 1/2/10)
-- e clientes (FUN='N': 20/21/22). Flags de papel também marcam CLI/FRN p/ a tela de Parceiros.
INSERT INTO parceiros (codparceiro, idempresa, razao, fantasia, tipofj, codend, cli, frn, fun, con, tolerancia) VALUES
  (1,  1, 'COBRADOR PADRAO LTDA',       'COBRADOR 1', 'J', 1, 'N', 'S', 'S', 'N', 5),
  (2,  1, 'COBRADOR DOIS COMERCIO',     'COBRADOR 2', 'J', 2, 'N', 'N', 'S', 'N', 3),
  (10, 1, 'COBRADOR DEZ DISTRIBUIDORA', 'COBRADOR 10','J', 3, 'N', 'N', 'S', 'N', 0),
  (20, 1, 'CLIENTE ALFA COMERCIO ME',   'ALFA',       'J', 4, 'S', 'N', 'N', 'N', 5),
  (21, 1, 'CLIENTE BETA SERVICOS LTDA', 'BETA',       'J', 5, 'S', 'N', 'N', 'N', 2),
  (22, 1, 'CLIENTE GAMA INDUSTRIA SA',  'GAMA',       'J', 6, 'S', 'S', 'N', 'N', 0)
ON CONFLICT (codparceiro) DO NOTHING;
SELECT setval('seq_parceiros_codparceiro', 1000, false);

-- Endereços (codparceiro = dono; parceiros.codend aponta o padrão). codend1 leva um CNPJ
-- conhecido p/ o teste de DUPLICIDADE; os demais ficam sem documento (índice único ignora NULL).
INSERT INTO parceiros_end (codend, codparceiro, endereco, bairro, cidade, uf, telefone, cnpj_cpf, endereco_padrao, ativado) VALUES
  (1, 1,  'RUA DAS FLORES, 100',   'CENTRO',         'PINHEIRO',   'MA', '(98) 3000-0001', '11222333000181', 'S', 'S'),
  (2, 2,  'AV. BRASIL, 2500',      'JARDIM AMERICA', 'SAO LUIS',   'MA', '(98) 3000-0002', NULL,             'S', 'S'),
  (3, 10, 'TRAVESSA SAO JOAO, 45', 'VILA NOVA',      'IMPERATRIZ', 'MA', '(99) 3000-0003', NULL,             'S', 'S'),
  (4, 20, 'RUA DO COMERCIO, 78',   'SANTA CRUZ',     'CAXIAS',     'MA', '(99) 3000-0004', NULL,             'S', 'S'),
  (5, 21, 'RUA PROJETADA, 9',      'CENTRO',         'BACABAL',    'MA', '(99) 3000-0005', NULL,             'S', 'S'),
  (6, 22, 'AV. GETULIO VARGAS, 1', 'CENTRO',         'TIMON',      'MA', '(99) 3000-0006', NULL,             'S', 'S')
ON CONFLICT (codend) DO NOTHING;
SELECT setval('seq_parceiros_end_codend', 1000, false);
