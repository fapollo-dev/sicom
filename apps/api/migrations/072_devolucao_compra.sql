-- 072 — DEVOLUÇÃO DE COMPRA corte-1: NÚCLEO do documento (agregado header+itens), SEM efeitos.
-- Recon 3 frentes (Oracle READ-ONLY + fonte Delphi uCadPedidoDevolucaoCompras + monorepo). O documento
-- PARTE da NF de ENTRADA original (nunca do pedido de compra): cada item referencia (COD_NF, COD_ITEM_NF)
-- da entrada; qtd_devolvida ≤ SALDO (qtd da entrada − Σ já devolvido, exceto cancelados); parcial é a NORMA
-- (Oracle: 3.188/3.809 itens devolvem menos). Custo/impostos rateados da entrada. CFOP de saída via
-- CFOP.CFOP_DEVOLUCAO (1102→5202, 2102→6202…). Workflow EM_DIGITACAO→DIGITADO→NF_EMITIDA→FINALIZADO(+CANCELADO);
-- edição só em EM_DIGITACAO. O documento é TRANSACIONAL PURO (0 efeitos) — o FATO nasce na NF de SAÍDA que o
-- "Gerar NF de Devolução" emite (finalidade=4): estoque−, A RECEBER contra o FORNECEDOR (crédito, NÃO abate
-- A Pagar), fiscal de saída — tudo pela máquina de NF já existente (cortes 2/3).
-- ADIADO: troca de produto (PRODUTO_TROCA/COD_TROCA — 0 headers/21 itens no golden), refNFe SEFAZ.

-- ── CFOP: coluna de-para entrada→devolução + CFOPs de devolução de compra faltantes ────────────────
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS cfop_devolucao char(4); -- CFOP de saída p/ devolver este CFOP de entrada
INSERT INTO cfop (codcfop, descricao) VALUES
  ('1403', 'COMPRA P/ COMERCIALIZACAO SUJEITA A ST'),
  ('2403', 'COMPRA P/ COMERCIALIZACAO SUJEITA A ST (OUTRA UF)'),
  ('6202', 'DEVOLUCAO DE COMPRA PARA COMERCIALIZACAO (OUTRA UF)'),
  ('5411', 'DEVOLUCAO DE COMPRA SUJEITA A ST'),
  ('6411', 'DEVOLUCAO DE COMPRA SUJEITA A ST (OUTRA UF)')
ON CONFLICT (codcfop) DO NOTHING;
UPDATE cfop SET cfop_devolucao = '5202' WHERE codcfop = '1102' AND cfop_devolucao IS NULL;
UPDATE cfop SET cfop_devolucao = '6202' WHERE codcfop = '2102' AND cfop_devolucao IS NULL;
UPDATE cfop SET cfop_devolucao = '5411' WHERE codcfop = '1403' AND cfop_devolucao IS NULL;
UPDATE cfop SET cfop_devolucao = '6411' WHERE codcfop = '2403' AND cfop_devolucao IS NULL;

-- ── cabeçalho ──────────────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_pedido_devolucao_compra;
CREATE TABLE IF NOT EXISTS pedido_devolucao_compra (
  codpeddevcompra   integer PRIMARY KEY DEFAULT nextval('seq_pedido_devolucao_compra'),
  idempresa         integer NOT NULL DEFAULT 1,               -- empresaScoped
  codparceiro       integer NOT NULL REFERENCES parceiros(codparceiro), -- o FORNECEDOR
  data              timestamptz NOT NULL DEFAULT now(),
  status            varchar(20) NOT NULL DEFAULT 'EM_DIGITACAO', -- EM_DIGITACAO/DIGITADO/NOTA_FISCAL_EMITIDA/FINALIZADO/CANCELADO
  codnf_emitida     integer,                                  -- NF de saída gerada (corte-2; sem FK — vínculo tardio)
  codoperador       integer,                                  -- server-set (quem criou)
  produto_troca     char(1) DEFAULT 'N',                      -- flag troca (ADIADO)
  obs               text,
  indr              char(1) DEFAULT 'I',                      -- soft-delete I/E
  indr_data         timestamptz,
  indr_usuario      integer,
  usucadastro       integer,
  dtcadastro        timestamptz DEFAULT now(),
  usultalteracao    integer,
  dtultimalteracao  timestamptz
);
ALTER SEQUENCE seq_pedido_devolucao_compra OWNED BY pedido_devolucao_compra.codpeddevcompra;
CREATE INDEX IF NOT EXISTS ix_pdc_empresa ON pedido_devolucao_compra (idempresa);

-- ── itens (referenciam o item da NF de ENTRADA) ─────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_pedido_devolucao_compra_i;
CREATE TABLE IF NOT EXISTS pedido_devolucao_compra_i (
  codpeddevcomprai        integer PRIMARY KEY DEFAULT nextval('seq_pedido_devolucao_compra_i'),
  codpeddevcompra         integer NOT NULL REFERENCES pedido_devolucao_compra(codpeddevcompra) ON DELETE CASCADE,
  codnf                   integer NOT NULL REFERENCES nf(codnf),   -- a NF de ENTRADA original
  codnfprod               integer NOT NULL,                        -- o item da entrada (COD_ITEM_NF = nf_prod.codnfprod)
  idproduto               integer NOT NULL,
  nroitem                 integer,
  unidade                 char(2),
  fatorembalagem          numeric(13,3) DEFAULT 1,
  cfop                    varchar(4),                              -- CFOP de DEVOLUÇÃO (mapeado de CFOP_DEVOLUCAO)
  qtd_nota_fiscal         numeric(13,3) NOT NULL DEFAULT 0,        -- qtd (efetiva) da entrada
  qtd_devolvida           numeric(13,3) NOT NULL DEFAULT 0,        -- quanto devolver (≤ saldo)
  valor_custo             numeric(18,9) DEFAULT 0,                 -- custo unitário da entrada
  total_produto_nota      numeric(13,2) DEFAULT 0,                 -- total do item na entrada
  total_produto_devolvido numeric(13,2) DEFAULT 0,                 -- = valor_custo × qtd_devolvida (derivado)
  obs                     text
);
ALTER SEQUENCE seq_pedido_devolucao_compra_i OWNED BY pedido_devolucao_compra_i.codpeddevcomprai;
CREATE INDEX IF NOT EXISTS ix_pdc_i_ped ON pedido_devolucao_compra_i (codpeddevcompra);
-- índice p/ o cálculo de SALDO (Σ qtd_devolvida por item de origem, exceto cancelados).
CREATE INDEX IF NOT EXISTS ix_pdc_i_origem ON pedido_devolucao_compra_i (codnf, codnfprod);

-- ── view de listagem/Pesquisa ───────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS get_pedido_devolucao_compra;
CREATE VIEW get_pedido_devolucao_compra AS
SELECT
  d.codpeddevcompra AS codigo,
  d.codpeddevcompra,
  d.idempresa,
  d.data,
  d.codparceiro,
  f.razao AS fornecedor,
  d.status,
  d.codnf_emitida,
  d.codoperador,
  d.obs,
  d.indr,
  COALESCE((SELECT SUM(i.total_produto_devolvido) FROM pedido_devolucao_compra_i i WHERE i.codpeddevcompra = d.codpeddevcompra), 0) AS total,
  COALESCE((SELECT COUNT(*) FROM pedido_devolucao_compra_i i WHERE i.codpeddevcompra = d.codpeddevcompra), 0) AS qtde_itens
FROM pedido_devolucao_compra d
LEFT JOIN parceiros f ON f.codparceiro = d.codparceiro;

-- ── RBAC ────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMDEVOLUCAOCOMPRA', 'BTNGRAVAR', 7, 1), ('FRMDEVOLUCAOCOMPRA', 'BTNGRAVAR', 7, 2),
  ('FRMDEVOLUCAOCOMPRA', 'BTNEXCLUIR', 7, 1), ('FRMDEVOLUCAOCOMPRA', 'BTNEXCLUIR', 7, 2),
  ('FRMDEVOLUCAOCOMPRA', 'BTNFINALIZAR', 7, 1), ('FRMDEVOLUCAOCOMPRA', 'BTNFINALIZAR', 7, 2),
  ('FRMDEVOLUCAOCOMPRA', 'BTNREABRIR', 7, 1), ('FRMDEVOLUCAOCOMPRA', 'BTNREABRIR', 7, 2),
  ('FRMDEVOLUCAOCOMPRA', 'BTNCANCELAR', 7, 1), ('FRMDEVOLUCAOCOMPRA', 'BTNCANCELAR', 7, 2)
ON CONFLICT DO NOTHING;
