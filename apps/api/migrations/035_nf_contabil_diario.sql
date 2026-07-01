-- NOTA FISCAL — Fase 5b: CONTÁBIL / DIÁRIO (partida dobrada). O EFEITO da F5 (que só armazenava o
-- rateio CODCONTABILNF). FUNDA o razão contábil que o ERP migrado ainda não tinha: PLANO_CONTAS (razão
-- formal), ITENS_INTEGRACAO_CONTABIL (situação→conta D/C), LOTE_CONTABIL e DIARIO. Reconstrói o
-- LancaDiarioContabil legado (motor em package externo) — confrontado com o DIARIO real (888k linhas).
-- Corte-1: LANÇAMENTO PRINCIPAL por situação (nf_contabil → 1 linha DIARIO com CONTADEBITO/CONTACREDITO
-- pela IIC), gated por EMPRESAS.INTEGRACAO='AUTOMATICA', reversível. Linhas de imposto (ICMS/PIS/COFINS/
-- CMV) e o auto-disparo no processar = fase-2 (spec: uNF-F5b-contabil-diario.md).

-- razão contábil FORMAL (destino de CONTADEBITO/CONTACREDITO). Subset seedado do PINHEIRAO real.
CREATE TABLE IF NOT EXISTS plano_contas (
  codplanocontas integer PRIMARY KEY,      -- = PLANO_CONTAS.CODPLANOCONTAS (legado)
  descricao      varchar(120) NOT NULL,
  tipo           char(1),                  -- S(intética)/A(nalítica)
  classe         varchar(20),
  codpai         integer,
  codparceiro    integer,                  -- conta ligada a parceiro (crédito automático)
  status         char(1) DEFAULT 'A'
);

-- mapeamento situação → contas (D e C) — 1 'D' + 1 'C' por CODOPERACAO no legado.
CREATE SEQUENCE IF NOT EXISTS seq_iic;
CREATE TABLE IF NOT EXISTS itens_integracao_contabil (
  coditemoperacao  integer PRIMARY KEY DEFAULT nextval('seq_iic'),
  codoperacao      integer NOT NULL,       -- = IDSITUACAO_NF
  natureza         char(1) NOT NULL,       -- 'D' débito / 'C' crédito
  tipo             char(1) NOT NULL,       -- 'F' conta fixa / 'A' automática (parceiro/PLC)
  codconta_contabil integer,               -- conta fixa (TIPO='F') → plano_contas
  codhistorico     integer
);
CREATE INDEX IF NOT EXISTS ix_iic_operacao ON itens_integracao_contabil (codoperacao);

-- lote contábil (agrupa o lançamento; no corte-1, 1 lote por NF).
CREATE SEQUENCE IF NOT EXISTS seq_lote_contabil;
CREATE TABLE IF NOT EXISTS lote_contabil (
  codlotecontabil integer PRIMARY KEY DEFAULT nextval('seq_lote_contabil'),
  desclote        varchar(120),
  datalote        date,
  codorigem       integer,                 -- 12 = Nota Fiscal
  codempresa      integer NOT NULL,
  status          char(1) DEFAULT 'A'
);

-- DIARIO — o razão de partida dobrada. Uma linha = um débito + um crédito + valor.
CREATE SEQUENCE IF NOT EXISTS seq_diario;
CREATE TABLE IF NOT EXISTS diario (
  coddiario    integer PRIMARY KEY DEFAULT nextval('seq_diario'),
  datalan      date NOT NULL,
  contadebito  integer NOT NULL REFERENCES plano_contas(codplanocontas),
  contacredito integer NOT NULL REFERENCES plano_contas(codplanocontas),
  valor        numeric(13,2) NOT NULL,
  codorigem    integer NOT NULL,           -- 12 = Nota Fiscal
  idorigem     integer NOT NULL,           -- = CODNF (chave de estorno)
  codoperacao  integer,                    -- = IDSITUACAO_NF
  codempresa   integer NOT NULL,
  codhist      integer,
  complemento  varchar(255),
  codlote      integer REFERENCES lote_contabil(codlotecontabil)
);
CREATE INDEX IF NOT EXISTS ix_diario_origem ON diario (codorigem, idorigem);

-- gate da integração (fonte-de-verdade legada): EMPRESA.INTEGRACAO='AUTOMATICA'. Empresa 1 real = AUTOMATICA.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS integracao varchar(20);
UPDATE empresas SET integracao = 'AUTOMATICA' WHERE idempresa = 1 AND integracao IS NULL;

-- ponte gerencial→formal (PLC.CODCONTABIL → PLANO_CONTAS) p/ o débito automático (TIPO='A').
ALTER TABLE plc ADD COLUMN IF NOT EXISTS codcontabil integer;
-- situação que NÃO integra (filtro de elegibilidade).
ALTER TABLE situacao_nf ADD COLUMN IF NOT EXISTS nao_realiza_integracao char(1) DEFAULT 'N';

-- RBAC.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMNF', 'BTNCONTABILIZAR',         7, 1),
  ('FRMNF', 'BTNESTORNARCONTABIL',     7, 1)
ON CONFLICT DO NOTHING;

-- Seed do razão + IIC (contas REAIS do PINHEIRAO usadas pelas situações 6/8 do seed de NF).
INSERT INTO plano_contas (codplanocontas, descricao, tipo, status) VALUES
  (148,   'ESTOQUE DE MERCADORIAS',        'A', 'A'),
  (11141, 'FORNECEDORES NACIONAIS',        'A', 'A'),
  (200,   'VENDAS TRANSITORIAS',           'A', 'A'),
  (124,   'CLIENTES A RECEBER',            'A', 'A')
ON CONFLICT (codplanocontas) DO NOTHING;

-- IIC real (golden): situação 6 (entrada) D=148/C=11141; situação 8 (saída) D=200/C=124 — TIPO 'F' (fixa).
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico) VALUES
  (6, 'D', 'F', 148,   1),
  (6, 'C', 'F', 11141, 1),
  (8, 'D', 'F', 200,   69),
  (8, 'C', 'F', 124,   69)
ON CONFLICT DO NOTHING;
