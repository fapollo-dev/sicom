# FRMCONSPROD + FRMPOSICAOPRODUTO — Consulta de produtos e Análise geral

**25 acessos · 8 operadores** (a consulta). `UconsProd.pas` (131) + `.dfm` (341); `UPosicaoProduto.pas` (1.092)
+ `.dfm` (1.376) + `UdmPosicaoProduto.dfm` (1.340). Migration **249**.
API `relatorios/consulta-produto`. Smoke §126 (9 checks).

## 1. Duas telas, um corte

A consulta acha o produto pelos três caminhos num campo só — descrição (LIKE), código de barras (=) e código
(=) — e mostra o que a `get_produtos` do Apollo **não** traz: os preços.

```sql
SELECT P.idproduto, P.codbarra, P.descricao, P.unidade,
       M.vrcusto, M.vrcustoreal, M.vrpromo, M.vrvenda, F.razao
FROM PRODUTOS P
LEFT JOIN PARCEIROS F   ON F.codparceiro = P.codfor
LEFT JOIN MULTI_PRECO M ON M.IDPRODUTO = P.IDPRODUTO AND M.IDEMPRESA = :IDEMPRESA
WHERE (P.descricao like :PARAMETRO) or (P.codbarra = :PARAMETRO1) or (P.idproduto = :PARAMETRO2)
```

A view de produtos é global e `MULTI_PRECO` é por empresa: é daí que vem a ausência dos preços lá, e a razão
desta tela existir. Do botão **&Análise geral do Produto** abre a `FRMPOSICAOPRODUTO`, que **não aparece no
MENUEXPRESS** — só existe como filha desta. Por isso os dois vieram no mesmo corte.

## 2. A escada de custo→lucro é LIDA, não calculada

`sqqProdutos` traz 12 degraus direto de `MULTI_PRECO`:

| subida (custo) | descida (venda) |
|---|---|
| FRETE, IPI, ICMST, DESPACESSORIO, SEGURO | DEBITOICM, DEBITOPISCOFINS |
| CREDITOICM, CREDITOPISCOFINS | VENDALIQ → LUCROBRUTOV → DESPOPV → LUCROLIQV |
| ICM_EFETIVO (de `DET_ALIQUOTA` pela UF da empresa) | IMPREND, CONTSOCIAL, MARGEML2V, MARGEML2 |

É a **foto** que a precificação gravou, não um recálculo. Os 12 já existiam no destino desde a migration 129
(`FRMPRIFICACAOCUSTO`) — esta tela é a leitura deles. Recalcular aqui divergiria do que foi gravado.

## 3. ⚠️ Defeito 1 — os quadros de venda leem uma cache que não bate com a venda

`MOVIMENTOS_VENDAS` (136.044 linhas) e `SELECT_PEDIDOS` (56.067) não são views: são **tabelas materializadas
por job**. O carimbo de `SELECT_PEDIDOS` em produção é de hoje 05:31. Medido no cliente, loja 1:

| janela | cache | venda real | diferença |
|---|---:|---:|---:|
| set/2026 (mês corrente) | 92.876,680 | 93.441,421 | −564,74 |
| **ago/2026 (mês FECHADO)** | **141.157,174** | **140.930,659** | **+226,52** |
| **2025 inteiro** | **2.386.774,773** | **2.386.154,423** | **+620,35** |

No mês corrente, **237 de 3.147 produtos (7,5%)** divergem em quantidade.

O sentido do erro entrega a causa. Em 2025 a cache (2.386.774,773) fica **entre** o total sem cancelados
(2.386.154,423) e o total com eles (2.456.879,012): ela congelou vendas que **foram canceladas depois** do job,
e o passado nunca é reprocessado. O "Resumo mensal de saídas" não é o número das vendas.

Aqui os quatro quadros saem direto de `vendas`/`pedidos`.

## 4. ⚠️ Defeito 2 — a "Venda média anual" esconde sete anos

`cdsSaidasAnual` agrupa a cache por ANO **sem filtro de data**, o que dá ao quadro a cara de série histórica.
Mas `MOVIMENTOS_VENDAS` começa em **2025-01**, e a venda do cliente começa em **02/01/2018**. O operador vê
dois anos e acredita estar vendo todos.

## 5. ⚠️ Defeito 3 — escolher "Pedidos" muda um quadro de quatro

`AbreDataset` seta `Tabela := 'PEDIDOS'` e troca os títulos dos quatro GroupBoxes. Mas o mensal, o semanal e o
anual leem `MOVIMENTOS_VENDAS`/`SELECT_PEDIDOS` **de qualquer jeito** — só o "últimos dias" usa a variável
`Tabela`. Três dos quatro quadros continuam mostrando venda, com o rótulo trocado para "pedidos".

## 6. ⚠️ Defeito 4 — e o único quadro que muda esconde 99,5% dos pedidos

Junto com a tabela, o legado aplica `and v.tipo = 'P'`. Medido:

| `PEDIDOS.TIPO` | linhas |
|---|---:|
| **NULL** | **36.887** |
| 'P' | 147 |
| 'T' | 33 |
| 'O' | 13 |

99,5% dos pedidos têm TIPO nulo. O quadro "Pedido últimos dias" mostra 0,4% do movimento.

## 7. ⚠️ Defeito 5 — o mesmo pedido entra num quadro e some do outro

Na opção "Todos" (`ProcessarOpcaoTodos`), o UNION de `VENDAS` + `PEDIDOS` exige `p.cancelado = 'N'` no quadro
mensal e aceita `p.cancelado = 'N' or p.cancelado is null` no diário. São **33 pedidos** com CANCELADO nulo em
produção que aparecem num e não no outro. Aqui o critério é um só: `coalesce(cancelado,'N') <> 'S'`.

## 8. As oito consultas da análise

| quadro | origem no legado | aqui |
|---|---|---|
| cabeçalho + escada | `MULTI_PRECO` + `DET_ALIQUOTA` + `FAMILIAS_PROD` | igual |
| estoque por loja | `ESTOQUE` + `ESTOQUE_DEP` | igual |
| preço por loja | `MULTI_PRECO` | igual |
| mensal (13 meses) | `MOVIMENTOS_VENDAS` | `vendas`/`pedidos` |
| diário (8 dias) | `VENDAS`/`VENDAS_DIARIO` | `vendas`/`pedidos` |
| semanal (5 semanas dom→sáb) | `SELECT_PEDIDOS` | `vendas`/`pedidos` |
| anual | `MOVIMENTOS_VENDAS` | `vendas`/`pedidos`, série completa |
| entradas mensais | `NF` + `NF_PROD` (`tipo='E'`, `proc='S'`) | igual |
| compras mensais | `PEDIDOCOMPRA` + `PEDIDO_COMPRA_QTDE` | `pedidocompra_i.fatorembalagem` |
| pedidos pendentes | idem, `COALESCE(Q.FECHADO,'N')='N'` | `pedidocompra.fechado='N'` |
| Kardex | `HISTORICO_PROD` | igual (14,66 mi de linhas, 2020→hoje) |

## 9. Folds declarados

- **Multi-empresa**: o legado monta `IDEMPRESA IN (lista)` pelo seletor e pela config
  `ANALISE_PRODUTO_MULTEMPRESA`. Aqui a análise é tenant-scoped, e o estoque e o preço **por loja** continuam
  lado a lado — que é para o que o operador usava o multi.
- **`PEDIDO_COMPRA_QTDE`** (quantidade por loja do item de pedido) não veio: o `pedidocompra` do destino é
  single-empresa desde a migration 060, e a quantidade mora em `pedidocompra_i.fatorembalagem`.
- **`VENDAS_DIARIO`** (espelho do dia, 47.050 linhas) é tabela de performance do legado, não regra.
- **Botões &Notas e &Vendas**: já são telas próprias do Apollo. O **&Kardex** entra aqui.
