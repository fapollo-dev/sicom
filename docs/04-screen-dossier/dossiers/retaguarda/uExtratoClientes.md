# FRMEXTRATOCLIENTES — Extrato de clientes

**13 acessos · 2 operadores.** `UextratoClientes.pas` (486) + `UdmExtratoClientes`. Migration **257**.
API `GET cobranca/extrato-clientes`. Tela `/cobranca/extrato-clientes`. Smoke §135 (3 checks).

## 1. O que faz

Quatro modelos sobre o A Receber — **extrato por período**, **por data de referência a menor**, **a maior** e
**saldo do contas a receber em** — cruzados com o campo de data (emissão / vencimento / baixa), o status (em
aberto / baixados / todos), o cliente e, no saldo, um teto de valor; analítico ou sintético (o sintético só
existe para o saldo no legado — aqui vale para todos). Sempre `COALESCE(AGRUPADO,'N') = 'N'`: o agrupado já
está representado pelo título-pai (62.344 dos 99.790 títulos do cliente).

## 2. ⚠️ Três dos quatro modelos não filtram empresa

`GetFiltroEmpresa` só entra no modelo saldo. Medido em 2026 (`AGRUPADO='N'`): **3.129** títulos na loja 1,
**6.364** no total — o extrato de um cliente da loja 1 trazia os títulos dele nas outras lojas (a 50 sozinha
tem R$ 16,96 milhões em títulos). Aqui os quatro são tenant-scoped.

## 3. ⚠️ O "saldo em" confia em `ARECEBER.DTPGTO` — vazio em 44.130 quitados

`WHERE DTVENDA <= :ref AND (DTPGTO > :ref OR DTPGTO IS NULL)`: um título quitado sem `DTPGTO` conta como em
aberto em qualquer data de referência. No cliente: **44.130 títulos quitados (R$ 13,78 milhões) com DTPGTO
NULL**, 11.782 deles com a baixa registrada em `ARECEBER_BX`. Aqui a data efetiva é
`coalesce(areceber.dtpgto, dtpgto da baixa ativa)`.

## 4. Folds

- `NF.NRONF`: `IDNF` preenchido em 34 dos 13.974 títulos de 2026 — a coluna vem, quase sempre vazia.
- "Agrupar por mês" é variável do `.fr3`; cada linha traz `mes` (do campo de data escolhido).
- Juro/acréscimo/pago vêm da baixa **ativa** (`INDR='I'`), como no legado — não o `JURO_CALCULADO` de 9% da
  view `GET_ARECEBERBX`.
