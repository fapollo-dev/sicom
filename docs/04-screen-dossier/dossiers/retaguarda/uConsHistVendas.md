# CONSULTA DE HISTÓRICO DE VENDAS — `uConsHistVendas` / `FRMCONSHISTVENDAS`

Recon de 2026-08-19 (autônomo). **841 acessos, 25 operadores** — o candidato de retaguarda com mais operadores na
fila. Leitura pura (nenhum efeito), sobre dados que já estão migrados.

**Ausência provada no código** (lição 80): `grep -rln "FRMCONSHISTVENDAS\|ConsHistVendas\|hist-vendas\|
historico-vendas"` em `apps/api/src`, `apps/api/migrations`, `apps/web/src` → **zero**. O que existe é o **hub de
relatórios de venda** (agregações por período); esta tela é o oposto: **um cupom por vez, item a item**.

## 1. O que a tela faz

O operador informa **cupom + PDV** (os dois obrigatórios) e a tela abre a venda: cabeçalho (pedido, cliente,
vendedor, operador, data), **grade dos itens** com o total de cada um, rodapé (subtotal, cancelados e total) e uma
segunda grade com **os finalizadores do cupom** (como foi pago). Dali dá para **imprimir a DANFE** (NFC-e) e o
**ticket**. Três consultas, três datasets:

| # | fonte | papel |
|---|---|---|
| 1 | `VENDAS V` + PARCEIROS (cliente e vendedor) + PRODUTOS + OPERADORES | os itens do **cupom** (PDV) |
| 2 | `PEDIDOS V` + PARCEIROS ×2 + OPERADORES | os itens do **pedido** (venda de balcão/retaguarda, sem cupom) |
| 3 | `CX_VENDAS` | `SELECT OPERACAO, VALOR − COALESCE(TROCO,0) FROM CX_VENDAS WHERE NROPEDIDO = :NROPEDIDO` |

## 2. O achado que explica o filtro: `NROPEDIDO` carrega o PDV e o horário

Os `NROPEDIDO` do golden têm **14 caracteres em 100% dos casos** e o formato é
**`PDV(2) + DDMMYY(6) + HHMMSS(6)`** — ex.: `01280526112745` = PDV 01, 28/05/26, 11:27:45. É por isso que o filtro
de PDV do legado é `NROPEDIDO LIKE :PDV` com `FormatFloat('00', edtNroPDV.Value) + '%'`: o "PDV" é o **prefixo** do
número do pedido, não uma coluna. Quem reimplementar isso com `= pdv` não acha nada.

## 3. Liveness (golden)

| tabela | linhas | período | observação |
|---|---:|---|---|
| `VENDAS` | **11.922.255** | 2018-01-02 → **2026-05-29** | 3 empresas; a espinha dorsal do PDV |
| `PEDIDOS` | 11.987 | … → **2026-08-18** (ontem) | `CODPARCEIRO` 100%, `NROCUPOM` só 2 ⇒ é venda **sem cupom** |
| `CX_VENDAS` | — | — | 16 operações distintas em 2024 (§5) |

Fill rate das colunas que a consulta usa, em **2024** (ano cheio: **272.980 itens em 61.128 cupons**):

| coluna | preenchida | leitura |
|---|---:|---|
| `CODPARCEIRO`, `CODVENDEDOR`, `OPERADOR` | **100%** | cabeçalho sempre tem cliente/vendedor/operador |
| `VENDA_NFC='S'` | **100%** | **todas as vendas são NFC-e** — o ECF morreu (coerente com `REDUCAOZ` vazia, ver `uFechamentoDiario.md`) |
| `CANCELADO='S'` | 3.036 | item cancelado |
| `TIPOCANC='C'` | 1.156 | **cupom** cancelado |
| `IDPRODUTO_FILHO` | 8.586 (3,1%) | quando existe, a descrição vem da VENDA, não do produto |
| `DESC_ACRE` | 3.523 (1,3%) | desconto/acréscimo do cupom (rateado no rodapé) |

## 4. As fórmulas (o miolo da fidelidade)

**Total do item** — o `IAT` decide arredondar ou truncar (lição 47, a mesma pegadinha das rel-vendas):

```
IAT = 'A' → CAST( qtde × vrvenda AS NUMERIC(18,2))
senão    → CAST(TRUNC(qtde × vrvenda × 100) AS NUMERIC(18,2)) / 100
```

`TOTAL_ITEM` aplica os quatro descontos na mesma expressão, dentro do mesmo `CASE` do IAT:

```
(qtde × vrvenda) − (DESC_PROMOCAO + DESC_DEPARTAMENTO) + (DESC_ACRE_MEDIO + DESC_ACRE_ITEM)
```

`TOTAL_CANC` = a mesma soma, mas só quando `COALESCE(CANCELADO,'N') = 'S'` (senão 0) — e o **rodapé** é
`subtotal − cancelados`. Os rótulos `CANCITEM` ('CANCELADO') e `CANC` ('CUPOM CANCELADO') saem de
`CANCELADO='S'` e `TIPOCANC='C'`.

**Descrição do item:** `CASE WHEN V.IDPRODUTO_FILHO IS NOT NULL THEN V.DESCRICAO ELSE PR.DESCRICAO END` — produto
filho (pesado/fracionado) usa o texto gravado na venda.

Na consulta de `PEDIDOS` a aritmética é **outra** (sem IAT, sem promoção/departamento):
`TOTAL = qtde × (vrvenda + DESC_ACRE_ITEM) + DESC_ACRE` e `TOTAL_ITEM = qtde × (vrvenda + DESC_ACRE_ITEM)`.
Não unificar as duas (lição 47/48: mesma tela, fórmulas diferentes por fonte).

## 5. Finalizadores (`CX_VENDAS`) — o balde é misto

O grid mostra `VALOR − TROCO` por `OPERACAO`, **sem filtrar operação**. Em 2024 aparecem 16:

| operação | linhas | | operação | linhas |
|---|---:|---|---|---:|
| CARTOES | 34.675 | | CONVENIO | 1.470 |
| DINHEIRO | 20.423 | | DINHEIRO P | 954 |
| POS | 3.005 | | DESCONTO | 477 |
| PIX | 2.358 | | IFOOD / TICKETS / DEVOLUCAO / CHEQUE | ~466 cada |
| SANGRIA | 1.714 | | ACRESCIMO / CARTAO / ENTREGA | 5 / 4 / 2 |
| PIX POS | 1.471 | | | |

Lição 27 vale aqui: `SANGRIA`, `DESCONTO`, `ACRESCIMO` e `DEVOLUCAO` **não são forma de pagamento** — o legado
exibe tudo o que o cupom tem, e a soma do grid não é "o que o cliente pagou". Copiar exibindo, sem somar como
total pago.

## 6. Regras da tela (fora das queries)

- **cupom e PDV obrigatórios**: "Informe o número do cupom" / "Informe o número do PDV".
- **cupom cancelado**: se a consulta volta VAZIA, a tela roda uma segunda query (`VENDAS` com `CANCELADO='S' AND
  TIPOCANC='C'`, mesmos filtros) e, se achar, avisa *"O cupom informado está cancelado."* — é a diferença entre
  "não existe" e "existe e foi cancelado", e ela importa para quem atende o cliente no balcão.
- **filtro NFC-e**: um diálogo (`frmOpcoes`) escolhe entre venda NFC-e e não-NFC-e →
  `COALESCE(V.VENDA_NFC,'N') = :VENDA_NFC`. Com 100% `'S'` no golden, o ramo "não-NFC-e" é
  **cópia-fiel-negativa** neste tenant.
- **ticket** só habilita quando o cupom **não** está cancelado (`CANC = ''`).
- ordenação por `NROITEM`; contador "Qtd. Itens" no rodapé.

## 7. O que falta no nosso schema (o custo real do corte)

Já temos: `vendas` (mig 105 — com `nropedido`, `nrocupom`, `nroitem`, `qtde`, `vrvenda`, `iat`, `aliquota`,
`cancelado`, `tipocanc`, `venda_nfc`, os quatro `desc_*`), `cx_vendas` (mig 106 — `operacao`, `valor`, `troco`,
`nropedido`), `produtos`, `parceiros`, `operadores`.

Faltam, todas em `vendas`: **`codparceiro`** (cliente), **`codvendedor`**, **`operador`**, **`desc_acre`** (o do
cupom) e **`idproduto_filho`** — as três primeiras são 100% preenchidas no golden, ou seja o cabeçalho da consulta
não existe sem elas. E a tabela **`pedidos`** (a metade "venda sem cupom") não existe no novo.

## 8. Corte proposto

- **corte-1 — a consulta do CUPOM** (o caminho de 100% do dado): as 5 colunas em `vendas`, o endpoint
  `consultar(cupom, pdv, empresa, venda_nfc?)` com o `LIKE` do prefixo do PDV, os itens com a aritmética do IAT e
  os quatro descontos, o rodapé (subtotal/cancelados/total), a grade de finalizadores de `cx_vendas` e a mensagem
  "cupom cancelado". Tela + smoke.
- **corte-2 — a consulta do PEDIDO** (`pedidos`, 11.987 linhas e viva ontem): tabela + a aritmética própria dela.
- **fora, registrado**: impressão da DANFE (depende do PDF da NFC-e) e do ticket; o ramo não-NFC-e do filtro
  (0 linhas no golden); e o "vale troca" que a tela seleciona por coluna (não exercitado no golden — conferir
  quando o épico de troca/devolução do PDV entrar).
