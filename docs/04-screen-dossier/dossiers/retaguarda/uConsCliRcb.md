# CONSULTA A RECEBER POR CLIENTE (`FRMCONSCLIRCB`) — completa

`UConsCliRcb.pas` (584) + `.dfm` (1.584). **64 acessos, 8 operadores.**

## 1. O que a tela é

Os títulos em aberto de um cliente, com **atraso, juro e total atualizado**. É a tela que se abre quando o
cliente liga perguntando quanto deve.

## 2. A conta do juro

```
atraso = max(0, hoje − DTVENC)
se atraso < TOLERÂNCIA → juro 0, total = VALOR
senão                  → juro = (taxa ÷ 30) × atraso × VALOR ÷ 100
```

A taxa é **mensal**, dividida por 30 para virar diária — juro simples, sem capitalização.

⚠️ **a tolerância zera o juro inteiro, não os dias tolerados.** Com carência de 5 dias, 5 dias de atraso não
rendem nada e 6 dias rendem sobre os **6** — não sobre 1. Mantido: é o combinado com o cliente, não um
arredondamento.

## 3. ⚠️ O juro fantasma de R$ 11,5 milhões

No SQL do legado, as duas colunas usam **taxas diferentes**:

| coluna | taxa |
|---|---|
| **JURO** | `CASE WHEN TXJUROS > 0 AND TXJUROS < 20 THEN TXJUROS/30 ELSE **9/30** END` |
| **TOTAL** | `COALESCE(TXJUROS/30, 0)` — sem o default |

Quem tem taxa fora da faixa — **99.694 dos 99.734 títulos (99,96%)**, porque quase todos têm taxa zero —
aparece com **juro a 9% ao mês numa coluna e total sem juro nenhum na outra**.

Medido nos 46.792 títulos vencidos com taxa zero:

| | |
|---|---|
| principal | **R$ 4.845.428,53** |
| juro que a coluna mostraria | **R$ 11.567.551,22** |

**Juro de 2,4× o principal**, que não entra no total e não existe — a taxa do título é zero.

**A correção:** uma taxa só nas duas colunas — a do título quando está na faixa (0, 20), **zero** quando não
está. Os 40 títulos com taxa própria seguem rendendo; os 99.694 sem taxa param de exibir juro inventado. O
**total não muda** em relação ao legado: só a coluna de juro deixa de mentir.

## 4. Cobertura (§119 do smoke, 4 checks)

1. o juro mensal ÷ 30 sobre os dias de atraso (3% a.m., 60 dias, 1.000,00 → 60,00) e atraso negativo = zero;
2. **taxa zero não rende juro** — o fantasma de 11,5 milhões;
3. taxa fora da faixa (25%) também não vira 9%;
4. a tolerância zerando o juro inteiro.

## 5. O que ficou de fora

**Ainda falta:** a aba de **títulos a pagar** do mesmo parceiro, que a tela do legado mostra ao lado (o
cliente que também é fornecedor) — é a mesma consulta com a outra tabela, e liga direto com o encontro de
contas de `uDescontoTitulo.md`.
