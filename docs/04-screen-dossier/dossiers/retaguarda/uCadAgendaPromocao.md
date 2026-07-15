# Dossiê de Tela — AGENDA DE PROMOÇÃO — `FRMAGENDAPROMOCAO` (`uCadAgendaPromocao`)

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | **corte-1 + corte-2 ENTREGUES e verdes** (2026-07-15). corte-1 NÚCLEO: cadastro header+itens + período (data+hora) + validações + workflow encerrar/reabrir + front. **corte-2 APLICAÇÃO**: ativar→`multi_preco.promocao='S'/vrpromo/codagenda`; encerrar reverte por codagenda. Auditoria adversarial (6 achados: 1 ALTA + 3 MÉDIA + 2 BAIXA) folded (mig 082). Verde: api tsc 0 · api test 145 · **smoke 533/0** (§76.1-9) · web tsc 0 · test 32 · build. Efeito-PDV adiado. |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `uCadAgendaPromocao.pas` (2.621 linhas) + `udmCadAgendaPromocao.pas`/`.dfm`. Lido no disco (`/Users/apollosistemas/Downloads/retaguarda-master/fonte/Units/`). |
| **Golden** | Oracle PINHEIRAO (READ-ONLY, verificado 2026-07-15): `AGENDA_PROMOCAO` (2.027; 2.012 não-encerradas), `AGENDA_PROMOCAO_ITENS` (23.666; ATIVO S=22.505/N=660), `AGENDA_PROMOCAO_EMPRESA` (790). |

## 1. Descoberta-âncora (escopo)

Há **dois sistemas de promoção** no legado; a tela nomeada pelo usuário (`UCadPromocao`) é a **promoção-COMBO** (tabela `PROMOCAO`, 15 col, **38 linhas** — leve/leve-pague, `VALORCOMBO`/`TIPOCOMBO`/`VALOR_MINIMO_COMPRA`), niche. O sistema **de verdade** é a **AGENDA DE PROMOÇÃO** (`uCadAgendaPromocao` → `AGENDA_PROMOCAO`), consumida por PDV/etiqueta/precificação (`uVendas`, `Uetiqueta`, `uPrecificacaoProdutos`, `UCadProduto`). Decisão do usuário: **mirar na AGENDA**. Outras variantes (`PROMOCAO_ACUMULATIVA` 4 linhas; `PROMOCAO_DEPARTAMENTO` 0 linhas) ficam adiadas.

## 2. Modelo (Oracle real → migração)

- **AGENDA_PROMOCAO** (header): `CODAGENDA` PK, `NOMEPROMO`, `DTINICIOPROMOCAO`/`DTFIMPROMOCAO` (**timestamp — período com HORA**), `FLAGPROMOCAO` ('J' agendada=norma 2019/2027, 'N'=8), `CODEMPRESA`, `OPCOES`, `DTENCERRAMENTO` (null=aberta; 2.012 abertas), `CODOPERADORENC`, auditoria, `INDR`.
- **AGENDA_PROMOCAO_ITENS**: `CODAGENDAITEM` PK, `CODAGENDA` FK, `IDPRODUTO`, `VLRPROMOCAO` (preço promo), `VRVENDA` (snapshot do preço normal), `ATIVO` ('S'/'N'), `DTATIVO`, `VRCLUBE_FIDELIDADE`, `MAXIMO` (qtd máx/venda), `VLR_MIN_COMPRA`, flags de mídia `TV`/`RADIO`/`TABLOIDE`/`INTERNO`, `EMPRESAS` (CSV), `ATUALIZACAO_GRUPO`/`CODGRUPO` (atualização por grupo de preço).
- **AGENDA_PROMOCAO_EMPRESA**: `CODAGENDA`+`CODEMPRESA` (escopo multi-loja).

**Migração (080):** `agenda_promocao` (empresaScoped, `idempresa` carimbado; soft-delete INDR) + `agenda_promocao_itens` (subset vivo: idproduto, vlrpromocao, vrvenda, ativo, dtativo, vrclube_fidelidade, maximo, vlr_min_compra, media flags). View `get_agenda_promocao` = header + `qtde_itens` + **`situacao` derivada** (ENCERRADA / AGENDADA / VIGENTE / EXPIRADA por `now()` vs período).

## 3. Corte-1 (ENTREGUE) — NÚCLEO

- **Agregado** `agenda-promocao.aggregate.ts` (createAggregateController, `cadastro/agenda-promocao`, RBAC `FRMAGENDAPROMOCAO`): master `agenda_promocao` + detalhe `agenda_promocao_itens`.
- **derivarItensTrx**: `ATIVO`='S' default; `NROITEM` sequencial; `DTATIVO`=now nos itens ativos (fiel ao legado).
- **validar**: (a) trava de estado — agenda ENCERRADA é read-only; (b) cada produto existe e está **ATIVO** (`produtos.ativo<>'N'`); (c) **ANTI-SOBREPOSIÇÃO** (`uCadAgendaPromocao:1616`) — nenhum produto ativo pode participar de OUTRA agenda não-encerrada, da mesma empresa, com período sobreposto (operador `OVERLAPS` do Postgres, params `::timestamptz`). Período `dtfim>dtini` + preço>0 vêm do schema (superRefine).
- **validarRemocao**: ENCERRADA não exclui.
- **Vertical** `agenda-promocao.service.ts`/`.controller.ts`: `encerrar` (aberta→encerrada, grava dtencerramento+operador, CAS) / `reabrir` (encerrada→aberta, CAS). `POST :id/encerrar` `:id/reabrir` (RBAC BTNENCERRAR).
- **Shared** `agenda-promocao.schema.ts`: `agendaPromocaoSchema` (nome obrigatório, período obrigatório + `superRefine` dtfim>dtini, itens min 1) + `agendaPromocaoItemSchema` (vlrpromocao>0).
- **Front** `AgendaPromocaoCadMaster.tsx`: form (nome + período `datetime-local` + adder de itens produto/preço/clube/máx) + lista com workflow (encerrar/reabrir/excluir via coluna `type:'actions'`). Rota `/cadastro/promocoes` + menu "Promoções".

### Verificação
shared build · api tsc 0 · api test 145 · **smoke 527/0** (§76: criar+itens · período inválido→400 · preço≤0→400 · anti-sobreposição→422 · período não-sobreposto→201 · produto inativo→422 · encerrar→editar-encerrada 422→reabrir · RBAC 403) · web tsc 0 · test 32 · build. Auditoria adversarial 2 lentes (paridade+regressão) — achados dobrados.

## 3b. Corte-2 (ENTREGUE) — APLICAÇÃO do preço + folds da auditoria

- **APLICAÇÃO** (`aplicar`, mig 081): ativar a agenda → p/ cada item ATIVO com preço na empresa, `UPDATE MULTI_PRECO SET PROMOCAO='S', VRPROMO=VLRPROMOCAO, CODAGENDA=<agenda>` + histórico (`uCadAgendaPromocao:247`). `encerrar` REVERTE só as linhas `codagenda=esta` (`PROMOCAO='N'`, `vrpromo`/`codagenda` null — `:750`). `multi_preco.codagenda` = link da campanha (reversão precisa). `POST :id/aplicar` (RBAC BTNAPLICARPRECO); front ganha ação «Aplicar preços». Agenda encerrada não aplica.
- **Folds da auditoria (mig 082):** [ALTA] anti-sobreposição era burlável por PUT parcial → `validar` faz FALLBACK ao período+itens PERSISTIDOS. [MÉDIA] bloqueio duro → GATE `PERMITE_PRODUTO_MAIS_UMA_AGENDA` (default 'S' permissivo, fiel; bloqueia só ='N'). [MÉDIA] `vlrpromocao>0` estrito → "não-ambos-zero" (aceita promo só-clube, `:651`). [MÉDIA] `datetime-local` sem fuso → o front converte p/ ISO com offset. [BAIXA] produto repetido na agenda → `PROMOCAO_PRODUTO_DUPLICADO` (`:951`).

## 4. Adiado (com procedência — nada perdido)

- **Efeito-PDV** (depende do PDV): seleção do preço promocional no caixa (`uVendas`), `VRCLUBE_FIDELIDADE`/`MAXIMO` na venda, fila de etiquetas `LOTEPRECO`/`LTPRECO_PROCESSADO`, flags de mídia (publicação).
- **Multi-empresa** (`AGENDA_PROMOCAO_EMPRESA` + item.`EMPRESAS` CSV): consistente com a decisão de adiar leitura cross-empresa (cross-docking). corte-1 é single-empresa.
- **Atualização por grupo de preço** (`ATUALIZACAO_GRUPO`/`CODGRUPO`): aplica o preço promo a todos os produtos de um grupo. Adiado.
- **Outras promoções**: `PROMOCAO` combo (38), `PROMOCAO_ACUMULATIVA` (4), `PROMOCAO_DEPARTAMENTO` (0) — telas próprias, baixo uso.
