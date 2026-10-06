# CONSULTA A RECEBER POR CLIENTE (`FRMCONSCLIRCB`) — completa (refeita pelo fonte em 06/10/2026)

`UConsCliRcb.pas` (584) + `.dfm` (1.584). **64 acessos, 8 operadores.**

## 1. O que a tela é

Os títulos em aberto de um cliente, com **atraso, juro e total atualizado**. É a tela que se abre quando o
cliente liga perguntando quanto deve.

> ⚠️ **Os §2 e §3 abaixo são do corte de 09/2026 e estavam errados** — liam só o SQL (`sqqRcb`) e não o que a tela faz com ele. O
> §6 é a regra do fonte, que o Apollo segue desde 06/10/2026.

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

**✅ O saldo do cliente (25/09/2026):** o que este dossiê chamava de "aba de títulos a pagar" é, no fonte, o rótulo
**"Saldo do cliente"** (`GetSaldoCliente`, `UConsCliRcb.pas:427`): Σ dos títulos A PAGAR de **crédito** do parceiro
(`ADCREDITO = 'S'`, o haver/adiantamento) ainda não quitados, sem filtro de loja. A consulta devolve `saldoCliente` e a
tela o mostra no topo. Smoke §119.5.

## 6. ✅ A regra do fonte (06/10/2026)

O JURO e o TOTAL do `sqqRcb` **não chegam à grade**: o `edtCodClienteExit` abre a consulta, põe no campo de juros a **taxa padrão da
empresa** (`EmpresaTXJUROPADRAO`) e chama o `edtJuroExit`, que **recalcula toda linha** com a taxa da tela (a TXJUROS da linha vira essa
taxa). O "juro fantasma de 11,5 milhões" do §3 nunca aparece no legado — é sobrescrito antes de a grade pintar. O que o corte de 09/2026
fazia de diferente, e foi corrigido:

| | corte 09/2026 | fonte |
|---|---|---|
| taxa | a do título, na faixa (0, 20) | a da TELA: a padrão da empresa (nula nas 5 lojas da produção → 0), editável |
| condição | atraso ≥ tolerância (parâmetro) | ATRASO > 0 **e** ATRASO > TOLERÂNCIA **do cliente** (`PARCEIROS.TOLERANCIA`) |
| "juros até" | — | `(taxa/30) × (VALOR − DESC)/100 × (ATRASO + juros até − hoje)`, `TruncarArredondar` 2 casas |
| juro composto | — | `JuroComposto` = JURO_COMPOSTO_BX_RECEBER do módulo Retaguarda (como o histórico do cadastro): mês cheio a `(1 + taxa)^meses`, os dias que sobram a taxa/30 sobre o montante |
| desconto do cliente | — | DIASPRAZO > 0, DESCPADRAO > 0 e venda + DIASPRAZO ≥ hoje: VALOR × DESCPADRAO/100 sai do TOTAL (na carga, depois do juro; no recálculo, o juro já sai sobre o valor descontado) |
| títulos | abertos ou todos, só a loja do login | `QUITADA = 'N'`, **sem os agrupados** (31.058 abertos agrupados na produção!), **todas as lojas** |
| totais | principal/juro/total | geral e em atraso, sem e com juros; os da seleção (valor, com juros, juros, descontos) |

A **seleção** (clicar marca/desmarca; "T" marca todos) e o **Imprimir** (`BitBtn1Click`): `Relatorios\Rel_BaixaAReceber.fr3` (936) com
o `cdsRcb` filtrado nos marcados (`SEL = TRUE`) e TOTADIANTAMENTO = o saldo do cliente. O script do layout soma ORIGINAL/VALOR/TOTAL no
AfterPrint sem zerar e o `[TotalPages#]` liga o DoublePass: o rodapé sai **dobrado** no legado (o motor reproduz). O `btnOk` (devolver
os marcados à Baixa a Receber, `Tag = 1`) e o filtro de ativos da pesquisa de parceiro (`rdgAtivo`) ficam com a pesquisa do Apollo.

Cobertura: smoke §119 (6 checks: taxa da tela; taxa e juros até do operador; tolerância do cliente com `>`; desconto e totais;
composto; saldo e Imprimir) e o teste de renderização do 936.
