-- APURAÇÃO PIS/COFINS (EFD-Contribuições bloco M) — modelo de dados + base do corte-2a (crédito de ENTRADA).
-- Espelha (simplificado) o APURACAO_PC/APURACAO_PC_DET do legado: cabeçalho por período + detalhe por
-- (tipo, tipo-de-crédito, natureza-da-base, PIS/COFINS-catálogo) com base/alíquota/valor. Neste corte só o
-- crédito de entrada (TIPO='C'); o DÉBITO de saída depende dos cupons/ReduçãoZ do PDV (não migrado) → adiado.
CREATE TABLE IF NOT EXISTS apuracao_pc (
  codapuracao_pc  bigserial PRIMARY KEY,
  idempresa       integer NOT NULL,
  dataini         date NOT NULL,
  datafim         date NOT NULL,
  codoperador     integer,
  dtcadastro      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempresa, dataini, datafim)
);
CREATE TABLE IF NOT EXISTS apuracao_pc_det (
  codapuracao_pc_det bigserial PRIMARY KEY,
  codapuracao_pc     bigint NOT NULL REFERENCES apuracao_pc(codapuracao_pc) ON DELETE CASCADE,
  tipo               char(1) NOT NULL,             -- 'C' crédito / 'D' débito (só 'C' neste corte)
  id_tipocredito     varchar(3),                    -- COD_CRED do M100 (default '101' = crédito básico alíquota, mercado interno)
  id_basecredito     integer,                       -- NAT_BC_CRED do M105 (default 1 = aquisição de bens p/ revenda)
  idpiscofins        integer,
  cst_pis            integer,
  basecalculo        numeric(15,2) NOT NULL DEFAULT 0,
  aliqpis            numeric(13,4) NOT NULL DEFAULT 0,
  valorpis           numeric(15,2) NOT NULL DEFAULT 0,
  aliqcofins         numeric(13,4) NOT NULL DEFAULT 0,
  valorcofins        numeric(15,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_apuracao_pc_det ON apuracao_pc_det (codapuracao_pc);
