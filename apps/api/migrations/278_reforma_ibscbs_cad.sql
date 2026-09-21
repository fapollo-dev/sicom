-- 278 — REFORMA TRIBUTÁRIA (IBS/CBS) corte-1: os CADASTROS.
-- Telas 110 `FRMCADCLASSTRIBIBSCBS` e 145 `FRMCADCSTIBSCBS` da FILA-CONVERSAO. Dossiê: `uCadIBSCBS.md`.
--
-- ── ⚠️ Sem fonte no repositório, e por um motivo legítimo ─────────────────────────────────────────────
-- O `retaguarda-master` clonado é de **mai/2020** e a reforma é a EC 132/2023 + LC 214/2025: as duas units
-- simplesmente não existem lá (`grep -ril IBSCBS` no fonte inteiro = 0 ocorrências). O material é o DADO da
-- produção, que é o que o cliente roda hoje — o mesmo caminho do motor do razão (mig 202) e pelo mesmo
-- motivo. Todo número abaixo é contagem em produção (só leitura), 21/09/2026.
--
-- ── O mecanismo está VIVO e em volume ─────────────────────────────────────────────────────────────────
-- Não é tela de futuro: o cliente já grava os grupos IBS/CBS na nota desde a fase-teste de 2026.
--   · `NF_PROD_IBSCBS` **98.747 itens** (base R$ 26.276.533,06 · IBS R$ 15.931,30 · CBS R$ 143.275,55)
--   · `NF_IBSCBS`      **10.011 notas**
--   · só em **2026: 68.677 itens**, base R$ 17.642.187,45
--   · **44.501 dos 47.729 produtos (93,2%) já têm `CODCLASS_TRIB`** — a classificação não é piloto
-- A alíquota praticada em 97.299 dos 98.747 itens é **0,1% de IBS-UF + 0,9% de CBS**, que é exatamente a
-- fase-teste de 2026 — e bate com o seed da mig 007 (`tributacao_reforma`), feito da legislação sem ver o
-- cliente. Os outros 1.448 itens estão zerados (CST sem tributação).
--
-- ── ⚠️ A REDUÇÃO DE IBS E A DE CBS SÃO INDEPENDENTES ──────────────────────────────────────────────────
-- Este é o defeito que uma implementação ingênua produz: das 132 classificações, **uma tem `PRED_IBS` = 60
-- e `PRED_CBS` = 100** (redução de 60% no IBS e de 100% na CBS). Guardar "um percentual de redução" e
-- aplicá-lo aos dois tributos erraria essa linha em silêncio — e é justamente a faixa de alíquota zero de
-- CBS com IBS reduzido, onde o erro vira imposto cobrado a mais. As duas colunas existem separadas aqui.
-- Distribuição: 73 sem redução · 24 com 100/100 · 21 com 60/60 · 5 com 40/40 · 3 com 50/50 · 2 com 70/70 ·
-- 2 com 30/30 · 1 com 80/80 · **1 com 60/100**.
--
-- ── O que cada tabela é ───────────────────────────────────────────────────────────────────────────────
-- `CST_IBS_CBS` (17) é o catálogo de CST da reforma com os indicadores de grupo e por documento fiscal
-- (a mesma CST vale ou não para NF-e, NFC-e, CT-e, BP-e, NF3e, NFCom, NFS-e — são 9 flags, não uma).
-- `CLASS_TRIB` (132) é a classificação tributária (cClassTrib, 6 dígitos) com a redação da LC ao lado:
-- CST 000 tributação integral (4) · 010/011 alíquotas uniformes (7) · **200 reduzida (121)**, destas 24 de
-- alíquota zero e 18 de redução de 60%. `CCLASS_TRIB_NCM_ANEXOS` (199) é o de-para cClassTrib × NCM por
-- anexo da LC 214/2025 (IX: 82 · VII: 69 · I: 29). `IBS_UF` (27) é a alíquota de IBS por UF — hoje 0,1 em
-- todas as 27.
--
-- ── Fold: vigência ────────────────────────────────────────────────────────────────────────────────────
-- `CLASS_TRIB` tem `D_INI_VIG`/`D_FIM_VIG` e as duas estão **vazias nas 132 linhas** — o catálogo do
-- cliente é o vigente, sem histórico. As colunas vêm junto (o leiaute da reforma as prevê e a carga
-- precisa de destino), mas nenhuma regra depende delas: quem tem vigência de verdade aqui é a alíquota,
-- e essa mora em `tributacao_reforma` (mig 007), que NÃO é carregada do legado — o `IBS_UF` do cliente só
-- tem o IBS, sem CBS, sem vigência e sem fonte, e serve de conferência (confere: 0,1 em 2026).

-- o catálogo de CST da reforma (tela 145 FRMCADCSTIBSCBS)
CREATE TABLE IF NOT EXISTS cst_ibs_cbs (
  cst              varchar(3) PRIMARY KEY,
  descricao_cst    varchar(255) NOT NULL,
  -- indicadores de GRUPO: que blocos do XML a CST habilita
  ind_gibscbs      smallint DEFAULT 0,   -- grupo IBS/CBS
  ind_gibscbsmono  smallint DEFAULT 0,   -- grupo monofásico
  ind_gred         smallint DEFAULT 0,   -- grupo de redução
  ind_gdif         smallint DEFAULT 0,   -- grupo de diferimento
  ind_gtranf_cred  smallint DEFAULT 0,   -- grupo de transferência de crédito
  -- por DOCUMENTO fiscal: a mesma CST não vale em todos (9 flags no legado, não uma)
  ind_nfe          char(1) DEFAULT 'N',
  ind_nfce         char(1) DEFAULT 'N',
  ind_cte          char(1) DEFAULT 'N',
  ind_cteos        char(1) DEFAULT 'N',
  ind_bpe          char(1) DEFAULT 'N',
  ind_bpetm        char(1) DEFAULT 'N',
  ind_nf3e         char(1) DEFAULT 'N',
  ind_nfcom        char(1) DEFAULT 'N',
  ind_nfse         char(1) DEFAULT 'N',
  usultalteracao   integer,
  dtultimalteracao timestamptz,
  dtcadastro       timestamptz DEFAULT now(),
  indr             varchar(1),
  indr_usuario     integer,
  indr_data        timestamptz
);

-- a classificação tributária cClassTrib (tela 110 FRMCADCLASSTRIBIBSCBS)
CREATE SEQUENCE IF NOT EXISTS seq_class_trib;
CREATE TABLE IF NOT EXISTS class_trib (
  codclass_trib        integer PRIMARY KEY DEFAULT nextval('seq_class_trib'),
  cst                  varchar(3) NOT NULL,
  descricao_cst        varchar(255) NOT NULL,
  class_trib           varchar(6) NOT NULL,   -- o cClassTrib de 6 dígitos que vai no XML
  nome_class_trib      varchar(500) NOT NULL,
  descricao_class_trib text,
  lc_redacao           text,                  -- a redação do artigo da LC 214/2025
  lc_214_25            varchar(100),          -- o artigo ("Art. 223, § 4º")
  tipo_aliquota        varchar(500),          -- Padrão · Sem alíquota · Uniforme setorial · Fixa
  -- ⚠️ INDEPENDENTES: há classificação com 60 no IBS e 100 na CBS. Nunca colapsar num percentual só.
  pred_ibs             numeric(7,2),
  pred_cbs             numeric(7,2),
  ind_redutor_bc       varchar(3),
  ind_gtrib_regular    smallint,
  ind_cred_pres        smallint,
  ind_mono             smallint,
  ind_mono_reten       smallint,
  ind_mono_ret         smallint,
  ind_mono_dif         smallint,
  credito_para         varchar(500),
  d_ini_vig            date,                  -- vazias nas 132 do cliente (ver fold acima)
  d_fim_vig            date,
  data_atualizacao     timestamptz,
  usultalteracao       integer,
  dtultimalteracao     timestamptz,
  dtcadastro           timestamptz DEFAULT now(),
  indr                 varchar(1),
  indr_usuario         integer,
  indr_data            timestamptz
);
ALTER SEQUENCE seq_class_trib OWNED BY class_trib.codclass_trib;
CREATE UNIQUE INDEX IF NOT EXISTS ux_class_trib_codigo ON class_trib (class_trib)
  WHERE coalesce(indr, 'I') <> 'E';
CREATE INDEX IF NOT EXISTS ix_class_trib_cst ON class_trib (cst);

-- o de-para cClassTrib × NCM por anexo da LC 214/2025
CREATE SEQUENCE IF NOT EXISTS seq_cclass_trib_ncm;
CREATE TABLE IF NOT EXISTS cclass_trib_ncm (
  codcclass_trib_ncm integer PRIMARY KEY DEFAULT nextval('seq_cclass_trib_ncm'),
  cclass_trib        varchar(6) NOT NULL,
  cst                varchar(3) NOT NULL,
  anexo              varchar(10),
  legislacao         varchar(100),
  codigo_ncm         varchar(20) NOT NULL
);
ALTER SEQUENCE seq_cclass_trib_ncm OWNED BY cclass_trib_ncm.codcclass_trib_ncm;
CREATE INDEX IF NOT EXISTS ix_cclass_trib_ncm_ncm   ON cclass_trib_ncm (codigo_ncm);
CREATE INDEX IF NOT EXISTS ix_cclass_trib_ncm_class ON cclass_trib_ncm (cclass_trib);

-- a alíquota de IBS por UF (hoje 0,1 nas 27). A alíquota COM vigência e com CBS é `tributacao_reforma`.
CREATE SEQUENCE IF NOT EXISTS seq_ibs_uf;
CREATE TABLE IF NOT EXISTS ibs_uf (
  codibs_uf    integer PRIMARY KEY DEFAULT nextval('seq_ibs_uf'),
  uf           char(2) NOT NULL,
  valor_ibs_uf numeric(7,4) NOT NULL DEFAULT 0
);
ALTER SEQUENCE seq_ibs_uf OWNED BY ibs_uf.codibs_uf;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ibs_uf_uf ON ibs_uf (uf);

-- a classificação do produto: 44.501 dos 47.729 produtos do cliente já a têm
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS codclass_trib integer;
CREATE INDEX IF NOT EXISTS ix_produtos_class_trib ON produtos (codclass_trib) WHERE codclass_trib IS NOT NULL;

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADCSTIBSCBS',       'FRMCADCSTIBSCBS',       7, 1),
  ('FRMCADCLASSTRIBIBSCBS', 'FRMCADCLASSTRIBIBSCBS', 7, 1),
  ('FRMCADCLASSTRIBIBSCBS', 'BTNGRAVAR',             7, 1),
  ('FRMCADCLASSTRIBIBSCBS', 'BTNEXCLUIR',            7, 1)
ON CONFLICT DO NOTHING;
