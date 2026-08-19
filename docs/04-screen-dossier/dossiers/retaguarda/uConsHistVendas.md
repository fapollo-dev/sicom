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

> ⚠️ **`TOTAL_CANC` NÃO tem o CASE do IAT** (corrigido depois da auditoria — a 1ª versão deste dossiê dizia "a
> mesma soma", e estava errada): a medida do cancelado é **sempre truncada**,
> `CAST(SUM(CAST(TRUNC((…)*100) AS NUMERIC(13,2))/100) AS NUMERIC(13,2))`, mesmo quando `IAT='A'`. Não é
> preciosismo: `IAT='A'` é **100%** do golden e **252 dos 1.482** itens cancelados de jun/2023 diferem em 1 centavo
> (ex. real: pedido `65010623075100`, cupom 7666, item 3 → 0,364 × 25,90 = 9,4276 → **legado 9,42**, arredondado
> daria 9,43). Efeito visível: um cupom **inteiramente cancelado** fecha em **R$ 0,01** no legado e fecharia
> R$ 0,00 com a medida arredondada. O rodapé é `subtotal − cancelados`, e os rótulos `CANCITEM` ('CANCELADO') e
> `CANC` ('CUPOM CANCELADO') saem de `CANCELADO='S'` e `TIPOCANC='C'`.

**Duas colunas de exibição que separam o SINAL** (`Vlr.Desconto` e `Vlr.Acrescimo`, visíveis na grade —
`uConsHistVendas.dfm:686-698`): o acréscimo junta as partes **positivas** de `DESC_ACRE_MEDIO`/`DESC_ACRE_ITEM`; o
desconto junta `DESC_PROMOCAO + DESC_DEPARTAMENTO` mais as partes **negativas positivadas**. É o que o atendente
olha quando o cliente contesta o preço, e os dois sinais ocorrem no golden (jun/2024: 13 linhas com
`desc_acre_item < 0` e 1 com `desc_acre_medio > 0`).

**O `GROUP BY` colapsa linhas idênticas.** A query do cupom agrupa por item/qtde/preço/descontos/produto e as
medidas são `SUM(...)` — dois registros iguais viram **uma** linha com o total somado, e a `QTDE` **não** é somada
(está na chave; o `SUM(V.QTDE)` está comentado no fonte). Acontece no dado real: 19 grupos / 38 linhas extras em
2024 (ex.: pedido `06240624210734`, item 1, 4 registros de 9,00 → 1 linha de 36,00 com qtde 1); em jun/2023, zero.
Os totais do rodapé não mudam — só a contagem de itens e o valor por linha.

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

Dois desvios deliberados aqui, os dois de endurecimento: a query do legado **não filtra empresa** nem ordena
(`WHERE NROPEDIDO = :NROPEDIDO`, só isso); o novo acrescenta `idempresa` e `order by codcxvendas`. Sem impacto no
dado — das 33.995 linhas de `CX_VENDAS` casadas com pedidos de jun/2023, **zero** têm empresa diferente da venda.

### A segunda porta: entrar pelo NROPEDIDO

`ChamaFrmConsHistVendas` (`:478-511`) + `ExisteVenda` (`:625-648`, `SELECT NROCUPOM FROM VENDAS WHERE NROPEDIDO=%s
AND ROWNUM<=1`) abrem esta consulta com **só o número do pedido**, derivando o cupom da 1ª linha e o PDV dos dois
primeiros caracteres. Quem chama: `uCadAReceber.pas:499`, `uCadCheque.pas:308/312`, `UcadCartao.pas:398-426` — três
épicos **já migrados**, ou seja é um elo real entre telas. O endpoint aceita as duas entradas.

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
  (0 linhas no golden, mas implementado — é ele que produz a mensagem "cupom cancelado"); e o "vale troca" que a
  tela seleciona por coluna (não exercitado no golden — conferir quando o épico de troca/devolução do PDV entrar).
- **agregado morto**: o `DESCONTO = SUM(ACRESCIMO − DESC_PROMOCAO)` do dataset não tem label na tela — não copiado.
