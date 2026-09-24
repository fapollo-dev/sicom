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

## 4. A EDIÇÃO E A EXCLUSÃO COMO A TELA DO LEGADO (24/09/2026, `uAPagar.pas`)

O Apollo tinha travas próprias que o legado **não tem** — título de NF, de origem automática, contabilizado e conciliado não
se editavam — e com isso o cliente não conseguiria fazer o que faz todo dia: lançar o desconto e o juro nos títulos das
notas (**268 descontos e 198 embutidos em 2026** foram digitados em títulos de NF) e trocar o vencimento. Agora:

- **Travas da tela** (`edtCodigoExit :3193-3232`): só pago (QUITADA), adiantamento crédito (ADCREDITO) e agrupado
  (AGRUPADO) travam o documento. A do convênio de funcionários baixado/agrupado não tem substrato (CONVENIO_FUN com 0 linhas).
- **Campos travados** (`BloquearCampos :651-675`, com `BLOQUEIA_CONTAS_PAGAR_ORIGEM_AUTO`='S' na produção) no título de
  **origem automática** (`FinanceiroOrigemAutomatica :4243`: ORIGEM preenchida, título do faturamento da NF — GFAT='S' —, ou
  adiantamento a fornecedor): fornecedor, valor, juros, observação, duplicata, parcelas e centro de custo → 422
  `TITULO_CAMPO_BLOQUEADO`. O resto (vencimento, emissão, desconto, embutidos, tipo, banco, forma) muda. O valor do
  agrupamento nunca se digita (`edtVALOR.Enabled := not AGRUPAMENTO`). A leitura devolve `campos_bloqueados` e a tela os
  desabilita.
- ⚠️ **O faturamento da NF passa a gravar GFAT='S'** (e GERADO 'SISTEMA'), como o legado (3.430 títulos de NF em 2026) — sem
  isso a tela não reconhecia o título da nota como automático.
- **Contabilizado** (`VerificaContabilizado :5536`): sem integração automática, "Não é permitido editar/excluir esta conta
  pois já foi contabilizada."; com ela, o lançamento do documento é estornado antes — e volta no fim do gravar
  (`IntegraApagar :6654`: com integração automática, todo gravar contabiliza os títulos do grupo; o erro é calado). A criação
  também integra.
- **Desconto e embutidos** (`edtDesconto`/`edtVendor`, `InserirLancamentoCentroCusto :6537-6645`): com
  `LANCAR_CENTROCUSTO_DESCACREJRS_CONTAS_PAGAR`='S' (o módulo Retaguarda na produção), viram as linhas **D** (CC da situação
  `CONFIG_DESCONTOS_APG`, 1150 → CC 1077) e **E** (`CONFIG_EMBUTIDOS_APG`, 1290 → CC 304) no CX_APAGAR com a soma do grupo
  (D 268/269 e E 213/216 batem) — e a CAIXA do grupo (`apagar-caixa.ts`) já as consome no resíduo do último CC. Sem a
  configuração, a diferença é rateada pelos centros de custo (o "Deseja ratear…?" do legado). Situação ou CC não configurados
  → 422 com a mensagem do legado. ⚠️ divergência: desconto zerado tira a linha D (o legado a deixava, e a CAIXA ficava com o
  desconto velho).
- **HISTORICO da edição** (`SetaHistorico`, udmPrincipal.pas:3038): uma linha por campo alterado — `ALTERACAO DO CAMPO
  VENDOR DE: 0 PARA: 1,55` — com o `AsString` do Delphi (vírgula, sem zeros à direita) e a data dd/mm/aaaa (6.771 TIPODOC,
  1.241 DTVENC, 1.073 VALOR, 533 DESCONTO, 442 VENDOR desde 2025). Campos: CODPARCEIRO, DTCOMPRA, DTVENC, VALOR, DESCONTO,
  VENDOR, TOTAL_DOC, DUPLICATA, TIPODOC, OBS, IDNF.
- **Excluir** (`btnExcluirClick :1105-1238`), na ordem: título de NF existente → "realize a reversão do financeiro"; de
  adiantamento existente; parcela paga no documento; contabilizado sem integração automática; agrupamento; desconto de
  títulos (vinculado ou gerado). Sai o **documento inteiro** — todas as parcelas do grupo (o Apollo apagava uma e deixava as
  outras sem rateio nem CAIXA) —, cada uma com `EXCLUSAO DO REGISTRO FORNECEDOR: 22-…, DOCUMENTO: …, VALOR: 054` (o
  `FormatFloat('0,00')` do Delphi: inteiro, mínimo 3 dígitos, milhar com ponto — "001", "054", "1.068" na produção).

Smoke §33 (as travas novas) e §174 (D/E, estorno do contábil, exclusão do documento).
