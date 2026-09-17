-- 239 — SIMULADOR DE VENDAS (`FRMSIMULADORVENDA`, `uSimuladorVenda.pas`). **42 acessos, 5 operadores.**
-- O que foi vendido no período, produto a produto, para o operador mexer no preço e ver o lucro mudar.
-- Nenhuma coluna nova: sai de `VENDAS` e `PRODUTOS`.
--
-- ── ⚠️ O legado soma TODAS as empresas ────────────────────────────────────────────────────────────────
-- A query (`sqqTotais`) filtra só a data e o cancelado — **não há `IDEMPRESA` em lugar nenhum**. Medido em
-- agosto/2026: a tela mostra **R$ 2.227.179,71** quando a empresa 1 vendeu **R$ 1.153.860,03** e a 2
-- **R$ 1.073.319,68**. Quem simula o preço da sua loja olha o volume das duas, e como o lucro sai de médias,
-- o número perde o sentido. Aqui é tenant-scoped.
--
-- ── As contas, copiadas linha a linha ─────────────────────────────────────────────────────────────────
-- ⚠️ **a venda TRUNCA e o custo ARREDONDA** — `trunc(qtde × vrvenda × 100)/100` contra
-- `CAST(qtde × vrcusto AS NUMERIC(18,2))`. A assimetria é do legado e muda centavos por linha; mantida.
-- ⚠️ o **"Lucro %" é markup sobre o CUSTO** (`((venda/custo)-1)×100`, `:156`), não margem sobre a venda:
-- venda 150 sobre custo 100 mostra **50%**, não 33,3%. Mantido — trocar mudaria todo número conhecido.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMSIMULADORVENDA', 'FRMSIMULADORVENDA', 7, 1)
ON CONFLICT DO NOTHING;
