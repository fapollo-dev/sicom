-- NOTA FISCAL — Fase 3: PROCESSAMENTO (movimento de estoque). A fase mais perigosa.
-- No legado o flip NF.PROC 'N'->'S' dispara a trigger Oracle ESTOQUE_NOTAS, que move o saldo
-- (entrada soma, saída baixa). No Apollo (sem trigger) o movimento é feito EM CÓDIGO, numa
-- transação atômica (NfProcessamentoService). Esta migration só acrescenta as guardas, o
-- carimbo de processamento, o kardex e o RBAC. SEM trigger. Doc: dossiê uNF.md §6.

-- Guarda no PRODUTO: este produto movimenta estoque? (=GERAQTDE do legado). Default 'S'.
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS geraqtde char(1) DEFAULT 'S';

-- Guardas por ITEM da NF (espelham GERAESTOQUE/MOVIMENTA_ESTOQUE do legado). Default 'S'.
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS geraestoque      char(1) DEFAULT 'S';
ALTER TABLE nf_prod ADD COLUMN IF NOT EXISTS movimenta_estoque char(1) DEFAULT 'S';

-- Carimbo de processamento (setado pelo serviço no flip PROC->'S'; null ao reverter).
ALTER TABLE nf ADD COLUMN IF NOT EXISTS dtprocessamento timestamptz;

-- HISTORICO_PROD (kardex) — 1 linha por movimento de saldo (entrada/saída/estorno).
-- Equivalente leve do HISTORICO_PROD/AUDIT_ESTOQUE do legado (saldo_anterior/novo + origem + doc).
CREATE SEQUENCE IF NOT EXISTS seq_historico_prod;
CREATE TABLE IF NOT EXISTS historico_prod (
  codmov         bigint PRIMARY KEY DEFAULT nextval('seq_historico_prod'),
  idproduto      integer NOT NULL,
  idempresa      integer NOT NULL,
  tipo           char(1) NOT NULL,                 -- 'E' entrada / 'S' saída (sentido do documento)
  qtde           numeric(13,3) NOT NULL,           -- quantidade movida (sempre positiva = ABS do delta)
  saldo_anterior numeric(13,3) NOT NULL,
  saldo_novo     numeric(13,3) NOT NULL,
  origem         varchar(10) NOT NULL DEFAULT 'NF', -- 'NF' / 'NF-REV' (estorno) ...
  codnf          integer,                          -- documento de origem
  historico      varchar(255),                     -- texto descritivo (espelha HISTORICO_ESTOQUE)
  data           timestamptz DEFAULT now(),
  codoperador    integer
);
ALTER SEQUENCE seq_historico_prod OWNED BY historico_prod.codmov;
CREATE INDEX IF NOT EXISTS ix_historico_prod_prod ON historico_prod (idproduto, idempresa);
CREATE INDEX IF NOT EXISTS ix_historico_prod_nf   ON historico_prod (codnf);

-- RBAC das ações de processamento (operador 7, empresa 1).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMNF', 'BTNPROCESSAR', 7, 1),
  ('FRMNF', 'BTNREVERTER',  7, 1);
