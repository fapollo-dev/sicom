-- NOTA FISCAL (tela-coroa do ERP) — Fase 1: NÚCLEO CADASTRO, SEM EFEITOS.
-- A tela ARMAZENA o documento (header NF + itens NF_PROD + config fiscal por item + status
-- inicial). NÃO move estoque, NÃO gera financeiro, NÃO contabiliza, NÃO transmite (SEFAZ).
-- Esses efeitos (disparados no legado por trigger Oracle ESTOQUE_NOTAS no flip PROC 'N'->'S',
-- e por ARECEBER/APAGAR/DIARIO/ACBr) são fases dedicadas (F3..F6).
-- Doc: docs/04-screen-dossier/dossiers/retaguarda/uNF.md
-- Tipos Oracle->PG: NUMBER->integer/numeric, VARCHAR2->varchar, CHAR(1)->char(1), DATE->date.

-- ── Lookups de apoio ─────────────────────────────────────────────────────────
-- SITUACAO_NF: "natureza do documento" (indexador fiscal). No legado refina CFOP,
-- contabilização e geração financeira. Aqui guardamos o código; seed das comuns.
CREATE TABLE IF NOT EXISTS situacao_nf (
  idsituacao_nf integer PRIMARY KEY,
  descricao     varchar(80) NOT NULL,
  tipo          char(1)                       -- E/S (entrada/saída); NULL = ambos
);

-- CFOP: catálogo de Código Fiscal de Operações. Header e itens guardam o código.
CREATE TABLE IF NOT EXISTS cfop (
  codcfop   char(4) PRIMARY KEY,
  descricao varchar(120) NOT NULL
);

-- ── NF (header) — subset fiel do mais usado (~45 col de 209). empresaScoped. ──
CREATE SEQUENCE IF NOT EXISTS seq_nf_codnf;
CREATE TABLE IF NOT EXISTS nf (
  codnf            integer PRIMARY KEY DEFAULT nextval('seq_nf_codnf'),
  idempresa        integer NOT NULL DEFAULT 1,          -- multi-tenant (engine empresaScoped carimba/filtra)
  -- identificação (MODELO/SERIE/DTCONTABIL são NOT NULL no Oracle — digitados na própria F1)
  tipo             char(1) NOT NULL,                    -- 'E' entrada / 'S' saída
  modelo           integer NOT NULL,                    -- 55=NFe, 65=NFCe, 1=NF mod.1...
  nronf            varchar(12),                          -- número fiscal humano
  serie            varchar(3) NOT NULL,
  dtemissao        date NOT NULL,
  dtcontabil       date NOT NULL,
  dtchegada        date,
  dthorasaida      timestamptz,
  tipoemissao      char(1) DEFAULT '0',                  -- 0=própria / 1=terceiros
  finalidade       char(1) DEFAULT '1',                  -- 1 normal / 2 compl / 3 ajuste / 4 devolução
  cfop             varchar(4),
  idsituacao_nf    integer REFERENCES situacao_nf(idsituacao_nf),
  codparceiro      integer NOT NULL REFERENCES parceiros(codparceiro),
  codparceiro_end  integer,
  indicador_presenca char(1),
  versaoxml        varchar(10),
  -- transporte / volumes
  codtransp        integer,                              -- → parceiros (TRA)
  codtransp_end    integer,
  tipofrete        char(1),
  placatransp      varchar(10),
  ufplacatransp    char(2),
  especie          varchar(30),
  marca            varchar(30),
  numerotransp     varchar(30),
  qtdetransp       numeric(13,3),
  pesobruto        numeric(13,3),
  pesoliquido      numeric(13,3),
  -- totais (somatórios; F1 derivados de Σ itens — sem calcular imposto)
  totalnf          numeric(13,2) NOT NULL DEFAULT 0,
  totalprod        numeric(13,2) DEFAULT 0,
  totaldesc        numeric(13,2) DEFAULT 0,
  totalfrete       numeric(13,2) DEFAULT 0,
  totalseguro      numeric(13,2) DEFAULT 0,
  totalacessorias  numeric(13,2) DEFAULT 0,
  totalicm         numeric(13,2) DEFAULT 0,
  totalbaseicm     numeric(13,2) DEFAULT 0,
  totalipi         numeric(13,2) DEFAULT 0,
  totalicm_st      numeric(13,2) DEFAULT 0,
  totalisento      numeric(13,2) DEFAULT 0,
  -- estado (EIXO A interno + EIXO B SEFAZ) — as travas de edição vivem aqui
  proc             char(1) NOT NULL DEFAULT 'N',         -- 'N' não processada / 'S' processada (trava)
  statusnfe        char(1),                              -- NULL/P/C/D/T (SEFAZ); trava se P/D
  cancelada        char(1) DEFAULT 'N',
  confirmada       char(1) DEFAULT 'N',
  contabilizado    char(1) DEFAULT 'N',                  -- trava edição
  -- contrato de colunas NFe (nascem na F1 vazias; a transmissão é F6)
  chavenfe         varchar(44),
  protocolo_nfe    varchar(20),
  protocolo_cancelamento varchar(20),
  xjust            varchar(255),
  sequencia_nfe    integer,
  tpemissao        integer,
  -- flags fiscais/rateio
  rateio           char(1) DEFAULT 'N',
  contribuinte_icms char(1),                             -- 1/2/9 (Sintegra)
  aproveitamentocredito char(1),
  alteraestoquereversao char(1) DEFAULT 'S',
  -- referência (devolução/complemento)
  codnf_ref        integer,
  -- observações
  obs              varchar(4000),
  obsnf            varchar(4000),
  complemento      varchar(4000),
  -- auditoria (carimbada pelo engine)
  usucadastro      integer,
  dtcadastro       timestamptz,
  usultalteracao   integer,
  dtultimalteracao timestamptz
);
ALTER SEQUENCE seq_nf_codnf OWNED BY nf.codnf;

-- Unicidade da chave fiscal natural — o legado só valida no app (sem UNIQUE no Oracle);
-- reintroduzimos como índice UNIQUE parcial (ignora número vazio durante digitação).
-- Inclui CODPARCEIRO porque a validação do legado é "mesmo número E mesmo fornecedor"
-- (fornecedores distintos repetem números legitimamente na entrada). A unicidade por
-- série da emissão própria (saída) é controle da fase de transmissão (F6).
CREATE UNIQUE INDEX IF NOT EXISTS ux_nf_natural
  ON nf (nronf, serie, modelo, idempresa, tipo, codparceiro)
  WHERE nronf IS NOT NULL AND nronf <> '';
CREATE INDEX IF NOT EXISTS ix_nf_parceiro ON nf (codparceiro);
CREATE INDEX IF NOT EXISTS ix_nf_empresa  ON nf (idempresa);

-- ── NF_PROD (itens) — detalhe 1:N. Config fiscal ARMAZENADA (cálculo = F2). ──
CREATE SEQUENCE IF NOT EXISTS seq_nf_prod_codnfprod;
CREATE TABLE IF NOT EXISTS nf_prod (
  codnfprod     integer PRIMARY KEY DEFAULT nextval('seq_nf_prod_codnfprod'),
  codnf         integer NOT NULL REFERENCES nf(codnf) ON DELETE CASCADE,
  nroitem       integer,                                -- chave natural (codnf, nroitem)
  codproduto    integer NOT NULL,                       -- → produtos.idproduto (join no app); NOT NULL no Oracle
  codprodnota   varchar(25),
  quantidade    numeric(13,3) NOT NULL DEFAULT 0,
  fatorembal    numeric(13,3) DEFAULT 1,                -- qtde efetiva = quantidade * fatorembal
  unidade       char(2),
  vrvenda       numeric(15,4) DEFAULT 0,
  vrcusto       numeric(18,9) DEFAULT 0,
  desconto      numeric(13,2) DEFAULT 0,
  vrdescprod    numeric(13,2) DEFAULT 0,
  bonificacao   numeric(13,2) DEFAULT 0,
  -- fiscal armazenada (CST derivado da figura fiscal; ALIQUOTA é CÓDIGO; valores recalculados em F2).
  -- No Oracle CST/ICMS/IPI/ALIQUOTA/CFOP são NOT NULL — aqui ficam NULLABLE/DEFAULT 0 de propósito:
  -- são DERIVADOS/calculados pelo motor fiscal na F2 (dossiê §7). MARKUP e BCR (NOT NULL no Oracle)
  -- são omitidos na F1 e entram na F2 (precificação/base reduzida ST) — ver dossiê uNF.md §10.
  cfop          varchar(4),
  ncm           varchar(30),
  cest          varchar(20),
  origem_estoque char(2),
  aliquota      char(3),                                 -- código → DET_ALIQUOTA por UF
  icms          numeric(13,2) DEFAULT 0,                 -- alíquota %
  cst           integer,
  csosn         char(3),
  vrbasecalculo numeric(13,2) DEFAULT 0,
  vricm         numeric(13,2) DEFAULT 0,
  icme          numeric(13,2) DEFAULT 0,
  mva           numeric(13,2) DEFAULT 0,
  vrbasest      numeric(13,2) DEFAULT 0,
  vricmst       numeric(13,2) DEFAULT 0,
  streal        numeric(13,2) DEFAULT 0,
  ipi           numeric(13,4) DEFAULT 0,
  fcp_aliquota  numeric(13,2) DEFAULT 0,
  fcp_valor     numeric(13,2) DEFAULT 0,
  pis           char(1),
  cstpiscofins  varchar(3),
  aliqpise      numeric(13,4) DEFAULT 0,
  aliqpiss      numeric(13,4) DEFAULT 0,
  aliqcofinse   numeric(13,4) DEFAULT 0,
  aliqcofinss   numeric(13,4) DEFAULT 0,
  frete         numeric(13,2) DEFAULT 0,
  seguro        numeric(13,2) DEFAULT 0,
  vroutrasdesp  numeric(13,2) DEFAULT 0
);
ALTER SEQUENCE seq_nf_prod_codnfprod OWNED BY nf_prod.codnfprod;
CREATE INDEX IF NOT EXISTS ix_nf_prod_nf ON nf_prod (codnf);

-- ── NF_REFERENCIA (detalhe simples) — NFs referenciadas (devolução/complemento). ──
CREATE SEQUENCE IF NOT EXISTS seq_nf_referencia;
CREATE TABLE IF NOT EXISTS nf_referencia (
  codnfreferencia integer PRIMARY KEY DEFAULT nextval('seq_nf_referencia'),
  codnf           integer NOT NULL REFERENCES nf(codnf) ON DELETE CASCADE,
  codnf_ref       integer,
  chave_ref       varchar(44),
  valor_ref       numeric(13,2)
);
ALTER SEQUENCE seq_nf_referencia OWNED BY nf_referencia.codnfreferencia;
CREATE INDEX IF NOT EXISTS ix_nf_referencia_nf ON nf_referencia (codnf);

-- ── Views de listagem ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW get_situacao_nf AS
  SELECT idsituacao_nf, idsituacao_nf AS codigo, descricao, tipo FROM situacao_nf;
CREATE OR REPLACE VIEW get_cfop AS
  SELECT codcfop, codcfop AS codigo, descricao FROM cfop;

-- Pesquisa/listagem da NF: expõe idempresa (empresaScoped) + decode/joins p/ exibição.
CREATE OR REPLACE VIEW get_nf AS
SELECT
  n.codnf AS codigo,
  n.codnf,
  n.idempresa,
  n.tipo,
  n.modelo,
  n.nronf,
  n.serie,
  n.dtemissao,
  n.cfop,
  n.codparceiro,
  p.razao        AS parceiro,
  n.idsituacao_nf,
  s.descricao    AS situacao,
  n.statusnfe,
  n.proc,
  n.cancelada,
  n.totalnf
FROM nf n
LEFT JOIN parceiros p   ON p.codparceiro = n.codparceiro
LEFT JOIN situacao_nf s ON s.idsituacao_nf = n.idsituacao_nf;

-- ── Seed ────────────────────────────────────────────────────────────────────
INSERT INTO situacao_nf (idsituacao_nf, descricao, tipo) VALUES
  (6,  'NF DE COMPRA',           'E'),
  (8,  'NF DE VENDA',            'S'),
  (2,  'DEVOLUCAO DE VENDA',     'E'),
  (15, 'TRANSFERENCIA ENTRADA',  'E'),
  (16, 'TRANSFERENCIA SAIDA',    'S'),
  (24, 'BONIFICACAO',            'S')
ON CONFLICT (idsituacao_nf) DO NOTHING;

INSERT INTO cfop (codcfop, descricao) VALUES
  ('1102', 'COMPRA PARA COMERCIALIZACAO'),
  ('2102', 'COMPRA PARA COMERCIALIZACAO (OUTRA UF)'),
  ('5102', 'VENDA DE MERCADORIA ADQUIRIDA DE TERCEIROS'),
  ('6102', 'VENDA DE MERCADORIA (OUTRA UF)'),
  ('1202', 'DEVOLUCAO DE VENDA DE MERCADORIA'),
  ('5202', 'DEVOLUCAO DE COMPRA PARA COMERCIALIZACAO'),
  ('1411', 'DEVOLUCAO DE VENDA SUJEITA A ST'),
  ('5405', 'VENDA DE MERCADORIA SUJEITA A ST')
ON CONFLICT (codcfop) DO NOTHING;

-- NF de ENTRADA (compra; fornecedor codparceiro=22 tem FRN='S') e NF de SAÍDA (venda;
-- cliente codparceiro=20 tem CLI='S'). PROC='N' (não processada). tipoemissao='0' (própria),
-- modelo 55 — não cai na trava de terceiros M55. Produtos 1/2/3 vêm do seed de produtos.
INSERT INTO nf (codnf, idempresa, tipo, modelo, nronf, serie, dtemissao, dtcontabil, tipoemissao, finalidade, cfop, idsituacao_nf, codparceiro, codparceiro_end, proc, totalnf, totalprod) VALUES
  (1, 1, 'E', 55, '1001', '1', DATE '2026-06-01', DATE '2026-06-01', '0', '1', '1102', 6, 22, 6, 'N', 0, 0),
  (2, 1, 'S', 55, '2001', '1', DATE '2026-06-02', DATE '2026-06-02', '0', '1', '5102', 8, 20, 4, 'N', 0, 0)
ON CONFLICT (codnf) DO NOTHING;
SELECT setval('seq_nf_codnf', 1000, false);

INSERT INTO nf_prod (codnf, nroitem, codproduto, codprodnota, quantidade, fatorembal, unidade, vrvenda, cfop, ncm, aliquota, icms, cst, origem_estoque) VALUES
  (1, 1, 1, '1', 10, 1, 'UN', 3.50, '1102', '17019900', 'T01', 18, 0, 'E'),
  (1, 2, 2, '2', 5,  1, 'UN', 6.00, '1102', '22021000', 'T01', 18, 0, 'E'),
  (2, 1, 1, '1', 2,  1, 'UN', 4.20, '5102', '17019900', 'T01', 18, 0, 'E')
ON CONFLICT DO NOTHING;
SELECT setval('seq_nf_prod_codnfprod', 1000, false);
SELECT setval('seq_nf_referencia', 1000, false);

-- RBAC: tela da NF + catálogos de apoio (operador 7, empresa 1).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMNF', 'BTNGRAVAR',            7, 1),
  ('FRMNF', 'BTNEXCLUIR',           7, 1),
  ('FRMNF', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMNF', 'BTNEDITAR',            7, 1),
  ('FRMCADSITUACAONF', 'BTNGRAVAR',  7, 1),
  ('FRMCADSITUACAONF', 'BTNEXCLUIR', 7, 1),
  ('FRMCADCFOP',       'BTNGRAVAR',  7, 1),
  ('FRMCADCFOP',       'BTNEXCLUIR', 7, 1);
