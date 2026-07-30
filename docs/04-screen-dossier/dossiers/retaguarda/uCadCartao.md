# Dossiê de Tela — CARTÕES / RECEBÍVEIS — `FRMCADOPERADORAS` + `FRMCADCARTAO`

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | corte-1 (operadoras + recebível, **sem baixa**) ENTREGUE e verde, 2026-07-30, commit `1bd1292`, migration 117. Recon (Oracle golden + monorepo). **Auditoria: os 2 subagentes bateram em API-529 (overload) repetidamente → review INLINE**, com o smoke provando o caminho crítico. Verde: shared build · api tsc 0 · api test 172 · smoke **802/0** (§47c, 6 checks) · web tsc 0 · build. |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `FRMCADOPERADORAS` (cadastro de adquirente — **não confundir** com `uCadUsuarios`, que é operador de sistema) + `FRMCADCARTAO` (recebível). View legada: `GET_CARTAO`. Adiado: `UbaixaCartao`, `CONS_REG10`. |
| **Golden** | Oracle PINHEIRAO: `CARTAO` (**125.240 linhas**, 2024→2026), `OPERADORAS`, `BANDEIRA`, `GET_CARTAO`. |

## 1. O que é

Um **Contas a Receber especializado em cartão**: cada venda no cartão vira um recebível (valor bruto, taxa da administradora, vencimento). `LIBERADO='N'` = aberto; `'S'` = baixado.

**Achado de fronteira:** a **retaguarda não gera o recebível** — ele nasce no **PDV** (desligado neste momento) ou em cadastro manual. Por isso o módulo da retaguarda é **consulta + cadastro + (futuro) liquidação**; a geração fica com o PDV + ETL.

Escolhido como 2º módulo da fila por ser o **maior dataset ainda não migrado**.

## 2. Modelo (Oracle real) — migration 117

- **`bandeira`** — seed de 11.
- **`operadoras`** (adquirente): `txadm%`, `txadmparc`, `diascomp`, `tipo` (C/D/A), `tipocartao`, `codbandeira`, `codadm` → `parceiros`, `codoperadorabase` (hierarquia). Cadastro **GLOBAL**, soft-delete `INDR`.
- **`operadoras_taxa`** — override de taxa/dia **por empresa**, `UNIQUE (codoperadoras, idempresa)`.
- **`cartao`** (o recebível): valor bruto, `txefetiva` (em R$), `valorliq`, `liberado`, `dtvenda`, `dtbaixa`, `idlote` + colunas de baixa **não escritas** no corte-1. **Sem `INDR`** → exclusão física. Dropadas as mortas: `valor_liquido`, `tx_aministrativo`, `resumo`, `datavencimento`, `idnf`, `codcx`, `origem`.

### A regra financeira vive na VIEW

`get_cartao` **computa**, espelhando o `GET_CARTAO` do legado:

```
líquido    = COALESCE(valorliq real, (valor + ajuste) − valor × txadm_ef/100)
vencimento = dtvenda + diascomp_ef × parcela      -- fim de semana empurra p/ frente: dom → +1, sáb → +2

txadm_ef    = override-por-empresa (>0)  >  base (via codoperadorabase)  >  própria
diascomp_ef = COALESCE(operadoras_taxa.diafechamento, operadoras.diascomp)
```

Semântica confirmada: `TXEFETIVA` é a taxa **em R$** e `VALORLIQ` = `valor − txefetiva`; a view usa a `TXADM%` para o computado e **cai no `valorliq` real** quando ele existe. `LIBERADO` é autoritativo.

## 3. Corte-1 (ENTREGUE)

- **backend:** `operadoras.aggregate` (mestre-detalhe operadoras + `operadoras_taxa`; `empresaScoped=false`, global) + `cartao.crud` (CRUD simples lendo a view; `empresaScoped=true`). RBAC `FRMCADOPERADORAS` + `FRMCADCARTAO`.
- **frontend:** `CartaoPage` (consulta de recebíveis — Bruto / Líquido / Vencimento / Situação, filtro aberto-ou-baixado, lançamento manual) · `OperadorasPage` (cadastro do adquirente + sub-grade de override por empresa) · rotas `/financeiro/cartoes` e `/cadastro/operadoras` + menu.

### Fold da auditoria

**[BAIXA]** dois overrides para a **mesma empresa** violariam o `UNIQUE` no reinsert (o detalhe faz delete+insert) → o `validar` rejeita com **`OPERADORA_TAXA_EMPRESA_DUPLICADA`**. Smoke §47c.5.

### Verificado inline (smoke-provado)

Líquido base **97,41** (100 − 2,59%) e com override por empresa **98,00** (2,0% — precedência aplicada) · sem fan-out (o `UNIQUE ux_operadoras_taxa` garante ≤ 1 override por cartão) · FK de operadora inexistente → 4xx limpo · tenant-scoped (`cartao` empresaScoped; `operadoras` global by-design) · weekend-skip do vencimento · **operadora soft-deletada (`INDR`) não quebra o join** dos recebíveis antigos — correto, mantém a taxa histórica · divisão numérica (não integer) confirmada pelo 97,41.

## 4. Adiado (com procedência)

- **Baixa em lote** (`UbaixaCartao` → `MOV_CONTAS_BANCARIAS` + CAIXA) = **corte-2**.
- **Conciliação de extrato** (`CONS_REG10` + 7 conciliadores: Cielo, Rede, Tivit, …) = épico à parte.
- **Geração automática do recebível vive no PDV (OFF)** → no corte-1 o recebível só nasce de cadastro manual; os 125k vivos dependem do ETL/PDV.
- **Travas "não editar baixado"** entram no corte da baixa — no corte-1 tudo nasce `liberado='N'`.

## 5. Pendência

**Preview de tela:** pendente do eyeball do usuário.

## 6. Lição extraída

Quando a regra financeira do legado **vive numa view Oracle** (aqui `GET_CARTAO`: líquido + vencimento), **espelhar a view** no monorepo (view SQL computada) é mais fiel **e** mais testável do que reimplementar no serviço.

E: auditoria por subagente pode falhar (API 529) — ter o **review inline como fallback**, com o smoke provando o caminho crítico.

## Ver também

- [uCadAReceber.md](uCadAReceber.md) — o A Receber genérico do qual este é a especialização.
- [uCaixa.md](uCaixa.md) — destino da baixa no corte-2.
- [uCadUsuarios.md](uCadUsuarios.md) — o outro "operador", para não confundir.
