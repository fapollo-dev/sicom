-- 067 — PEDIDO DE COMPRA corte-2: CONDIÇÃO DE PAGAMENTO + PARCELAS.
--
-- Recon Oracle (PINHEIRAO): CONDICOES_PAGTO (37 linhas, GLOBAL) = CODCONPAGTO + DESCRICAO + CD1..CD8 (dias);
-- nº de parcelas = qtd de CDn não-nulos. PEDIDOCOMPRA_PARCELAS (9.010 linhas — feature real, 72,6% dos pedidos):
-- CODPEDCOMPPARCELAS(PK), CODPEDCOMP(FK), IDEMPRESA, DATA(venc), PARCELA, VALOR, QTDEDIASAPOSFATURAMENTO.
-- PEDIDOCOMPRA tem seus PRÓPRIOS CD1..CD8 (OVERRIDE local dos prazos da condição; codconpagto só 44,7% preenchido).
--
-- Regra de geração (RatearTotalNasParcelas, uPedidoCompra.pas:8892): prazos = CD1..CD8 do PEDIDO, senão da
-- CONDIÇÃO (via codconpagto). Para cada CDn não-nulo: 1 parcela; VALOR = round(TOTAL/nParc) com a SOBRA na
-- PRIMEIRA parcela (Σ = total); DATA = data_pedido + CDn dias; QTDEDIASAPOSFATURAMENTO = CDn.
--
-- Escopo single-empresa (o split 1-pedido-N-lojas, IDEMPRESA por parcela = cross-docking, segue ADIADO).

-- ── CONDICOES_PAGTO (cadastral GLOBAL; sem idempresa, sem INDR → hard-delete) ────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_condicoes_pagto;
CREATE TABLE IF NOT EXISTS condicoes_pagto (
  codconpagto      integer PRIMARY KEY DEFAULT nextval('seq_condicoes_pagto'),
  descricao        varchar(100),
  cd1              integer,  -- prazos em DIAS (nº de parcelas = qtd de CDn não-nulos)
  cd2              integer,
  cd3              integer,
  cd4              integer,
  cd5              integer,
  cd6              integer,
  cd7              integer,
  cd8              integer,
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_condicoes_pagto OWNED BY condicoes_pagto.codconpagto;

CREATE OR REPLACE VIEW get_condicoes_pagto AS
SELECT codconpagto AS codigo, codconpagto, descricao, cd1, cd2, cd3, cd4, cd5, cd6, cd7, cd8, dtcadastro
FROM condicoes_pagto;

-- seed de condições canônicas (à vista + prazos clássicos; valores reais do padrão PINHEIRAO).
INSERT INTO condicoes_pagto (codconpagto, descricao, cd1, cd2, cd3) VALUES
  (1,   'À vista',   0,    NULL, NULL),
  (41,  '30',        30,   NULL, NULL),
  (42,  '30/60',     30,   60,   NULL),
  (161, '30/60/90',  30,   60,   90)
ON CONFLICT (codconpagto) DO NOTHING;
-- avança a sequence além dos ids semeados explicitamente (senão o 1º create do CRUD colide na PK).
SELECT setval('seq_condicoes_pagto', GREATEST((SELECT COALESCE(MAX(codconpagto), 0) FROM condicoes_pagto), 1));

-- ── PEDIDOCOMPRA: data-base do faturamento + CD1..CD8 (override local dos prazos da condição) ─────────
-- DATA_FATURAMENTO = a data-base do vencimento das parcelas (legado edtDtFaturamento→DTFATURAMENTO, uPedido
-- Compra.pas:5810; golden: DTFATURAMENTO+QTDIAS casa 99,2% das 9.010 parcelas vs DATA 92,1%). É um INPUT
-- do pedido (preenchido em ~99%, inclusive rascunhos), SEPARADO do marcador "recebido" que o recebimento
-- pôs em `dtfaturamento` (decisão consciente do corte de recebimento — NÃO reusamos aquela coluna aqui).
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS data_faturamento timestamptz;
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS cd1 integer;
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS cd2 integer;
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS cd3 integer;
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS cd4 integer;
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS cd5 integer;
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS cd6 integer;
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS cd7 integer;
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS cd8 integer;

-- ── PEDIDOCOMPRA_PARCELAS (2º detalhe do pedido) ─────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_pedidocompra_parcelas;
CREATE TABLE IF NOT EXISTS pedidocompra_parcelas (
  codpedcompparcelas       integer PRIMARY KEY DEFAULT nextval('seq_pedidocompra_parcelas'),
  codpedcomp               integer NOT NULL REFERENCES pedidocompra(codpedcomp),
  idempresa                integer,                 -- single-empresa (= a do pedido); split multi-loja adiado
  parcela                  integer NOT NULL,        -- número da parcela (1..8)
  data                     timestamptz,             -- vencimento (= data_pedido + qtdediasaposfaturamento)
  valor                    numeric(13,2),           -- valor da parcela (Σ = total do pedido)
  qtdediasaposfaturamento  integer,                 -- dias após a data-base (o CDn)
  indr                     varchar(1)               -- (parcelas são substituídas no update; coluna p/ paridade)
);
ALTER SEQUENCE seq_pedidocompra_parcelas OWNED BY pedidocompra_parcelas.codpedcompparcelas;
CREATE INDEX IF NOT EXISTS ix_pedidocompra_parcelas_ped ON pedidocompra_parcelas (codpedcomp);

-- ── RBAC ─────────────────────────────────────────────────────────────────────────────────────────
-- gerar-parcelas é uma EDIÇÃO do pedido (rateio) → gated pela opção real BTNGRAVAR do FRMPEDIDOCOMPRA (já
-- semeada na 060); o legado não tem opção "gerar parcelas" (o rateio é efeito de editar CD/condição). Só a
-- tela nova de condições precisa de grants próprios.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADCONDICOESPAGTO', 'BTNGRAVAR',  7, 1),
  ('FRMCADCONDICOESPAGTO', 'BTNGRAVAR',  7, 2),
  ('FRMCADCONDICOESPAGTO', 'BTNEXCLUIR', 7, 1),
  ('FRMCADCONDICOESPAGTO', 'BTNEXCLUIR', 7, 2)
ON CONFLICT DO NOTHING;
