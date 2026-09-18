# FRMCADPISCOFINS — Cadastro de PIS/COFINS

**13 acessos · 3 operadores.** `uCadPisCofins.pas` (100 linhas, `TfrmCadMaster`) + `uRDMCadPisCofins`. Migration
**256**. API `cadastro/piscofins` (CRUD + `tipos-credito`). Tela `/cadastro/piscofins`. Smoke §134 (2 checks).

## 1. O que é

As **situações de PIS/COFINS** que cada produto aponta (`PRODUTOS.IDPISCOFINS`): descrição, alíquotas de
entrada/saída, CSTs de entrada/saída, o **tipo de crédito** (tabela 4.3.6 do SPED — `PC_TIPOCREDITO`, lookup
`GET_TIPOCREDITO`) e a flag `EXIGENATUREZA` (exige natureza de receita). É o que a apuração de PIS/COFINS lê.

## 2. O dado

| | |
|---|---:|
| situações | **12** |
| produtos apontando | **45.416** de 47.714 — TRIBUTADOS 31.626 · ALÍQUOTA ZERO 6.159 · MONOFÁSICO 5.069 · crédito presumido carne 1.267 · sem situação 2.298 |
| tipos de crédito (`PC_TIPOCREDITO`) | **25** códigos — semeados no destino |
| situações "CADASTRADO VIA FGF" | **5** (criadas pela integração externa do item 69) — 744 produtos apontam para elas |

## 3. Aqui

A tabela existia desde a migration 041 (7 linhas de seed) sem tela, sem `ID_TIPOCREDITO` e sem
`EXIGENATUREZA` — entram, com `pc_tipocredito` e a view `get_tipocredito`. **Excluir situação em uso é
recusado** (`PISCOFINS_EM_USO`, com a contagem): apagar TRIBUTADOS deixaria 31.626 produtos sem CST na
apuração. O legado não tem essa trava — tem a FK, que falharia com erro de banco.

## 4. Folds

- A leitura devolve `produtos` (quantos apontam) — é o que o operador precisa ver antes de mexer.
- Tenant: a tabela é global no legado e aqui (as situações são fiscais, não da loja).
