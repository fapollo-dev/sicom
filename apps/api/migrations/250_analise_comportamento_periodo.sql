-- 250 — ANÁLISE DE COMPORTAMENTO POR PERÍODO (`FRMRELANALISECOMPORTAMENTOPERIODO`,
-- `URelAnaliseComportamentoPeriodo.pas` 24.021 b + `.dfm` 42.420 + a grade). **24 acessos, 6 operadores.**
--
-- Compara TRÊS períodos com nome próprio ("Natal 2025", "Natal 2024") em seis métricas — Faturamento, CMV,
-- Lucro, Rentabilidade, Quantidade de tickets e Ticket médio — e mostra a diferença da referência para cada
-- um dos dois comparados. É a tela de "como foi este ano contra o ano passado".
--
-- ── O legado lê uma cache do Giros; aqui o número é calculado ───────────────────────────────────────────
-- `ANALISE_COMP_DIA_PROD` (4.554.664 linhas) e `ANALISE_COMPORTAMENTO_DIARIO` (4.590) são alimentadas pelo
-- **Giros**, o processo externo que roda de madrugada e **não veio no fonte** — o mesmo que bloqueou a
-- `FRMANALISECOMPORTAMENTO` (item 27 da fila). A diferença é que aqui os campos são nomeados, e isso permitiu
-- **reconstruir o critério do dado** e medir cada peça contra a produção:
--
--   • FATURAMENTO DE VENDA = Σ round(qtde × vrvenda, 2) + DESC_ACRE_MEDIO − DESC_PROMOCAO, sobre vendas não
--     canceladas. Medido em **60 dias × 2 lojas: 60 de 60 exatos**, diferença máxima **0,00** — e confere
--     também produto a produto dentro do dia.
--   • TICKETS = COUNT(DISTINCT NROCUPOM) não cancelado. 58 de 60 dias exatos.
--   • FATURAMENTO DE NF = Σ TOTALPROD das notas de saída não canceladas cujo CFOP, no cadastro, tem
--     `PROC_FINANCEIRO = 'S'` e `DEVOLUCAO = 'N'` — é venda de verdade, não espelho de cupom (5929), nem
--     transferência (5152), nem perda (5927), nem devolução (5411/6202/6411), nem outra saída (5949).
--     Bateu em todos os dias com nota no período medido.
--   • CMV = Σ round(qtde × vrcusto, 2), e `vrcustorep` quando o operador pede custo de reposição.
--
-- ── ⚠️ O CMV do Giros usa o custo da MADRUGADA SEGUINTE, não o da venda ─────────────────────────────────
-- Único ponto que não fecha exato. Produto 130 em 10/09/2026: a venda inteira do dia gravou `VRCUSTO = 24,33`
-- e a cache do Giros diz **26,367** por unidade — o custo que vigorava quando o job rodou. O CMV histórico do
-- legado, portanto, não é o custo do que foi vendido: é o custo de quando o relatório foi processado.
-- Medido em **90 dias × 2 lojas: 177 dos 180 dias batem exato**, e a diferença total é **R$ 1.363,21 em
-- R$ 5.120.935,94 — 0,027%**. Aqui o CMV sai do custo gravado NA LINHA DA VENDA, que é o custo do que saiu.
--
-- ── ⚠️ A porcentagem de variação divide pelo número errado ──────────────────────────────────────────────
-- `GetPorcentagem(Ref − Comp, Ref)` — a diferença é dividida pela **referência**, não pela base comparada.
-- Medido, loja 1: ago/2026 = R$ 1.146.825,82 contra ago/2025 = R$ 1.668.836,16. A queda real é de **31,28%**
-- (522.010,34 / 1.668.836,16); a tela mostra **−45,52%** (522.010,34 / 1.146.825,82). **14,24 pontos** de
-- exagero, e o erro é sistemático: subestima crescimento e infla queda. Aqui a variação é sobre a base.
--
-- ── ⚠️ A mesma tela conta ticket de dois jeitos ─────────────────────────────────────────────────────────
-- Sem filtro de família, os tickets vêm de `SUM(QTDE_TICKETS)` da cache (que é DISTINCT NROCUPOM); **com**
-- filtro, de `COUNT(DISTINCT NROPEDIDO)` da tabela VENDAS. Medido em 10/09/2026 na loja 1: **974 cupons** e
-- **970 pedidos**. Marcar um departamento que contém tudo já muda o ticket médio. Aqui é sempre por cupom.
--
-- ── ⚠️ O ticket médio não divide o faturamento que a tela exibe ─────────────────────────────────────────
-- A linha "Faturamento" mostra `VALOR_TOTAL` (venda + NF), mas o ticket médio é `VALOR_TOTAL_VENDA / tickets`.
-- Faturamento ÷ tickets não dá o ticket médio da tela. Mantido: dividir a NF pelos cupons seria pior — a nota
-- não passa pelo caixa. Fica explícito no retorno (`faturamentoVenda` separado de `faturamento`).
--
-- ── E a cache termina ONTEM ─────────────────────────────────────────────────────────────────────────────
-- `ANALISE_COMPORTAMENTO_DIARIO` vai até **2026-09-17** enquanto a venda vai até **hoje**: pedir o dia
-- corrente no legado devolve zero. Calculando, o dia de hoje aparece.

-- as flags que separam venda de não-venda vivem no cadastro de CFOP do legado; o destino só tinha código e
-- descrição. `tipo` = E/S (entrada/saída), como no legado.
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS tipo            char(1);
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS proc_financeiro char(1) DEFAULT 'S';
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS devolucao       char(1) DEFAULT 'N';

-- os CFOPs de saída que o cliente usa, com as flags medidas na produção
INSERT INTO cfop (codcfop, descricao, tipo, proc_financeiro, devolucao) VALUES
  ('5101','VENDA DE PRODUCAO DO ESTABELECIMENTO','S','S','S'),
  ('5102','VENDA PRODUTOS DE TERCEIROS','S','S','N'),
  ('5152','TRANSFERENCIA MERC DE TERCEIROS','S','N','N'),
  ('5405','VENDA MERC DE TERCEIROS SUJEITA A ST','S','S','N'),
  ('5411','DEVOLUCAO DE COMPRAS PARA COMERCIALIZACAO','S','S','S'),
  ('5557','TRANSF DE MATERIAL USO OU CONSUMO','S','N','N'),
  ('5926','LANC A TITULO DE RECLASSIFICACAO DE MERCADORIA','S','N','N'),
  ('5927','LANC A TITULO DE BAIXA DE ESTOQUE POR PERDA','S','N','N'),
  ('5929','LANC DECORRENTE DE EMISSAO DE DOC FISCAL (CUPOM)','S','N','N'),
  ('5949','OUTRA SAIDA DE MERCADORIA','S','N','N'),
  ('6202','DEVOLUCAO DE COMPRAS PARA COMERCIALIZACAO','S','S','S'),
  ('6404','VENDA DE MERC SUJEITA A ST (FORA DO ESTADO)','S','S','N'),
  ('6411','DEVOLUCAO DE COMPRAS PARA COMERCIALIZACAO','S','S','S'),
  ('6929','LANC DECORRENTE DE CUPOM FISCAL','S','N','N')
ON CONFLICT (codcfop) DO UPDATE
   SET tipo = EXCLUDED.tipo, proc_financeiro = EXCLUDED.proc_financeiro, devolucao = EXCLUDED.devolucao;

-- os três períodos varrem meses inteiros de venda; a varredura é por empresa + data
CREATE INDEX IF NOT EXISTS ix_vendas_emp_data ON vendas (idempresa, dtvenda);
CREATE INDEX IF NOT EXISTS ix_nf_emp_tipo_contabil ON nf (idempresa, tipo, dtcontabil);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELANALISECOMPORTAMENTOPERIODO', 'FRMRELANALISECOMPORTAMENTOPERIODO', 7, 1)
ON CONFLICT DO NOTHING;
