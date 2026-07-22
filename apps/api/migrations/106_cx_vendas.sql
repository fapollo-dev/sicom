-- 106 — CX_VENDAS (pagamentos do PDV) + contábil do FECHAMENTO DE CAIXA por forma de pagamento (Caixa 2d-c).
-- Corte-3 do épico PDV/VENDAS. CX_VENDAS = 1 linha por PAGAMENTO do cupom (Oracle 1,5M linhas): forma =
-- CODOPERADORA = o OPERADOR do PDV (→ OPERADORES.CODOPERADOR; golden: 97/101 casam operadores, só 5 casam
-- FORMAS_PGTO.IDPGTO). OPERACAO = rótulo da forma (casa FORMAS_PGTO.MODALIDADE). VALOR/TROCO, CODGRUPO (turno).
-- O contábil (situação 2010, fiel a UIntegracaoContabilFechamentoCaixa): por forma → D <conta da forma
-- (FORMAS_PGTO.CODPLANOCONTAS)> / C 200 VENDAS TRANSITORIAS (fixa). Ignora forma DESTINO='QUE' (quebra).
CREATE SEQUENCE IF NOT EXISTS seq_cx_vendas;
CREATE TABLE IF NOT EXISTS cx_vendas (
  codcxvendas    bigint PRIMARY KEY DEFAULT nextval('seq_cx_vendas'),
  idempresa      integer NOT NULL,
  data           timestamptz,
  nropdv         integer,
  codoperadora   integer,               -- forma de pagamento (→ formas_pgto.idpgto)
  operacao       varchar(30),           -- rótulo da forma (DINHEIRO/CARTOES/…)
  debito_credito char(1),
  valor          numeric(15,2) DEFAULT 0,
  troco          numeric(15,2) DEFAULT 0,
  coo            integer,               -- contador de ordem de operação (cupom)
  codgrupo       integer,               -- grupo do FECHAMENTO do turno (unidade da contabilização)
  status         char(1),               -- ''/F (fechado)
  contabilizado  char(1) DEFAULT 'N',   -- 'S' após gerar o DIÁRIO (idempotente / reversível)
  idnf           integer,
  tipo_venda     varchar(3)
);
ALTER SEQUENCE seq_cx_vendas OWNED BY cx_vendas.codcxvendas;
CREATE INDEX IF NOT EXISTS ix_cx_vendas_empresa_data ON cx_vendas (idempresa, data);
CREATE INDEX IF NOT EXISTS ix_cx_vendas_grupo ON cx_vendas (codgrupo);

-- conta 213 (CARTÕES A RECEBER) — referenciada por FORMAS_PGTO.CODPLANOCONTAS (cartões) mas nunca semeada em
-- PLANO_CONTAS; sem ela o DIÁRIO (FK contadebito) falharia ao contabilizar a forma cartão. classe='A' (analítica).
INSERT INTO plano_contas (codplanocontas, descricao, tipo, status, classe) VALUES
  (213, 'CARTOES A RECEBER', 'E', 'A', 'A')
ON CONFLICT (codplanocontas) DO NOTHING;

-- IIC da situação 2010 (fechamento de caixa por modalidade), fiel ao Oracle: C fixa 200 (VENDAS TRANSITORIAS,
-- codhist 83) + D automática (conta resolvida pela forma de pagamento). Idempotente.
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico) VALUES
  (2010, 'C', 'F', 200,  83),
  (2010, 'D', 'A', NULL, 83)
ON CONFLICT DO NOTHING;

-- RBAC da contabilização do fechamento do PDV (na tela do Caixa).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCAIXA', 'BTNCONTABILIZARPDV', 7, 1),
  ('FRMCAIXA', 'BTNCONTABILIZARPDV', 7, 2);
