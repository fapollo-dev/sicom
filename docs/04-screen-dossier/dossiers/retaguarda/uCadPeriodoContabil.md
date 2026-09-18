# FRMCADPERIODOCONTABIL — Cadastro de período contábil

**14 acessos · 5 operadores.** `uCadPeriodoContabil.pas` (140 linhas, `TfrmCadMaster`). Migration **256**.
API `contabil/periodo-contabil` (CRUD). Tela `/contabil/periodo-contabil`. Smoke §133 (2 checks).

## 1. Por que importa mais do que o tamanho

A tabela `PERIODO_CONTABIL` é de onde saem as travas de **período fechado** que a NF, os títulos, as baixas, o
caixa, o cheque, o adiantamento e o cartão já obedecem no Apollo (`shared/periodo-contabil.ts`, migration 038,
`assertPeriodoNaoFechado`). Existia no destino desde a 038 — mas sem tela nem escrita.

## 2. O dado

| | |
|---|---|
| períodos no cliente | **3**: `082024` e `072024` abertos; `02/2025` com **todos os nove bloqueios em 'S'** e `STATUS='N'` |
| `CONFIG_INTEGRACAO_CONTABIL.CHAVEAMENTO_PERIODO` | **NULL** — a trava viva é esta tabela, não o chaveamento |
| grafia da competência | `082024` e `02/2025` convivem — o legado grava como digitado |

## 3. A regra da tela

Uma só: **competência única** (`RetornarValores('PERIODO_CONTABIL','COMPETENCIA_CONTABIL', … AND
CODPERIODOCONTABIL <> :cod)` → "Já existe este período cadastrado!"). Aqui a unicidade é **por empresa** e a
competência é normalizada para **MMAAAA** na gravação (o `replace('/','')` na comparação alcança as duas grafias
do cliente). O destino não tinha `COMPETENCIA_FINANCEIRA`, `COMPETENCIA_GERACAO`, `BLOQ_MOV_CAIXA`, `BLOQ_CHQ`
e `BLOQ_BAIXA_CRT` — entram.

## 4. Folds

- `DATA_INICIO`/`DATA_FIM` no cliente carregam hora (`10:16:13`); aqui são `date` — o que a trava compara.
- Excluir um período é permitido, como no `CadMaster` do legado; as travas simplesmente deixam de valer.
