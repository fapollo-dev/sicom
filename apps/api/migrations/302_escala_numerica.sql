-- 302 — ESCALA: três colunas em que a carga ARREDONDARIA em silêncio, medidas contra a PRODUÇÃO (só leitura,
-- 23/09/2026). O `escala-numerica.py` lê os CSVs extraídos da homologação; refeita a conferência com a produção em
-- todas as fases do plano, direto no Oracle (uma varredura por tabela): **nenhum estouro de precisão** — e três
-- escalas curtas. O teto é a escala DECLARADA no Oracle.
--
--   historico_processamento_nf.vrcusto   (15,4) → (18,9)   115.363 linhas com 5-6 casas (31,780556) — era a
--                                                          minha mig 291; a auditoria do custo arredondava o custo
--   pedido_devolucao_compra_i.qtd_devolvida (13,3) → (13,4) 1 linha (13,9066)
--   pedidos.vrvenda                      (15,2) → (15,3)   1 linha (1,794)
ALTER TABLE historico_processamento_nf ALTER COLUMN vrcusto TYPE numeric(18,9);
ALTER TABLE pedido_devolucao_compra_i ALTER COLUMN qtd_devolvida TYPE numeric(13,4);
ALTER TABLE pedidos ALTER COLUMN vrvenda TYPE numeric(15,3);
