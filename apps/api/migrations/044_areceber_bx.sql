-- 044 — CONTAS A RECEBER, corte-2 (baixa/recebimento NÚCLEO): tabela de baixa ARECEBER_BX.
-- Recon Oracle: ARECEBER_BX (PK CODRCBBX, FK CODRCB) — 1 título → N baixas; ESTORNO é LÓGICO via
-- INDR ('I'=válida / 'E'=estornada), a linha NÃO é apagada (preserva histórico/contábil). Corte-2
-- faz a baixa TOTAL (quita o título) com juros/multa/desconto; parcial (novo título ORIGEM='B'),
-- os 10 recursos (dinheiro/cheque/cartão/permuta/saldo/troco → caixa/cheque não migrados) e o
-- contábil da baixa ficam no corte-3 (dossiê §6).

CREATE SEQUENCE IF NOT EXISTS seq_areceber_bx_codrcbbx;

CREATE TABLE IF NOT EXISTS areceber_bx (
  codrcbbx      integer PRIMARY KEY DEFAULT nextval('seq_areceber_bx_codrcbbx'),
  codrcb        integer NOT NULL REFERENCES areceber(codrcb) ON DELETE CASCADE,
  codempresa    integer NOT NULL,               -- denormalizado (escopo tenant, = areceber.codempresa)
  valorpg       numeric(13,2),                   -- valor pago nesta quitação (valor + juros + acre_desc)
  juros         numeric(13,2) DEFAULT 0,         -- juros cobrados na baixa
  multa         numeric(13,2) DEFAULT 0,
  acre_desc     numeric(13,2) DEFAULT 0,         -- acréscimo (+) ou desconto (−) na baixa
  dtpgto        timestamptz,                     -- data efetiva do pagamento
  codopbx       integer,                         -- operador que baixou
  data_operacao timestamptz,                     -- quando a baixa foi registrada
  indr          varchar(1) DEFAULT 'I',          -- 'I' incluída (válida) / 'E' estornada (lógico)
  contabilizado char(1),
  obs           text
);
ALTER SEQUENCE seq_areceber_bx_codrcbbx OWNED BY areceber_bx.codrcbbx;
CREATE INDEX IF NOT EXISTS ix_areceber_bx_codrcb ON areceber_bx (codrcb);
CREATE INDEX IF NOT EXISTS ix_areceber_bx_empresa ON areceber_bx (codempresa);

-- RBAC das ações de baixa (na tela FRMCADARECEBER). Empresa 1 (smoke) + 2 (teste de tenant).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADARECEBER', 'BTNBAIXAR',        7, 1),
  ('FRMCADARECEBER', 'BTNESTORNARBAIXA', 7, 1),
  -- grants na empresa 2 só p/ o smoke provar a trava de tenant do SERVIÇO (não só o RBAC):
  ('FRMCADARECEBER', 'BTNBAIXAR',        7, 2),
  ('FRMCADARECEBER', 'BTNESTORNARBAIXA', 7, 2);
