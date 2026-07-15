-- 078 — PEDIDO DE COMPRA: QTDE (nº de embalagens) por item + total = Σ TOTALCUSTO (FIX de correctness).
--
-- BUG (provado no golden PINHEIRAO): o corte-1 modelou FATOREMBALAGEM como a QUANTIDADE e total = Σ VLREMBALAGEM.
-- O legado tem QTDE (nº de embalagens) em PEDIDO_COMPRA_QTDE: QTDTOTAL = QTDE×FATOREMBALAGEM (uPedidoCompra.pas:1971),
-- TOTALCUSTO = QTDE×VLREMBALAGEM (:1972); total do pedido = Σ TOTALCUSTO (sqqTotalPedido). 30% dos itens têm QTDE>1
-- (90.401/303.172); pedido 123: Σ VLREMBALAGEM=4.349,56 vs Σ TOTALCUSTO real=10.738,65 (~2,5× subcontado).
--
-- FLIP do modelo (single-empresa): FATOREMBALAGEM passa a ser o FATOR de embalagem (FATORCX, unidades/caixa),
-- VLREMBALAGEM = FATOREMBALAGEM×VRCUSTO (custo por CAIXA), QTDE = nº de caixas, TOTALCUSTO = QTDE×VLREMBALAGEM
-- (total da linha), QTDTOTAL = QTDE×FATOREMBALAGEM (unidades totais, base do gerar-NF). QTDE vive no ITEM
-- (projeção single-empresa de PEDIDO_COMPRA_QTDE; o grandchild N-por-empresa é o corte-3 cross-docking, adiado
-- pela decisão de tenant). BACKFILL QTDE=1 → TOTALCUSTO≡VLREMBALAGEM → total dos pedidos existentes INALTERADO.
ALTER TABLE pedidocompra_i
  ADD COLUMN IF NOT EXISTS qtde       numeric(13,4) NOT NULL DEFAULT 1,   -- nº de embalagens pedidas (o comprador digita CAIXAS)
  ADD COLUMN IF NOT EXISTS qtdtotal   numeric(15,4),                       -- = qtde × fatorembalagem (unidades totais)
  ADD COLUMN IF NOT EXISTS totalcusto numeric(15,2);                       -- = qtde × vlrembalagem (total da linha)

-- backfill behavior-preserving: qtde=1 → qtdtotal=fatorembalagem, totalcusto=vlrembalagem (total do pedido não muda).
UPDATE pedidocompra_i SET qtde = 1 WHERE qtde IS NULL;
UPDATE pedidocompra_i
  SET qtdtotal   = COALESCE(qtde, 1) * COALESCE(fatorembalagem, 0),
      totalcusto = COALESCE(qtde, 1) * COALESCE(vlrembalagem, 0)
  WHERE qtdtotal IS NULL OR totalcusto IS NULL;

-- VIEW: total = Σ TOTALCUSTO (era Σ VLREMBALAGEM). Idêntica à 069 exceto a agregação do total.
DROP VIEW IF EXISTS get_pedidocompra;
CREATE VIEW get_pedidocompra AS
SELECT
  pc.codpedcomp AS codigo,
  pc.codpedcomp,
  pc.idempresa,
  pc.data,
  pc.codparceiro,
  f.razao        AS fornecedor,
  pc.codoperador,
  pc.dt_vencimento,
  pc.codconpagto,
  pc.pc_tipo_frete,
  pc.pc_valor_frete,
  pc.pc_nronf_cruzamento,
  pc.fechado,
  pc.bonificacao,
  pc.idsituacao_nf,
  pc.dtfaturamento,
  pc.dtencerramento,
  pc.obs,
  pc.indr,
  COALESCE((SELECT SUM(i.totalcusto) FROM pedidocompra_i i WHERE i.codpedcomp = pc.codpedcomp), 0) AS total,
  COALESCE((SELECT COUNT(*)          FROM pedidocompra_i i WHERE i.codpedcomp = pc.codpedcomp), 0) AS qtde_itens
FROM pedidocompra pc
LEFT JOIN parceiros f ON f.codparceiro = pc.codparceiro;
