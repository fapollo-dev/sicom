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

## Recibo no layout do cliente (05/10/2026)

O recibo da baixa ("Documentos baixados com sucesso. Deseja fazer a emissão do recibo?") e o "Recibo" da consulta de baixas saem no
layout do cliente: `GET cobranca/baixa-apagar/recibo/:lote/impressao` (`Config\recibopagar.fr3`, RBAC FRMBAIXAAPAGAR ou FRMCONSAPGBX) e
`GET cobranca/baixa-receber/recibo/:lote/impressao` (`Config\recibo.fr3`, FRMBAIXAARECEBER ou FRMCONSRCBBX — a consulta do a receber
pergunta "Deseja fazer a emissão do recibo?" antes, como o legado). `dbdRecibo` = o `cdsDoctoBX` (`SELECT * FROM GET_APAGARBX WHERE LOTE`,
na ordem do FORNECEDOR; `GET_ARECEBERBX … ORDER BY DATA_VENCEU`), `dbdEmpresa` = a empresa do login, `VARIOS_FORNECEDORES` = mais de um
fornecedor no lote. O lote revertido lê a `GET_APAGARBX_REVERTIDAS` / `GET_ARECEBERBX_REVERTIDAS` (mig 407 — o `SetRevertido` da consulta;
4.669 / 613 linhas revertidas na produção; o A Pagar soma o TXJUROS ao VALOR e ao ACRES_DESC). O layout é o de `Config\` — na RELATORIOS o
mesmo nome existe no lote de `Relatorios\` com outro desenho; o de Config é o de código menor (`modeloFr3(…, { pasta: 'Config' })`). O
recibopagar de Config pergunta o "Layout de impressão" (Recibo — um por fornecedor — × Lista de recibos): o diálogo do FastReport sai na
janela de impressão e o OnClick do layout escolhe a página. O HTML próprio (`imprimirRecibo.ts`) saiu. Smoke §295.

## "Dados do recebimento" (05/10/2026)

O item de menu `MniDadosRecebimentoClick` (UconsRCBbx.pas:586) imprime `Relatorios\DadosRecebimentoCR.fr3` sobre os conjuntos da consulta:
**DbdTitulos** (GET_ARECEBERBX do lote, ORDER BY DATA_VENCEU; o revertido, a _REVERTIDAS), **DbdRecursos** (o movimento bancário do lote),
**DbdChequesRepassados** (os cheques recebidos na baixa — `CHEQUE.IDLOTEBXRCB`, 10 na produção) e **DbdPermutas** (PERMUTAS do lote — 0 linhas
na produção, a tabela não veio: a seção sai vazia), mais o DbdEmpresa. `GET cobranca/cons-rcb-bx/:lote/dados-recebimento` (FRMCONSRCBBX) e o
botão "Dados do recebimento" da tela. Smoke §295.2; teste de renderização (713).
