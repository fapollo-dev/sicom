-- 061 — RECEBIMENTO: vínculo NF de entrada ↔ PEDIDO DE COMPRA (NF.CODPEDCOMP).
-- Recon Oracle: o "recebimento" do legado é, na verdade, IMPORT do XML da NFe do fornecedor CASADO a um
-- pedido — a NF carrega o FATO (dados fiscais reais do XML); `CODPEDCOMP` é uma back-reference carimbada na NF.
-- Link é SÓ de cabeçalho (NF.CODPEDCOMP → PEDIDOCOMPRA; sem FK de item — itens correlacionam por produto).
-- STATUS_PEDCOMP/STATUS_QTD_PEDCOMP/PEDIDOCOMPRA.NRONF/IDSITUACAO_NF são MORTAS (100% NULL) → não usar.
-- Efeito (estoque/A Pagar) é 100% do processamento da PRÓPRIA NF (flip PROC 'N'→'S' + faturamento) — NÃO há
-- lógica de recebimento no banco (nenhum trigger em PEDIDOCOMPRA). Corte-1 = gerar a NF de entrada RASCUNHO
-- a partir do pedido (pré-preenchida, valores editáveis) e delegar o FATO ao F3/F4 já existentes da NF.

ALTER TABLE nf ADD COLUMN IF NOT EXISTS codpedcomp integer REFERENCES pedidocompra(codpedcomp);
-- UNIQUE PARCIAL: no máx. 1 NF de entrada por pedido — backstop de DB do invariante 1:1 do corte-1 (barra o
-- duplo-recebimento sob concorrência). O legado permite 1:N (recebimento parcial); quando esse corte entrar,
-- este índice é trocado por um índice comum.
CREATE UNIQUE INDEX IF NOT EXISTS ux_nf_codpedcomp ON nf (codpedcomp) WHERE codpedcomp IS NOT NULL;

-- CFOPs de ENTRADA de compra mais comuns no golden (pedido→NF): 1403/ST é o DOMINANTE (não estava no seed
-- 025). Semeados p/ que o operador possa ajustar o CFOP do rascunho ao documento real sem esbarrar na FK.
INSERT INTO cfop (codcfop, descricao) VALUES
  ('1403', 'COMPRA P/ COMERCIALIZACAO - MERCADORIA SUJEITA A ST'),
  ('2403', 'COMPRA P/ COMERCIALIZACAO - ST (OUTRA UF)'),
  ('1910', 'ENTRADA DE BONIFICACAO/DOACAO/BRINDE'),
  ('1556', 'COMPRA DE MATERIAL DE USO/CONSUMO')
ON CONFLICT (codcfop) DO NOTHING;

-- RBAC: gerar a NF de entrada a partir do pedido (ação do módulo de compras).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMPEDIDOCOMPRA', 'BTNGERARNF', 7, 1),
  ('FRMPEDIDOCOMPRA', 'BTNGERARNF', 7, 2)
ON CONFLICT DO NOTHING;
