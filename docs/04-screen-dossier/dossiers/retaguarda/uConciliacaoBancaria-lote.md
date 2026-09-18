# Conciliação bancária — corte-3: o lote não se concilia pela metade

`UFrmConciliacaoBancaria.pas` + `UDMConciliacaoBancaria.pas`. Migration **276**. Fecha o
*"ramos A-PAGAR/A-RECEBER por IDLOTE = adiados"* declarado no corte-2 (`conciliacao-bancaria.service.ts`).
Smoke §47e.6.

## 1. A regra, do fonte

A conciliação automática do legado varre o extrato em **três passadas** — `OUTRAS MOVIMENTAÇÕES` →
`A PAGAR` → `A RECEBER` (`UDMConciliacaoBancaria.pas:281-287`, um `goto Inicio` por tipo). No fim,
`ValidaSelecaoLoteCompleto` procura lote **parcialmente selecionado** e reclama:

```
'O lote %d não foi conciliado totalmente.'
```

e `CancelaSelecaoLotesIncompletos` **desmarca o lote inteiro** quando falta alguma linha dele.

A razão é contábil: uma baixa em lote (N títulos a pagar num pagamento só) vira **um** débito no extrato.
Conciliar 3 das 5 linhas casaria o valor errado contra o banco **e deixaria duas linhas órfãs** — que
ninguém mais conseguiria conciliar depois, porque o movimento do extrato já teria sido consumido.

## 2. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| `MOV_CONTAS_BANCARIAS` | 291.484 lançamentos |
| … **com `IDLOTE`** | **206.211 (70,7%)** — o lote é a regra, não a exceção |
| `CONCILIACAO_BANCARIA` · `MOVIMENTACAO_BANCARIA_OFX` | 18.431 · 66.209 |

## 3. O que o corte-3 entrega

- **`sugerir` casa o LOTE inteiro primeiro**: agrupa o razão por (lote, dia, direção), soma, e procura no
  extrato uma linha com aquele total. Os lotes vêm antes do casamento 1:1 para que as linhas do lote não
  sejam consumidas uma a uma. A resposta ganhou o campo `lotes` ao lado de `pares`.
- **`conciliar` recusa lote incompleto**: 422 `LOTE_INCOMPLETO`, com o lote, quantos foram selecionados e
  **quais linhas faltam** (o `detalhe` do envelope de erro) — é a trava do legado, agora explícita em vez
  de "desmarcar sozinho".
- Índice parcial `ix_mov_contas_bancarias_lote (codconta, idlote) WHERE idlote IS NOT NULL`.
- A tela sugere lote + pares numa tacada e explica a regra no rodapé.

O smoke prova com um lote de 3 pagamentos (120 + 100 + 80) contra um débito de 300 no extrato: a sugestão
traz o lote inteiro, conciliar 2 das 3 é recusado dizendo qual falta, e com as 3 concilia e marca as três.
