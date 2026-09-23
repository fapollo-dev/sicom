# Relatório de pedidos de compra — previsão de pagamentos (`FRMRELPEDIDOCOMPRA`)

`uRelPedidosCompra.pas` (368 linhas) + `uDMRelPedidosCompra.dfm`; relatórios `Pedidos_Compra_Previsao_Financeira*.fr3`
(5). **63 acessos, 6 operadores** (`MENUEXPRESS`). Permissão: só o gate da tela (12 linhas na `PERMISSOES`).
Convertido em 23/09/2026 — mig 306, `GET relatorios/pedidos-compra`, tela `/relatorios/pedidos-compra`, smoke §166.

> A fila o dava como "sem fonte no repositório". O fonte existe: a unit tem "s" no nome (`uRelPedidosCompra`) e a
> classe não (`TfrmRelPedidoCompra`) — a busca pelo form não casava com a unit.

## 1. A base

`cdsPrevisaoFinanceira` (uDMRelPedidosCompra.dfm): `Σ PEDIDO_COMPRA_QTDE.TOTALCUSTO` agrupado por pedido **e pela loja
da quantidade** — o pedido das lojas 1 e 2 dá duas linhas. Colunas: pedido, fornecedor, data, vencimento do pedido,
data de faturamento, loja, CD1..CD8, fechado, valor. Lojas: `PQ.IDEMPRESA IN (GetMultiEmpresa)` (no Apollo, as
informadas; em branco, a da sessão — a convenção dos relatórios convertidos).

## 2. Os filtros (`btnPesquisarClick`, :116)

| rádio | condição |
|---|---|
| Data do pedido | `TRUNC(P.DATA)` no período |
| Vencimento do pedido | `TRUNC(P.DT_VENCIMENTO)` |
| Data de faturamento | `TRUNC(P.DTFATURAMENTO)` — no Apollo `data_faturamento` (FILA, Achado 17) |
| Vencimento da parcela | `TRUNC(P.DTFATURAMENTO) + P.CDn` no período, para algum n |

Status pelo `FECHADO` do cabeçalho (todos / abertos / fechados). Fornecedor pelo código, ou "busca direta" por parte
da razão (`LIKE`; no Apollo `ILIKE` — a razão é maiúscula nos dois).

## 3. As parcelas (`MontaVencimentos`, :231)

Cada linha vira uma parcela por prazo CDn > 0: **valor ÷ nº de prazos, sem arredondar e sem sobra**, vencendo em
faturamento + CDn, com o prazo e o status ("Fechado"/"Aberto"). Pedido sem prazo não gera parcela — fica na grade e
sai da impressão. O recorte da parcela pelo período está **comentado** no fonte (:281): filtrando pelo vencimento
da parcela, o pedido entra e **todas** as parcelas dele são listadas. Mantido.

Não é o rateio do pedido (`RatearTotalNasParcelas`, que arredonda e põe a sobra na primeira) nem as parcelas
gravadas: é uma projeção própria do relatório, e o Apollo a reproduz assim.

## 4. A impressão — um `.fr3` por agrupamento

| agrupamento | ordem (`IndexFieldNames`) | quebra (`GroupHeader`) |
|---|---|---|
| Fornecedor | loja, fornecedor, data do pedido | fornecedor |
| Data do pedido | loja, data do pedido, fornecedor | data do pedido |
| Vencimento do pedido | loja, vencimento, fornecedor | vencimento |
| Data de faturamento | loja, faturamento, fornecedor | faturamento |
| Vencimento da parcela | loja, vencimento da parcela, fornecedor | vencimento da parcela |

Colunas: pedido, data, valor da parcela, vencimento da parcela, vencimento do pedido, condição (o prazo), status,
loja, faturamento. Total do grupo e total geral. A quebra não olha a loja (o `GroupHeader` é só o campo): o mesmo
fornecedor em lojas seguidas fica num grupo só — reproduzido. Os cinco `.fr3` rotulam o total do grupo como "Total
Fornecedor" mesmo quando o grupo é uma data; o Apollo escreve "Total do grupo".
