-- 256 — dois cadastros pequenos que sustentam regra grande, e que só existiam como TABELA no destino:
--
-- ── CADASTRO DE PERÍODO CONTÁBIL (`FRMCADPERIODOCONTABIL`, `uCadPeriodoContabil.pas` 140 linhas) ──────
-- **14 acessos, 5 operadores.** É de onde saem as travas de PERÍODO FECHADO que a baixa, o estorno, a NF e o
-- caixa do Apollo já obedecem (`shared/periodo-contabil.ts`, migration 038) — mas a tabela não tinha tela nem
-- escrita. No cliente: **3 períodos** (07/2024 e 08/2024 abertos, `02/2025` com TODOS os bloqueios em 'S' e
-- STATUS 'N'), e o `CHAVEAMENTO_PERIODO` da integração contábil está NULL — a trava viva é esta tabela.
-- A única regra da tela: competência única (`RetornarValores … AND CODPERIODOCONTABIL <> :cod`). O destino
-- não tinha as três competências (contábil/financeira/geração) nem três dos nove bloqueios; entram.
-- ⚠️ o legado grava a competência como digitada: '082024' e '02/2025' convivem no cliente. Aqui normaliza-se
-- para MMAAAA na gravação, e a unicidade é por empresa.
--
-- ── CADASTRO DE PIS/COFINS (`FRMCADPISCOFINS`, `uCadPisCofins.pas` 100 linhas) ─────────────────────────
-- **13 acessos, 3 operadores.** As situações de PIS/COFINS que o produto aponta (`PRODUTOS.IDPISCOFINS`): no
-- cliente **12 situações**, e 45.416 dos 47.714 produtos apontam para uma delas (31.626 em TRIBUTADOS; 2.298
-- sem). A tabela existia desde a migration 041 (com 7 linhas semeadas), sem tela. O legado guarda também o
-- TIPO DE CRÉDITO (tabela 4.3.6 do SPED, `PC_TIPOCREDITO`, 25 códigos) e a flag `EXIGENATUREZA`; entram, com o
-- lookup semeado com os 25 códigos do cliente. ⚠️ 5 das 12 situações do cliente chamam-se "CADASTRADO VIA FGF"
-- (criadas pela integração externa, item 69) — 744 produtos apontam para elas.

ALTER TABLE periodo_contabil ADD COLUMN IF NOT EXISTS competencia_financeira varchar(10);
ALTER TABLE periodo_contabil ADD COLUMN IF NOT EXISTS competencia_geracao    varchar(10);
ALTER TABLE periodo_contabil ADD COLUMN IF NOT EXISTS bloq_mov_caixa char(1) DEFAULT 'N';
ALTER TABLE periodo_contabil ADD COLUMN IF NOT EXISTS bloq_chq       char(1) DEFAULT 'N';
ALTER TABLE periodo_contabil ADD COLUMN IF NOT EXISTS bloq_baixa_crt char(1) DEFAULT 'N';
ALTER TABLE periodo_contabil ADD COLUMN IF NOT EXISTS usultalteracao integer;
ALTER TABLE periodo_contabil ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz;
ALTER TABLE periodo_contabil ADD COLUMN IF NOT EXISTS dtcadastro timestamptz DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS ux_periodo_contabil_emp_comp ON periodo_contabil (codempresa, competencia_contabil);

-- tabela 4.3.6 do SPED: o tipo de crédito de PIS/COFINS (o legado: PC_TIPOCREDITO / GET_TIPOCREDITO)
CREATE TABLE IF NOT EXISTS pc_tipocredito (
  id_tipocredito integer PRIMARY KEY,
  descricao      varchar(120) NOT NULL
);
INSERT INTO pc_tipocredito (id_tipocredito, descricao) VALUES
  (101,'CREDITO VINCULADO A RECEITA TRIBUTADA NO MERCADO INTERNO - ALIQUOTA BASICA'),
  (102,'CREDITO VINCULADO A RECEITA TRIBUTADA NO MERCADO INTERNO - ALIQUOTAS DIFERENCIADAS'),
  (103,'CREDITO VINCULADO A RECEITA TRIBUTADA NO MERCADO INTERNO - ALIQUOTA POR UNIDADE DE PRODUTO'),
  (104,'CREDITO VINCULADO A RECEITA TRIBUTADA NO MERCADO INTERNO - ESTOQUE DE ABERTURA'),
  (105,'CREDITO VINCULADO A RECEITA TRIBUTADA NO MERCADO INTERNO - AQUISICAO EMBALAGENS PARA REVENDA'),
  (106,'CREDITO VINCULADO A RECEITA TRIBUTADA NO MERCADO INTERNO - PRESUMIDO DA AGROINDUSTRIA'),
  (108,'CREDITO VINCULADO A RECEITA TRIBUTADA NO MERCADO INTERNO - IMPORTACAO'),
  (109,'CREDITO VINCULADO A RECEITA TRIBUTADA NO MERCADO INTERNO - ATIVIDADE IMOBILIARIA'),
  (199,'CREDITO VINCULADO A RECEITA TRIBUTADA NO MERCADO INTERNO - OUTROS'),
  (201,'CREDITO VINCULADO A RECEITA NAO TRIBUTADA NO MERCADO INTERNO - ALIQUOTA BASICA'),
  (202,'CREDITO VINCULADO A RECEITA NAO TRIBUTADA NO MERCADO INTERNO - ALIQUOTAS DIFERENCIADAS'),
  (203,'CREDITO VINCULADO A RECEITA NAO TRIBUTADA NO MERCADO INTERNO - ALIQUOTA POR UNIDADE DE PRODUTO'),
  (204,'CREDITO VINCULADO A RECEITA NAO TRIBUTADA NO MERCADO INTERNO - ESTOQUE DE ABERTURA'),
  (205,'CREDITO VINCULADO A RECEITA NAO TRIBUTADA NO MERCADO INTERNO - AQUISICAO EMBALAGENS PARA REVENDA'),
  (206,'CREDITO VINCULADO A RECEITA NAO TRIBUTADA NO MERCADO INTERNO - PRESUMIDO DA AGROINDUSTRIA'),
  (208,'CREDITO VINCULADO A RECEITA NAO TRIBUTADA NO MERCADO INTERNO - IMPORTACAO'),
  (299,'CREDITO VINCULADO A RECEITA NAO TRIBUTADA NO MERCADO INTERNO - OUTROS'),
  (301,'CREDITO VINCULADO A RECEITA DE EXPORTACAO - ALIQUOTA BASICA'),
  (302,'CREDITO VINCULADO A RECEITA DE EXPORTACAO - ALIQUOTAS DIFERENCIADAS'),
  (303,'CREDITO VINCULADO A RECEITA DE EXPORTACAO - ALIQUOTA POR UNIDADE DE PRODUTO'),
  (304,'CREDITO VINCULADO A RECEITA DE EXPORTACAO - ESTOQUE DE ABERTURA'),
  (305,'CREDITO VINCULADO A RECEITA DE EXPORTACAO - AQUISICAO EMBALAGENS PARA REVENDA'),
  (306,'CREDITO VINCULADO A RECEITA DE EXPORTACAO - PRESUMIDO DA AGROINDUSTRIA'),
  (308,'CREDITO VINCULADO A RECEITA DE EXPORTACAO - IMPORTACAO'),
  (399,'CREDITO VINCULADO A RECEITA DE EXPORTACAO - OUTROS')
ON CONFLICT (id_tipocredito) DO NOTHING;
CREATE OR REPLACE VIEW get_tipocredito AS SELECT id_tipocredito, id_tipocredito AS codigo, descricao FROM pc_tipocredito;

ALTER TABLE piscofins ADD COLUMN IF NOT EXISTS id_tipocredito integer REFERENCES pc_tipocredito(id_tipocredito);
ALTER TABLE piscofins ADD COLUMN IF NOT EXISTS exigenatureza char(1);
ALTER TABLE piscofins ADD COLUMN IF NOT EXISTS usultalteracao integer;
ALTER TABLE piscofins ADD COLUMN IF NOT EXISTS dtultimalteracao timestamptz;
ALTER TABLE piscofins ADD COLUMN IF NOT EXISTS dtcadastro timestamptz DEFAULT now();
CREATE SEQUENCE IF NOT EXISTS seq_piscofins START 100;

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADPERIODOCONTABIL', 'FRMCADPERIODOCONTABIL', 7, 1),
  ('FRMCADPERIODOCONTABIL', 'BTNGRAVAR',  7, 1),
  ('FRMCADPERIODOCONTABIL', 'BTNEXCLUIR', 7, 1),
  ('FRMCADPISCOFINS', 'FRMCADPISCOFINS', 7, 1),
  ('FRMCADPISCOFINS', 'BTNGRAVAR',  7, 1),
  ('FRMCADPISCOFINS', 'BTNEXCLUIR', 7, 1)
ON CONFLICT DO NOTHING;
