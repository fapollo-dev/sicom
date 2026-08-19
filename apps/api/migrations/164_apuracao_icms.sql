-- 164 — APURAÇÃO DE ICMS (uRelRegistros_ES / FRMRELREGISTROS_ES) corte-1: o processo que PRODUZ o que o SPED já
-- consome. O único lugar do repo que mencionava `APURACAO_ICMS` eram comentários do `sped-efd-icms-ipi.service.ts`
-- registrando esta lacuna ("o legado LÊ o E110 de uma tabela pré-calculada"). Dossiê:
-- docs/04-screen-dossier/dossiers/retaguarda/uRelRegistros_ES-apuracao-icms.md
--
-- Golden: 41 cabeçalhos (33 com detalhe) · 1.155.893 linhas de detalhe · 606 linhas de resumo por CFOP. E o detalhe
-- é, em massa, CUPOM: S/NFC 1.139.084 linhas (Σ ICMS 443.501,98) contra S/NF 2.249 (28.604,65) e E/NF 14.560
-- (230.401,27) — por isso o processo tem TRÊS pernas.

CREATE SEQUENCE IF NOT EXISTS seq_apuracao_icms;
CREATE TABLE IF NOT EXISTS apuracao_icms (
  codapuracaoicms     integer PRIMARY KEY DEFAULT nextval('seq_apuracao_icms'),
  idempresa           integer NOT NULL,
  dataini             date NOT NULL,
  datafin             date NOT NULL,
  -- o E110 campo a campo (uDMRelRegistros_ES.pas:762-794 + os agregados do .dfm):
  --   TOTALCREDITO = saldoant + creditoentrada + outroscreditos + estornodebitos
  --   TOTALDEBITO  = debitosaida + outrosdebitos + estornocreditos
  --   (debito − credito) < 0 → saldocredorseguinte = |dif| ; senão saldodevedor = |dif|
  --   arecolher = saldodevedor − deducoes
  saldoant            numeric(15,2) DEFAULT 0, -- = saldocredorseguinte da apuração do MÊS ANTERIOR (mês fechado)
  creditoentrada      numeric(15,2) DEFAULT 0, -- = TotEntrada + TotEntradaSN (o split SN não altera o total)
  outroscreditos      numeric(15,2) DEFAULT 0, -- ajuste manual
  estornodebitos      numeric(15,2) DEFAULT 0, -- ajuste manual
  saldocredorseguinte numeric(15,2) DEFAULT 0,
  debitosaida         numeric(15,2) DEFAULT 0, -- = TotSaida
  outrosdebitos       numeric(15,2) DEFAULT 0, -- ajuste manual
  estornocreditos     numeric(15,2) DEFAULT 0, -- ajuste manual
  saldodevedor        numeric(15,2) DEFAULT 0,
  deducoes            numeric(15,2) DEFAULT 0, -- ajuste manual
  arecolher           numeric(15,2) DEFAULT 0,
  -- fora do legado, para a tela: o split de Simples Nacional (existe no processo, não no E110)
  creditoentrada_sn   numeric(15,2) DEFAULT 0,
  usultalteracao      integer,
  dtcadastro          timestamptz,
  dtultimalteracao    timestamptz,
  UNIQUE (idempresa, dataini, datafin) -- a chave que o legado usa p/ achar/reprocessar a apuração do período
);
ALTER SEQUENCE seq_apuracao_icms OWNED BY apuracao_icms.codapuracaoicms;

CREATE SEQUENCE IF NOT EXISTS seq_apuracao_icms_det;
CREATE TABLE IF NOT EXISTS apuracao_icms_detalhes (
  codapuracaoicmsdetalhes bigint PRIMARY KEY DEFAULT nextval('seq_apuracao_icms_det'),
  codapuracaoicms integer NOT NULL REFERENCES apuracao_icms(codapuracaoicms) ON DELETE CASCADE,
  tipo            char(1) NOT NULL,   -- 'E' entrada · 'S' saída
  especie         varchar(10),        -- 'NF' (nota) · 'NFC' (cupom eletrônico) — as duas do golden
  codigo          varchar(50),        -- CODNF||'NF' / <chave>||'NFC' (o identificador do documento no legado)
  cfop            integer,
  cst             integer,
  base            numeric(15,2) DEFAULT 0,
  valor_icms      numeric(15,2) DEFAULT 0,
  isentas_naotrib numeric(15,2) DEFAULT 0,
  outras          numeric(15,2) DEFAULT 0,
  totalnf         numeric(15,2) DEFAULT 0,
  icms            numeric(15,2) DEFAULT 0, -- alíquota % do documento/CST
  icms_efetivo    numeric(15,2) DEFAULT 0, -- alíquota efetiva (com redução), quando houver
  classfiscal     char(2)                  -- regime do parceiro ('SN' = Simples Nacional; decide o split do crédito)
);
ALTER SEQUENCE seq_apuracao_icms_det OWNED BY apuracao_icms_detalhes.codapuracaoicmsdetalhes;
CREATE INDEX IF NOT EXISTS ix_apur_icms_det ON apuracao_icms_detalhes (codapuracaoicms, tipo);

-- o resumo por CFOP (o quadro do livro) — `ICMS_CFOP` no legado, 606 linhas em 33 apurações
CREATE TABLE IF NOT EXISTS icms_cfop (
  codapuracaoicms integer NOT NULL REFERENCES apuracao_icms(codapuracaoicms) ON DELETE CASCADE,
  tipo            char(1) NOT NULL,        -- coluna NOSSA: o legado separa por dataset (entrada/saída), não por coluna
  cfop            integer NOT NULL,
  vrcontabil      numeric(15,2) DEFAULT 0,
  basecalculo     numeric(15,2) DEFAULT 0,
  imposto         numeric(15,2) DEFAULT 0,
  isentas         numeric(15,2) DEFAULT 0,
  outras          numeric(15,2) DEFAULT 0,
  PRIMARY KEY (codapuracaoicms, tipo, cfop)
);

-- o GATE por CFOP das três consultas do processo: `COALESCE(C.NAO_GERA_APURACAO_ICMS,'N') = 'N'`
-- (uRelRegistros_ES.pas:1330/1924/2099). Golden: 'S' em 5 CFOPs, 'N' em 8, nulo em 382 (o COALESCE trata como 'N').
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS nao_gera_apuracao_icms char(1);

-- RBAC — as opções reais do form no golden: o gate da tela (17 linhas/7 operadores) e BTNCONSULTA (35/15).
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT v.form, v.opcao, v.codoperador, v.codempresa
FROM (VALUES
  ('FRMRELREGISTROS_ES', 'FRMRELREGISTROS_ES', 7, 1),
  ('FRMRELREGISTROS_ES', 'BTNCONSULTA',        7, 1),
  ('FRMRELREGISTROS_ES', 'FRMRELREGISTROS_ES', 1, 1),
  ('FRMRELREGISTROS_ES', 'BTNCONSULTA',        1, 1)
) AS v(form, opcao, codoperador, codempresa)
WHERE NOT EXISTS (
  SELECT 1 FROM permissoes p
  WHERE p.form = v.form AND p.opcao = v.opcao AND p.codoperador = v.codoperador AND p.codempresa = v.codempresa
);
