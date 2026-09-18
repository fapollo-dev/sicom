-- 249 — CONSULTA DE PRODUTOS (`FRMCONSPROD`, `UconsProd.pas`) + ANÁLISE GERAL DO PRODUTO
-- (`FRMPOSICAOPRODUTO`, `UPosicaoProduto.pas` 1.092 linhas + `UdmPosicaoProduto.dfm` 1.340). **25 acessos, 8
-- operadores** na consulta; a análise não tem acesso próprio — ela só abre de dentro da consulta, pelo botão
-- "&Análise geral do Produto", e por isso não aparece no MENUEXPRESS.
--
-- A consulta acha o produto por descrição (LIKE), código de barras (=) ou código (=) — os três no mesmo campo —
-- e mostra o que a `get_produtos` do Apollo não traz: os **preços** (`VRCUSTO`, `VRCUSTOREAL`, `VRPROMO`,
-- `VRVENDA`). A view de produtos é global e `MULTI_PRECO` é por empresa; daí a ausência.
--
-- ── A escada de custo→lucro NÃO é calculada aqui: é LIDA ────────────────────────────────────────────────
-- `sqqProdutos` lê de `MULTI_PRECO` os 12 degraus já gravados (CREDITOICM, CREDITOPISCOFINS, DEBITOICM,
-- DEBITOPISCOFINS, VENDALIQ, LUCROBRUTOV, DESPOPV, LUCROLIQV, IMPREND, CONTSOCIAL, MARGEML2V, MARGEML2). É a
-- FOTO que a precificação gravou, não um recálculo. Todos os 12 já existem no destino desde a migration 129
-- (`FRMPRIFICACAOCUSTO`) — esta tela é a leitura deles.
--
-- ── DEFEITO 1: os quadros de venda leem CACHES que não batem com a venda ────────────────────────────────
-- `MOVIMENTOS_VENDAS` (136.044 linhas) e `SELECT_PEDIDOS` (56.067) são TABELAS materializadas por job — o
-- carimbo de `SELECT_PEDIDOS` em produção é de hoje 05:31. Medido no cliente, loja 1:
--   • set/2026 (mês corrente): 237 de 3.147 produtos (**7,5%**) com quantidade divergente da venda real;
--   • ago/2026 (mês FECHADO): cache 141.157,174 un × venda real 140.930,659 → a cache está **226,5 un ACIMA**;
--   • 2025 inteiro: cache 2.386.774,773 × real 2.386.154,423 → **620,35 un ACIMA**.
-- O sentido do erro entrega a causa: a cache está entre o total sem cancelados (2.386.154,423) e o total com
-- eles (2.456.879,012). Ela congelou vendas que **foram canceladas depois** do job, e o passado nunca é
-- reprocessado. O número do "Resumo mensal de saídas" não é o número das vendas. Aqui os quatro quadros saem
-- direto de `vendas`/`pedidos`, sem cache.
--
-- ── DEFEITO 2: a "Venda média anual" só enxerga 2 anos ──────────────────────────────────────────────────
-- `cdsSaidasAnual` agrupa `MOVIMENTOS_VENDAS` por ANO **sem filtro de data** — parece a série histórica. Mas a
-- cache começa em **2025-01**, e as vendas do cliente começam em **02/01/2018**. O quadro chamado "média anual"
-- mostra 2025 e 2026 e esconde sete anos.
--
-- ── DEFEITO 3: escolher "Pedidos" no RadioGroup muda um quadro de quatro ────────────────────────────────
-- `AbreDataset` seta `Tabela := 'PEDIDOS'`, mas o mensal, o semanal e o anual leem `MOVIMENTOS_VENDAS` e
-- `SELECT_PEDIDOS` **de qualquer jeito** — só o "últimos dias" usa a variável `Tabela`. Três dos quatro quadros
-- continuam mostrando venda com o título trocado para "Resumo mensal de pedidos".
--
-- ── DEFEITO 4: no modo "Pedidos", o único quadro que muda esconde 99,5% deles ───────────────────────────
-- Junto com a tabela, o legado aplica `and v.tipo = 'P'`. Medido: `PEDIDOS.TIPO` é **NULL em 36.887 dos 37.080**
-- pedidos (99,5%); 'P' aparece em **147**. O quadro "Pedido últimos dias" mostra 0,4% do movimento.
--
-- ── DEFEITO 5: o mesmo pedido entra num quadro e não no outro ───────────────────────────────────────────
-- Na opção "Todos" (`ProcessarOpcaoTodos`), o UNION exige `p.cancelado = 'N'` no quadro mensal e aceita
-- `p.cancelado = 'N' or p.cancelado is null` no diário. São **33 pedidos** com CANCELADO nulo em produção que
-- aparecem num quadro e somem do outro. Aqui o critério é um só: `coalesce(cancelado,'N') <> 'S'`.
--
-- ── Folds declarados ────────────────────────────────────────────────────────────────────────────────────
--  • Multi-empresa: o legado monta `IDEMPRESA IN (lista)` a partir do seletor e da config
--    ANALISE_PRODUTO_MULTEMPRESA. Aqui a análise é tenant-scoped (o padrão do monorepo) — o estoque e o preço
--    por empresa continuam listados lado a lado, que é para o que o operador usava o multi.
--  • Pedidos pendentes de compra: o legado lê `PEDIDO_COMPRA_QTDE` (quantidade por loja do item). O
--    `pedidocompra` do destino é single-empresa desde a migration 060 e a quantidade mora em
--    `pedidocompra_i.fatorembalagem` — é de lá que sai o pendente.
--  • `VENDAS_DIARIO` (espelho do dia, 47.050 linhas) é tabela de performance do legado, não regra: ignorada.
--  • Botões &Notas / &Vendas / &Kardex: o Kardex entra aqui (`historico_prod`, 14,66 mi de linhas em produção);
--    Notas e Vendas já são telas próprias do Apollo.

-- os quadros varrem 13 meses de venda de UM produto; sem estes índices é seq scan em 18,9 mi de linhas.
CREATE INDEX IF NOT EXISTS ix_vendas_prod_data  ON vendas  (codproduto, dtvenda);
CREATE INDEX IF NOT EXISTS ix_pedidos_prod_data ON pedidos (codproduto, dtvenda);
CREATE INDEX IF NOT EXISTS ix_historico_prod_data ON historico_prod (idproduto, data);
CREATE INDEX IF NOT EXISTS ix_nf_prod_produto   ON nf_prod (codproduto);
CREATE INDEX IF NOT EXISTS ix_pedidocompra_i_prod ON pedidocompra_i (idproduto);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCONSPROD',       'FRMCONSPROD',       7, 1),
  ('FRMPOSICAOPRODUTO', 'FRMPOSICAOPRODUTO', 7, 1)
ON CONFLICT DO NOTHING;
