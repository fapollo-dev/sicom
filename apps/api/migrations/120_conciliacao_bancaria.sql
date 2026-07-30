-- 120 — CONCILIAÇÃO BANCÁRIA (OFX) (FRMCONCILIACAOBANCARIA) corte-1: importação das linhas do extrato + conciliação
-- contra o razão interno (mov_contas_bancarias, mig 057). Modelo do legado: linhas do extrato (movimentacao_bancaria_ofx)
-- + evento de conciliação (conciliacao_bancaria, CB_ID) com 2 JUNÇÕES N:M (CB↔MBO e CB↔CODMOVCONTA) + flag
-- mov_conciliado no razão. Match por DATA (dia) + VALOR. Concilia marcando os DOIS lados. ADIADO (fiel): parser do
-- arquivo .ofx (lib externa Classes.ImportadorOFX — corte à parte, precisa golden .ofx); ramos A-PAGAR/A-RECEBER por
-- IDLOTE (apagar_bx/areceber_bx); estorno de conciliação (NÃO existe no legado = cópia-fiel-negativa);
-- CONFIG_LANCAMENTO_AUTO_OFX (auto-lançamento). Nomes das junções normalizados (o legado tem typo "CONCILICAO").

-- linhas do extrato bancário importadas do OFX.
CREATE SEQUENCE IF NOT EXISTS seq_mbo;
CREATE TABLE IF NOT EXISTS movimentacao_bancaria_ofx (
  mbo_id                  integer PRIMARY KEY DEFAULT nextval('seq_mbo'),
  idempresa               integer NOT NULL,
  codconta                integer NOT NULL,            -- FK → contas_bancarias (a empresa vem daqui no legado)
  mbo_data                timestamptz NOT NULL,        -- DTPOSTED
  mbo_valor               numeric(15,3) NOT NULL,      -- TRNAMT (sempre positivo)
  mbo_credito_debito      char(1) NOT NULL,            -- 'C' / 'D'
  mbo_descricao           varchar(250),                -- MEMO/NAME
  mbo_transacao_id        varchar(20),                 -- FITID (chave natural de dedup)
  mbo_check_num           varchar(20),                 -- CHECKNUM
  mbo_conciliado          char(1) DEFAULT 'N',         -- 'S'/'N'
  mbo_nome_arquivo        varchar(250),
  mbo_data_importacao     timestamptz DEFAULT now(),
  codoperador_importacao  integer,
  dtcadastro              timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_mbo OWNED BY movimentacao_bancaria_ofx.mbo_id;
CREATE INDEX IF NOT EXISTS ix_mbo_conta ON movimentacao_bancaria_ofx (codconta, mbo_conciliado);
-- dedup real por FITID (melhoria s/ o legado, que só avisa): (conta, transacao, check). Nulos ficam distintos no PG
-- (permite linhas sem FITID), como o legado que só deduplica quando transacao_id ≠ ''/0.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mbo_fitid ON movimentacao_bancaria_ofx (codconta, mbo_transacao_id, mbo_check_num);

-- evento de conciliação (cabeçalho) + 2 junções N:M.
CREATE SEQUENCE IF NOT EXISTS seq_conciliacao_bancaria;
CREATE TABLE IF NOT EXISTS conciliacao_bancaria (
  cb_id       integer PRIMARY KEY DEFAULT nextval('seq_conciliacao_bancaria'),
  idempresa   integer NOT NULL,
  codconta    integer,
  cb_data     timestamptz DEFAULT now(),
  cb_operador integer
);
ALTER SEQUENCE seq_conciliacao_bancaria OWNED BY conciliacao_bancaria.cb_id;
CREATE TABLE IF NOT EXISTS conciliacao_bancaria_ofx (
  cb_id  integer NOT NULL REFERENCES conciliacao_bancaria(cb_id) ON DELETE CASCADE,
  mbo_id integer NOT NULL,
  PRIMARY KEY (cb_id, mbo_id)
);
CREATE TABLE IF NOT EXISTS conciliacao_bancaria_mov (
  cb_id       integer NOT NULL REFERENCES conciliacao_bancaria(cb_id) ON DELETE CASCADE,
  codmovconta integer NOT NULL,
  PRIMARY KEY (cb_id, codmovconta)
);

-- flag de conciliado no razão interno (lado MOV_CONTAS_BANCARIAS).
ALTER TABLE mov_contas_bancarias ADD COLUMN IF NOT EXISTS mov_conciliado char(1);

-- RBAC (operador 7 empresa 1+2): a tela de conciliação bancária.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCONCILIACAOBANCARIA', 'BTNGRAVAR',  7, 1), ('FRMCONCILIACAOBANCARIA', 'BTNGRAVAR',  7, 2),
  ('FRMCONCILIACAOBANCARIA', 'BTNIMPORTAR', 7, 1), ('FRMCONCILIACAOBANCARIA', 'BTNIMPORTAR', 7, 2)
ON CONFLICT DO NOTHING;
