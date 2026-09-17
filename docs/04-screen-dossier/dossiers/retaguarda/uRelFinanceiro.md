# FRMRELFINANCEIRO — Relatório financeiro

**43 acessos · 7 operadores.** `UrelFinanceiro.pas` (846 linhas) + `UdmRelFinanceiro`. Migration **238**.
API `relatorios/financeiro`. Tela `/relatorios/financeiro`.

## 1. O que é

Recebíveis (`ARECEBER`, **99.768** títulos) e compromissos (`APAGAR`, **55.210**) no mesmo período e com os
mesmos filtros, cada linha trazendo a baixa ao lado do título. É o extrato que responde "o que entra e o que
sai".

## 2. ⚠️ O filtro por data de BAIXA do lado A RECEBER não funciona no legado

O legado monta o filtro **sem prefixo de tabela** (`:596`):

```pascal
vFiltroPG := vFiltroPG + ' AND ' + FormataCastData(vCampoDataPG) + ' BETWEEN ...'
```

e o cola num SELECT que já tem `LEFT JOIN ARECEBER_BX`. Como **as duas tabelas têm `DTPGTO`**, o Oracle
responde:

```
ORA-00918: coluna definida de maneira ambígua
```

— verificado na produção. O operador escolhe "Baixa", manda consultar e recebe a mensagem do `except`
(*"Erro : … ao tentar abrir consulta areceber"*). A opção está na tela e não produz relatório nenhum.

**E se rodasse, rodaria errado.** `ARECEBER.DTPGTO` é uma coluna denormalizada e abandonada:

| medida | valor |
|---|---|
| títulos quitados | **50.949** |
| com baixa em `ARECEBER_BX` | **18.601** |
| com `ARECEBER.DTPGTO` preenchido | **6.819** |
| ⇒ invisíveis no filtro por baixa | **11.782 títulos · R$ 12.207.925,74** |

Em agosto/2026, filtrar por `R.DTPGTO` dá **0 linhas** onde o certo (`BX.DTPGTO`) dá **24**.

Aqui a data de baixa é **sempre a da baixa**. Do lado A PAGAR o legado acerta por acidente: `APAGAR` **não
tem** `DTPGTO`, então o nome sem prefixo resolve sozinho para o da baixa.

## 3. ⚠️ O LIKE do parceiro anulava o LEFT JOIN

`AND P.RAZAO LIKE '%x%'` (`:610`) sobre um `LEFT JOIN PARCEIROS` derruba todo título **sem** parceiro, porque
`NULL LIKE '%%'` é falso — o mesmo defeito já corrigido em `FRMANALISEENTRADAXSAIDA` e em `FRMPRODUTOSREL`.
Aqui o filtro só se aplica quando preenchido, e o título sem parceiro aparece rotulado.

## 4. O total não multiplica com o título

O `LEFT JOIN` com a baixa **multiplica a linha** — um título com três baixas aparece três vezes, e é assim que
o legado mostra (uma linha por baixa, que é o que o operador quer ver). Mas o **valor do título** entra no
total **uma vez só**: somá-lo a cada baixa parcial dobraria o saldo. O valor pago/recebido, esse sim, soma
todas.

## 5. Cópia fiel, inclusive no vazio

| coluna / tabela | situação no cliente |
|---|---|
| `ARECEBER.NRODOC` (o "documento" impresso) | ⚠️ preenchido em **1** linha de 99.769 — a tela usa a `DUPLICATA` quando ele é nulo |
| `ARECEBER.CODCONTA` (o filtro "Conta corrente") | ⚠️ preenchido em **6** de 99.769 — o filtro existe e não seleciona nada deste lado |
| `CHEQUE` | **11** linhas |
| `CHEQUE_REP` · `CHQ_PROPRIO` · `PERMUTAS` | **0** linhas cada |

O `UNION ALL` do legado inclui cheques e permutas; o corte cobre **títulos**, e o ramo de cheque fica
declarado — não há substrato que justifique o esforço hoje.

## 6. O que fica para o próximo corte

O ramo de **cartões** (`CARTAO`, 2,06 milhões de linhas) entra no mesmo `UNION ALL` do legado, com a data de
compensação calculada (`CA.DTVENDA + DIASCOMP × NROPARCELA`). É volume de verdade e merece corte próprio,
junto com o extrato de recebíveis de cartão que já existe em `FRMFLUXOCARTOES`.
