# FRMCONSRCBBX — Consulta de baixas do A Receber por lote

**17 acessos · 4 operadores.** `UconsRCBbx.pas` (672) + `.dfm` (1.588) + `UReversaoBaixaContasReceber.pas`.
Migration **254**. API `cobranca/cons-rcb-bx` (`GET lotes` · `GET :lote` · `PUT baixa/:codrcbbx/obs` ·
`POST :lote/reverter`). Tela `/cobranca/cons-rcb-bx`. Smoke §131 (3 checks).

A **gêmea de recebíveis** da [FRMCONSAPGBX](uConsAPGbx.md) (migration 253): mesmo desenho, mesma classe-base de
reversão, mesmas travas. Este dossiê registra só o que é diferente.

## 1. O que o dado diz

| | |
|---|---:|
| baixas em `ARECEBER_BX` | **19.225**, em **3.219 lotes** (100% com IDLOTE) |
| reversões (`INDR='E'`) | **611** — 28 em 2026, em 7 lotes |
| lotes revertidos inteiros · parcialmente | **109 · 0** |
| lotes de 2026 com movimento bancário | **309 de 309** |
| `ARECEBER_BX_SALDO` ("BAIXA COM SALDO") | **0 linhas** |
| `PERMUTAS` | **0 linhas** |
| cheques com lote | 0 |
| baixas com `DTPGTO` no ano **5022** | 2 (digitação) |

## 2. A view `GET_ARECEBERBX`

É um `UNION` de BAIXA COMUM (`ARECEBER_BX`) com BAIXA COM SALDO (`ARECEBER_BX_SALDO`, vazia), e carrega o
`JURO_CALCULADO` com o default de **9% a.m.** quando o título não tem taxa — o mesmo juro fantasma que rendeu
R$ 11,5 milhões de diferença na `FRMCONSCLIRCB` (migration 227). Esta consulta mostra o juro **cobrado** na
baixa (`ARECEBER_BX.JUROS`), não o calculado.

## 3. Diferenças de recebíveis

- **Dias de atraso** (`DIAS_ATRAZO`): data do pagamento − vencimento, nunca negativo. Fiel.
- **Observação editável** (`BtnGravarObsClick`): grava `OBS_EDITAVEL` em `ARECEBER_BX` (para "BAIXA COMUM") ou
  em `ARECEBER_BX_SALDO` (para "BAIXA COM SALDO"). A segunda não existe no cliente: só a primeira entra.
- **Reversão**: `TReversaoBaixaContasReceber.ReverteLote` — a mesma sequência da AP; o estorno por título do
  Apollo (`areceber-baixa.service.ts`) ganhou o `estornarNoTrx` para ser encadeado no lote. O histórico do
  contra-movimento é *"Reabertura da baixa de contas a receber, lote N, realizada pelo usuário X."*
- **Permutas** (`LancaSaldo` cria um título no A PAGAR a partir da permuta): a tabela tem 0 linhas — fora.

## 4. Folds

Os mesmos da 253: baixa do Apollo sem IDLOTE = lote de um; "Manutenção" e recibo `.fr3` fora; `CaixaFechado`
da conta bancária vive em BO compilado que não veio — a trava é a do caixa do Apollo; tenant-scoped.
