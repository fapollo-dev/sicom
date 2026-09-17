-- 242 — ANÁLISE COMPRA × VENDA, CASA DE CARNE (`FRMANALISECOMPRAVENDACASACARNE`).
-- **37 acessos, 6 operadores.** Nenhuma coluna nova: `NF`/`NF_PROD`, `VENDAS`, `PRODUTOS` e `DECOMPOSICAO`.
--
-- A casa de carne **compra a peça e vende os cortes**. Esta análise casa os dois lados pela `DECOMPOSICAO`:
-- no cliente são **13 peças** que viram **30 cortes**, com percentuais de 0,7% a 50% que somam **100%** em
-- cada peça. Vivo: um corte foi vendido **hoje** (a última compra de peça é de 12/03/2025).
--
-- ── ⚠️ O CUSTO da peça decomposta sai 2,4 vezes maior no legado ───────────────────────────────────────
-- As duas linhas do mesmo `CASE` são assimétricas:
--
--   QTDE_COMPRA  ... ELSE Sum(CAST((N.T_QTDE * D.PERCENTUAL) / 100 AS NUMERIC(12,3)))
--   CUSTO_COMPRA ... ELSE Sum(CAST((VRCUSTO  * D.PERCENTUAL)       AS NUMERIC(12,3)))
--
-- A quantidade divide o percentual por **100**; o custo **não divide**. E o custo ainda usa `VRCUSTO`, o
-- valor **unitário**, onde deveria usar `T_VRCUSTO`, o total da linha. Medido nas compras de peça desde 2024:
-- **R$ 7.047,00** contra **R$ 2.956,85** — **138,3% a mais**. É o custo sobre o qual a casa de carne calcula
-- a margem de cada corte, então o erro vai direto para a decisão de preço.
--
-- ── ⚠️ A tabela de trabalho era criada por DDL em runtime ─────────────────────────────────────────────
-- O legado faz `CREATE TABLE <temp do usuário> AS ...` a cada consulta (`CriaTabelaTemporaria`, `:272`) e a
-- consulta seguinte lê dela. Aqui é uma CTE — sem DDL em runtime, sem tabela órfã, sem corrida entre
-- operadores. Mesma decisão da intersecção de produtos (migration 221).
--
-- ⚠️ o legado trunca o total da venda **exceto** quando `VENDAS.IAT = 'A'`, aí arredonda (`:308`). Copiado.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMANALISECOMPRAVENDACASACARNE', 'FRMANALISECOMPRAVENDACASACARNE', 7, 1)
ON CONFLICT DO NOTHING;
