-- NF F5b-fase4: BLOQUEIO DE PERÍODO CONTÁBIL FECHADO na contabilização/estorno do DIÁRIO.
-- Fiel a PERIODO_CONTABIL (Oracle PINHEIRAO): período fechado p/ NF ⇔ STATUS='S' AND BLOQ_NF='S'
-- e a DTCONTABIL cai em [DATA_INICIO, DATA_FIM] (por empresa). Semântica-irmã do legado FECHAMENTO
-- por dia (uNF.pas:4565) e do CHAVEAMENTO_PERIODO por data-limite (UIntegracaoContabil.pas:286).
-- CHAVEAMENTO_PERIODO está NULL no cliente (inativo); PERIODO_CONTABIL tem o flag dedicado BLOQ_NF.
CREATE SEQUENCE IF NOT EXISTS seq_periodo_contabil;
CREATE TABLE IF NOT EXISTS periodo_contabil (
  codperiodocontabil   integer PRIMARY KEY DEFAULT nextval('seq_periodo_contabil'),
  codempresa           integer NOT NULL,          -- por empresa (tenant)
  competencia_contabil varchar(10) NOT NULL,      -- ex '012024'
  data_inicio          date NOT NULL,
  data_fim             date NOT NULL,
  status               char(1) NOT NULL DEFAULT 'N',  -- 'S' fechado / 'N' aberto
  bloq_nf              char(1) DEFAULT 'N'            -- 'S' bloqueia contabilização/estorno de NF
);
CREATE INDEX IF NOT EXISTS ix_periodo_contabil_emp_data ON periodo_contabil (codempresa, data_inicio, data_fim);

-- Seed p/ smoke: empresa 1 — competência 01/2024 FECHADA p/ NF; 06/2026 ABERTA.
INSERT INTO periodo_contabil (codempresa, competencia_contabil, data_inicio, data_fim, status, bloq_nf) VALUES
  (1, '012024', DATE '2024-01-01', DATE '2024-01-31', 'S', 'S'),
  (1, '062026', DATE '2026-06-01', DATE '2026-06-30', 'N', 'N')
ON CONFLICT DO NOTHING;
