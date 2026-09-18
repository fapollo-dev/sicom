# FRMCONSAPGBX — Consulta de baixas do A Pagar por lote

**20 acessos · 7 operadores.** `UConsAPGbx.pas` (617) + `.dfm` (1.210) + `UReversaoBaixaContasPagar.pas` (327) +
`UReversaoBaixa.pas`. Migration **253**.
API `cobranca/cons-apg-bx` (`GET lotes` · `GET :lote` · `POST :lote/reverter`). Tela `/cobranca/cons-apg-bx`.
Smoke §130 (5 checks).

## 1. O que faz

Abre um **lote** de baixa (a busca F3 é sobre `GET_APAGARBX` por `LOTE`) e mostra quatro grades — os títulos
baixados, o movimento da conta bancária do lote (`MOV_CONTAS_BANCARIAS.IDLOTE`), cheques de terceiros e cheques
próprios — com o botão **Reverter baixa**, que desfaz o lote inteiro. Lote já revertido lê
`GET_APAGARBX_REVERTIDAS` e mostra "Lote revertido"; "Manutenção" reabre a tela de baixa para editar; "Recibo"
imprime um `.fr3`.

## 2. O que o dado do cliente diz

| | |
|---|---:|
| baixas em `APAGAR_BX` | **51.589**, em **7.383 lotes** (100% com IDLOTE) |
| títulos por lote · fornecedores por lote (2026) | ~8 · ~5 (máx. 55) |
| reversões (`INDR='E'`) | **4.483** — 502 em 2026, em 33 lotes |
| lotes revertidos inteiros · parcialmente | **461 · 0** |
| lotes de 2026 com movimento bancário | **955 de 955** (7.111 movimentos) |
| cheques com lote (`CHEQUE_REP`, `CHQ_PROPRIO`, `BX_APAGAR_CRT_PROPRIO`) | **0 · 0 · 0** |
| baixas contabilizadas | 44.129 em 6.296 lotes |
| baixados com vínculo de desconto de títulos | 19 |
| `EMPRESAS.INTEGRACAO` (lojas 1 e 2) | AUTOMATICA |

A reversão é **sempre do lote inteiro** — o modelo de dados confirma o botão. E as duas grades de cheque estão
mortas.

## 3. O que a reversão do legado faz

`TReversaoBaixaContasPagar.ReverteLote`, numa transação: para cada baixa do lote, estorna a integração
contábil (se contabilizada), reabre o título (`APAGAR.QUITADA='N'`, `CODAPGCARTAO=NULL`) e o adiantamento de
origem; cria um **contra-movimento** bancário para cada movimento do lote — tipo invertido, valor negativo,
novo `IDLOTE`, `IDLOTE_REVERSAO` = lote original, histórico *"Reabertura da baixa de contas a pagar, lote N,
realizada pelo usuário X."*; marca as baixas `INDR='E'` com `INDR_USUARIO`/`INDR_DATA`; apaga os lançamentos de
caixa de juros/acréscimos/descontos do lote **pelo texto do OBS** e os títulos de saldo não quitados.

`ReversaoPermitida` barra: período contábil fechado (hoje ou a data de qualquer movimento do lote); caixa da
conta bancária fechado; baixa contabilizada com integração **não** automática (nunca dispara nas lojas 1 e 2);
vínculo de desconto de títulos.

## 4. Aqui

O estorno por **título** já existia (`apagar-baixa.service.ts`): período fechado pela `DTPGTO`, estorno contábil
na mesma transação, saldo parcial, `INDR='E'`, estorno de caixa (recusa caixa fechado), reabre título e
adiantamento. A reversão de lote **encadeia** esse estorno para todos os títulos ativos do lote dentro de UMA
transação — para isso o `estornar` foi dividido em `estornar` (abre a transação) e `estornarNoTrx` (o corpo) —
e acrescenta o contra-movimento bancário com o histórico do legado palavra por palavra.

O que muda de propósito:
- Os lançamentos de caixa de juros/acréscimos/descontos não são apagados por texto de `OBS`: o estorno de caixa
  por baixa (`caixa.estornarDaBaixa`) já os desfaz **por chave**.
- `TContasBancariasBO.CaixaFechado` vive num BO **compilado que não veio no fonte** — a trava aqui é a do caixa
  do Apollo (o estorno recusa caixa fechado).

## 5. ⚠️ As duas views do legado calculam o valor de jeitos diferentes

`GET_APAGARBX`: `VALOR + VENDOR − DESCONTO`. `GET_APAGARBX_REVERTIDAS`: `VALOR + VENDOR + TXJUROS − DESCONTO`.
O mesmo título mostra um valor antes de revertido e outro depois. No dado é **inócuo** — `TXJUROS = 0` em
todas as 4.459 baixas revertidas —, mas é uma inconsistência plantada. Aqui há uma consulta só, com a flag
`revertida` por linha e o filtro de situação (todos / ativos / revertidos).

## 6. Folds declarados

- A baixa do Apollo **não carimba IDLOTE** (paga título a título pela API): uma baixa sem lote é um lote de um
  (`coalesce(idlote, −codapgbx)`; a chave negativa identifica). Os lotes de verdade vêm da carga do legado.
- Cheques de terceiros e próprios: mortos (0 linhas) — fora. "Manutenção" (reabrir a tela de baixa do lote) e
  o recibo `.fr3`: fora deste corte.
- `MOV_CONTAS_BANCARIAS.DTVENC/LIBERADO/DTLIBERACAO` da grade do legado não existem no destino; a grade mostra
  data, conta, titular, tipo, valor, histórico, operação e forma.
- Tenant-scoped (o legado monta `IDEMPRESA IN (lista)`).
