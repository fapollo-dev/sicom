-- EMPRESAS — tabela CANÔNICA da empresa/tenant (corte 1: núcleo + fiscal + precificação/financeiro).
-- Dá identidade real ao `idempresa` (antes só um número do header) e CONSOLIDA o stub `empresa_fiscal`
-- (F6). A tabela legada EMPRESAS tem 265 colunas (kitchen-sink); aqui migramos o subconjunto que dá
-- identidade ao tenant e o que a NF/precificação leem. Adiado (dossiê): certificado/upload, NFC-e/CTe/
-- MDFe, integrações/tokens, e-mail, contingência, contábil/centros-de-custo, master-details, e a CAMADA
-- DE CONFIG chave-valor (CONFIGURACOES/CONFIGURACOES_ESPECIFICAS — onde moram AMBIENTE_NF e os flags
-- fiscais). PK = CODEMPRESA (digitado). NÃO é empresaScoped (a tabela É a empresa; o schema-per-tenant isola).

CREATE TABLE IF NOT EXISTS empresas (
  idempresa          integer PRIMARY KEY,                 -- = CODEMPRESA (legado), digitado
  -- identidade / endereço (enderEmit do XML)
  razao_social       varchar(150) NOT NULL,
  fantasia           varchar(150),
  cnpj               varchar(14) NOT NULL,
  insc               varchar(20),                         -- Inscrição Estadual (IE)
  im                 varchar(20),                         -- Inscrição Municipal
  endereco           varchar(100),
  numero             varchar(10),
  complemento        varchar(60),
  bairro             varchar(50),
  cidade             varchar(50),
  uf                 char(2) NOT NULL,
  cep                varchar(10),
  fone1              varchar(20),
  idcidade           integer,                             -- código IBGE do município (cMun, 7 díg)
  cuf                integer,                             -- código IBGE da UF (cUF, 2 díg) — entra na chave NFe
  -- fiscal / regime
  classfiscal        char(2) NOT NULL DEFAULT 'LR',       -- 'LR' Lucro Real / 'SN' Simples Nacional
  figurafiscal       char(1),                             -- 'D' / 'O'
  contribuinte_icms  char(1),
  alqsimplesnac      numeric(13,2),                       -- obrigatória se classfiscal='SN' (schema)
  serie_nfe          varchar(3) DEFAULT '1',
  tiponfe            char(1) DEFAULT 'D',
  ambiente           char(1) DEFAULT '2',                 -- 1=produção / 2=homologação (no legado é config AMBIENTE_NF — achatado aqui)
  piscofis           numeric(13,2),
  imprenda           numeric(13,2),
  contsocial         numeric(13,2),
  aliquota_estado    numeric(13,2),
  -- precificação / financeiro
  despoperacional    numeric(13,2),                       -- % despesa operacional (precificação)
  margem_venda       numeric(13,2),
  margem_contribuicao numeric(13,2),                      -- validada >= 0 (schema)
  txjuropadrao       numeric(13,2),                       -- taxa de juros padrão do título (F4b)
  tx_juro_apagar     numeric(13,2),
  descmax            numeric(13,2),
  limite_descmax     numeric(13,2),
  -- auditoria (padrão do engine)
  usucadastro        integer,
  dtcadastro         timestamptz,
  usultalteracao     integer,
  dtultimalteracao   timestamptz,
  CONSTRAINT ck_empresas_classfiscal CHECK (classfiscal IN ('LR', 'SN'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_empresas_cnpj ON empresas (cnpj);

-- View de listagem/Pesquisa (a tabela é a empresa; expõe idempresa AS codigo).
CREATE OR REPLACE VIEW get_empresas AS
SELECT
  e.idempresa AS codigo,
  e.idempresa,
  e.razao_social,
  e.fantasia,
  e.cnpj,
  e.insc,
  e.uf,
  e.cidade,
  e.classfiscal,
  e.figurafiscal,
  e.serie_nfe,
  e.despoperacional,
  e.txjuropadrao
FROM empresas e;

-- Reconciliação (Opção A, precedente 014_parceiros): consolida o stub empresa_fiscal → empresas.
-- No cutover real seria um INSERT...SELECT de empresa_fiscal. No seed/embedded a IDENTIDADE é FICTÍCIA
-- de homologação (razão/CNPJ fictícios — NÃO os reais 'JF SUPERMERCADOS'/CNPJ mascarado); mas os PARÂMETROS
-- FISCAIS espelham 1:1 a empresa 1 real do Oracle (CLASSFISCAL LR, FIGURAFISCAL D, MG, IBGE 3170206,
-- DESPOPERACIONAL 20, TXJUROPADRAO 5, PISCONFIS 9.3/IMPRENDA 15/CONTSOCIAL 9/ALIQUOTA_ESTADO 17). CNPJ
-- fictício com DV VÁLIDO (11222333000181) — passa o zCnpj num UPDATE pela tela (o antigo 03923857000155
-- herdado do stub F6 tinha DV inválido).
INSERT INTO empresas (
  idempresa, razao_social, fantasia, cnpj, insc, endereco, numero, bairro, cidade, uf, cep, fone1,
  idcidade, cuf, classfiscal, figurafiscal, contribuinte_icms, serie_nfe, tiponfe, ambiente,
  piscofis, imprenda, contsocial, aliquota_estado, despoperacional, txjuropadrao
) VALUES (
  1, 'EMPRESA HOMOLOGACAO LTDA', 'HOMOLOG', '11222333000181', '0013000010000', 'AV BRASIL', '1000', 'CENTRO', 'UBERLANDIA', 'MG', '38400000', '3432000000',
  3170206, 31, 'LR', 'D', 'S', '001', 'D', '2',
  9.30, 15.00, 9.00, 17.00, 20.00, 5.00
)
ON CONFLICT (idempresa) DO NOTHING;

-- empresa_fiscal (stub F6) consolidado em empresas → os reads da NFe foram repontados p/ `empresas`.
DROP TABLE IF EXISTS empresa_fiscal;

-- RBAC da tela de Empresas (operador 7, empresa 1).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADEMPRESA', 'BTNGRAVAR',            7, 1),
  ('FRMCADEMPRESA', 'BTNEXCLUIR',           7, 1),
  ('FRMCADEMPRESA', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADEMPRESA', 'BTNEDITAR',            7, 1);
