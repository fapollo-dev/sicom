# Dossiê de Tela — CONTAS A PAGAR (`uCadAPagar`)

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | cortes 1 (cadastro/gestão) + 2 (baixa/pagamento) ENTREGUES e verdes, 2026-07-02 |
| **Autor** | Claude (agente de migração) |
| **Fonte legada** | `uCadAPagar.pas` (~1.354 linhas) — a GÊMEA de A Receber |

## 1. Decisão — espelho de A Receber
`uCadAPagar` é a **gêmea** de `uCadAReceber` (mesmo form-base, mesmas travas, baixa análoga). A migração **espelha** o padrão já auditado de A Receber (ver `uCadAReceber.md`), trocando ARECEBER→APAGAR, `codrcb`→`codapg`, cliente→**fornecedor** (frn), recebimento→**pagamento**. Reusa todo o molde (módulo vertical, tenant por `codempresa`, travas de estado, baixa com estorno lógico `INDR`).

## 2. O que foi entregue (migration 045, espelho de 043+044)
- **`apagar`** (existia em 028 como subset) enriquecida: colunas de gestão/estado/auditoria + índices; view **`get_apagar`** (juro/total live, carência por `PARCEIROS.TOLERANCIA`, igual a `get_areceber`).
- **`apagar_bx`** (baixa/pagamento): 1 título → N baixas; **estorno LÓGICO via `INDR` ('I'/'E')**, nunca deleta.
- **Serviços verticais** `apagar.service.ts` (CRUD + travas: quitado/agrupado/contabilizado/de-NF/origem-auto/conciliado) e `apagar-baixa.service.ts` (baixar/estornar; **já com as 2 correções ALTA auditadas em A Receber**: `valorpg>0` → `TITULO_VALOR_INVALIDO`; estorno por PK `codapgbx`). **Sem a trava "em-lote"** (lote de cobrança é de recebíveis).
- **Controller** `cadastro/apagar` (RBAC `FRMCADAPAGAR`) + endpoints `POST :id/baixar|estornar-baixa`.
- **Front** `ContasPagarCadMaster.tsx` (CadMaster tabulado, fornecedor, "Pagamento") + `apagarApi.ts` + rota `/cadastro/apagar` + menu.
- **db-types** `ApagarTable`/`ApagarBxTable`/`GetApagarView`. **Smoke §33** (13 casos: CRUD, validações, 6 travas de estado, RBAC, baixa/estorno-lógico, juros/desconto, agrupado, valorpg≤0, IDOR).

## 3. Adiado (corte-3, = A Receber)
Baixa parcial, recursos (caixa/cheque/cartão), contábil do pagamento, período-contábil-fechado, agrupamento in-place, boleto/CNAB, multi-parcela na tela. Códigos de erro PT reusados de A Receber (`TITULO_*`).

**Verde:** shared build · api tsc 0 · api test 123/123 · smoke 226/0 · web tsc 0 · web test 25/25 · web build.
