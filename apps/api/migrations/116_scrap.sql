-- 116 — SCRAP / PERDAS (FRMCADSCRAP — uCadSCRAP). Lançamento de perda/quebra de mercadoria (hortifruti/açougue/
-- vencidos/avaria) como documento MESTRE-DETALHE: cabeçalho `scrap` + itens `scrap_item` (1 linha = 1 produto
-- perdido). Corte-1 = REGISTRO + BAIXA de estoque. Valoração = qtde × vr_custo (custo unitário de MULTI_PRECO,
-- server-authoritative, igual ao Inventário). Motivo reusa `motivos_operacao` filtrado por TIPO_OPERACAO='PERDA'
-- (mig 059, compartilhado). A BAIXA de estoque (estoque.qtde − qtde + kardex origem='SCRAP') é aplicada por um
-- passo `aplicar`/`estornar` (molde ajuste-estoque + inventário), marcando `mov_estoque='S'`. FIEL ao legado: sem
-- INDR no scrap (exclusão física; o legado dá hard-delete com estorno de vínculos). CAIXA gerencial, faturamento
-- NF de perda (CFOP 5927 → SPED via motor de NF) e importador F7 ADIADOS.

-- Motivos de PERDA (MOTIVOS_OPERACAO TIPO_OPERACAO='PERDA' — códigos reais do Oracle; 127 PERDA GERAL é o mais usado).
INSERT INTO motivos_operacao (codmotivoop, descricao, tipo_operacao) VALUES
  (127, 'PERDA GERAL',        'PERDA'),
  (141, 'VALIDADE',           'PERDA'),
  (142, 'AVARIA',             'PERDA'),
  (261, 'PERDA IDENTIFICADA', 'PERDA')
ON CONFLICT (codmotivoop) DO NOTHING;
SELECT setval('seq_motivos_operacao', (SELECT GREATEST(COALESCE(MAX(codmotivoop),1), 261) FROM motivos_operacao));

-- SCRAP (cabeçalho) — 1 documento de perda. Sem INDR (exclusão física, fiel).
CREATE SEQUENCE IF NOT EXISTS seq_scrap;
CREATE TABLE IF NOT EXISTS scrap (
  codscrap         integer PRIMARY KEY DEFAULT nextval('seq_scrap'),
  idempresa        integer NOT NULL,
  dt_cadastro      timestamptz DEFAULT now(),        -- data do lançamento (DT_CADASTRO)
  codplc           integer,                          -- centro de custo (PLC) — soft ref (app-enforced no legado)
  codparceiro      integer,                          -- fornecedor (FK_SCRAP_CODPARCEIRO no legado) — soft ref
  idsituacao_nf    integer,                          -- situação do documento (E02/PERDA) — soft ref
  mov_estoque      char(1),                          -- 'S' = baixa de estoque aplicada (senão null)
  importado        char(1) DEFAULT 'N',              -- 'S' = já virou NF de perda (trava edição) — corte fiscal adiado
  obs              varchar(300),
  usucadastro      integer,
  dtcadastro       timestamptz DEFAULT now(),
  usultalteracao   integer,
  dtultimalteracao timestamptz
);
ALTER SEQUENCE seq_scrap OWNED BY scrap.codscrap;
CREATE INDEX IF NOT EXISTS ix_scrap_empresa ON scrap (idempresa);

-- SCRAP_ITEM (itens) — cascata do cabeçalho. qtde é SIGNED (o golden tem qtde<0/=0: estornos/correções).
CREATE SEQUENCE IF NOT EXISTS seq_scrap_item;
CREATE TABLE IF NOT EXISTS scrap_item (
  codscrapitem     integer PRIMARY KEY DEFAULT nextval('seq_scrap_item'),
  codscrap         integer NOT NULL REFERENCES scrap(codscrap) ON DELETE CASCADE,
  idempresa        integer,
  idproduto        integer NOT NULL REFERENCES produtos(idproduto),
  idproduto_filho  integer,
  qtde             numeric(13,3) NOT NULL DEFAULT 0,  -- quantidade perdida (signed)
  vr_custo         numeric(13,2) DEFAULT 0,           -- custo UNITÁRIO (de MULTI_PRECO.VRCUSTO); valor = qtde×vr_custo
  vrcustorep       numeric(15,4) DEFAULT 0,           -- custo de reposição
  codmotivoop      integer,                           -- motivo (MOTIVOS_OPERACAO PERDA) — soft ref (golden tem null/0/órfão)
  codsetor         integer,                           -- setor de consumo (FAMILIAS_PROD TIPO='SETOR') — soft ref
  codfor           integer,                           -- fornecedor do item — soft ref
  origem           varchar(20) DEFAULT 'ESTOQUE',     -- texto fixo do legado
  motivo           varchar(20) DEFAULT 'LIXO/PERDA',  -- texto fixo do legado
  origem_estoque   char(1),                           -- LOJA/DEPÓSITO
  faturado         char(1) DEFAULT 'N',
  obs              varchar(300),
  usucadastro      integer,
  dtcadastro       timestamptz DEFAULT now(),
  usultalteracao   integer,
  dtultimalteracao timestamptz
);
ALTER SEQUENCE seq_scrap_item OWNED BY scrap_item.codscrapitem;
CREATE INDEX IF NOT EXISTS ix_scrap_item_scrap ON scrap_item (codscrap);

-- View de lista/pesquisa: cabeçalho + nº de itens + valor total (Σ qtde×vr_custo) + descr do parceiro/plc.
CREATE OR REPLACE VIEW get_scrap AS
  SELECT s.codscrap, s.codscrap AS codigo, s.idempresa, s.dt_cadastro, s.codplc, s.codparceiro,
         s.idsituacao_nf, s.mov_estoque, s.importado, s.obs,
         (SELECT count(*) FROM scrap_item i WHERE i.codscrap = s.codscrap) AS qtde_itens,
         (SELECT COALESCE(SUM(i.qtde * i.vr_custo), 0) FROM scrap_item i WHERE i.codscrap = s.codscrap) AS valor_total,
         pa.razao AS parceiro, pl.descricao AS plc_descricao
  FROM scrap s
  LEFT JOIN parceiros pa ON pa.codparceiro = s.codparceiro
  LEFT JOIN plc pl ON pl.codplc = s.codplc;

-- RBAC (operador 7 empresa 1+2): a tela de scrap.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADSCRAP', 'BTNGRAVAR',            7, 1),
  ('FRMCADSCRAP', 'BTNGRAVAR',            7, 2),
  ('FRMCADSCRAP', 'BTNEXCLUIR',           7, 1),
  ('FRMCADSCRAP', 'BTNEXCLUIR',           7, 2),
  ('FRMCADSCRAP', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADSCRAP', 'BTNEDITAR',            7, 1)
ON CONFLICT DO NOTHING;
