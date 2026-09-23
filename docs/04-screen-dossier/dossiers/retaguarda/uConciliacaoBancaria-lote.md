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

## 4. As regras do extrato: o que não se importa, e o que se lança sozinho (corte-4, migration 298)

Adiadas na migration 120 e achadas no inventário completo de tabelas fora do plano. As duas tabelas são de
depois do fonte (mai/2020); **as regras saíram do dado** (produção, só leitura, 23/09/2026). A importação de
OFX está viva: 11.599 linhas em 2026.

**`CFG_DESCRICAO_NAO_IMPORTAR_OFX` — descrições que a importação ignora.** 3 linhas, todas da conta 42: a
aplicação automática do banco. O filtro é por **igualdade exata**, e o dado prova que "contém" estaria errado:
'APL' e 'RES APLIC AUT MAIS' param de entrar em 30/11/2022 e 'SALDO' em abr/2021, enquanto 'REND PAGO APLIC AUT
MAIS' — que contém o mesmo texto e não está na lista — segue entrando até 2026. A importação devolve quantas
linhas ignorou, e a tela diz.

**`CONFIG_LANCAMENTO_AUTO_OFX` — a linha do extrato que se lança sozinha.** 5.311 regras, duas famílias:

| família | regras | prova de uso | aqui |
|---|---:|---|---|
| **N** — lançamento (situação + conta gerencial) | 57 (33 ativas) | **os 17 movimentos carimbados com `CLAO_ID`, todos de ago/2026** | ✅ aplicada |
| **T** — transferência | 5.254 | **nenhum** movimento carimbado | carregada, não aplicada |

O mecanismo, lido nos 17: para cada linha pendente cuja descrição casa (igualdade — as 9 regras usadas são
`TIPO_DESCRICAO='1'`) com uma regra N da conta, nasce um **lote** com uma linha em `CAIXA` (data da linha, valor
com sinal, conta gerencial e situação da regra, obs "Gerado pela conciliação bancária.", recurso DINHEIRO,
cadastrado manualmente) e uma em `MOV_CONTAS_BANCARIAS` (histórico = a descrição, origem 'OFX', `CLAO_ID`),
**já conciliada** com a linha do extrato. A contabilização da origem 64 pega a `CAIXA` pela situação — no cliente,
566 DESPESAS BANCARIAS e 645 OUTRAS RECEITAS, contas gerenciais TARIFA PIX, IOF, RENDIMENTO APLIC FINANCEIRA.

No Apollo é a ação **«Lançamentos automáticos»** da tela (`POST /cadastro/conciliacao-bancaria/lancamentos-
automaticos`, `BTNGRAVAR`). Regra excluída (`INDR='E'`) não vale; regra repetida para a mesma descrição (55 no
cliente) vale a primeira; rodar de novo não lança nada (a linha já está conciliada). `caixa.codcx` ganhou sequência
própria — nenhum fluxo do Apollo gravava na CAIXA até aqui.

⚠️ **Adiado, com o motivo**: as regras T (5.254) e o `TIPO_DESCRICAO='3'` (2 regras T) — sem nenhum movimento do
cliente gerado por elas, não há efeito para copiar. E o gatilho: no legado não se sabe se o lançamento roda ao
importar ou por comando (os 17 têm datas de linha variadas); aqui é um comando explícito.
