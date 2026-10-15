# CADASTRO DE CFOP (`FRMCADCFOP`, `UCadCFOP.pas` 512 linhas + `uRDMCadCFOP`)

348 acessos (MENUEXPRESS). Permissões na produção: FRMCADCFOP / BTNADICIONARREGISTRO / BTNEDITAR / BTNGRAVAR / CMBALIQUOTA = 66 cada,
BTNEXCLUIR = 43. Apollo: `apps/web/src/features/cfop/CfopCadMaster.tsx` + `cadastro/cfops` (cfop.crud.ts).

## Auditoria controle a controle (15/10/2026) — `UCadCFOP.dfm` × Apollo

- `cmbALIQUOTA` (Tag 1 → CMBALIQUOTA): no `uMaster.SetStateOfControlsMaster` (:644-700) a opção só habilita/desabilita botões, itens de
  menu e os TJvCalcEdit/TJvDBCalcEdit/TJvDBCheckBox; num TDBLookupComboBox ela só muda a COR — o combo não trava. ❌→✅ o Apollo travava o
  combo sem a opção.
- A lista do combo é a `sqqAliquota`: a DET_ALIQUOTA **da UF da empresa** (não o cadastro de alíquotas) e o "ICMS Saída" ao lado é o
  ICM_EFETIVO dela; "Excluir Alíquota" limpa o campo (`btnExcluirAliqClick`). ❌→✅ `GET cadastro/cfop-aliquotas` (gate da tela; mig 430).
- As flags de processamento (financeiro, quantidade, transferência, cupom, Sintegra, custo, venda, SPED, apuração…), a "Situação do
  documento" por TIPO (`SetTipoCFOP` limpa o lado oposto), "sem processa financeiro não há financeiro automático" (`btnGravarClick`), o CFOP
  de devolução, a conta contábil e o registro de log — conferem.

Prova: smoke (o combo e o 403).
