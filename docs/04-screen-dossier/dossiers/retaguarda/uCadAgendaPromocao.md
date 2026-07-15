# Dossiê de Tela — AGENDA DE PROMOÇÃO — `FRMAGENDAPROMOCAO` (`uCadAgendaPromocao`)

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | **corte-1 NÚCLEO ENTREGUE e verde** (2026-07-15): cadastro header+itens + período (data+hora) + validações (dtfim>dtini, preço>0, produto ativo, **anti-sobreposição** OVERLAPS) + workflow encerrar/reabrir + front. **SEM efeito** (a aplicação ao `multi_preco` é o corte-2). |
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

## 4. Adiado (com procedência — nada perdido)

- **corte-2: APLICAÇÃO do preço** — ativar a agenda → `UPDATE MULTI_PRECO SET PROMOCAO='S', VRPROMO=VLRPROMOCAO` dos itens no período; reverte no encerrar/fim (`uCadAgendaPromocao:247/746-750`). `multi_preco` já tem `vrpromo`+`promocao`; falta o link `codagenda` + o job de vigência. **Este é o próximo corte.**
- **Efeito-PDV** (depende do PDV): seleção do preço promocional no caixa (`uVendas`), `VRCLUBE_FIDELIDADE`/`MAXIMO` na venda, fila de etiquetas `LOTEPRECO`/`LTPRECO_PROCESSADO`, flags de mídia (publicação).
- **Multi-empresa** (`AGENDA_PROMOCAO_EMPRESA` + item.`EMPRESAS` CSV): consistente com a decisão de adiar leitura cross-empresa (cross-docking). corte-1 é single-empresa.
- **Atualização por grupo de preço** (`ATUALIZACAO_GRUPO`/`CODGRUPO`): aplica o preço promo a todos os produtos de um grupo. Adiado.
- **Outras promoções**: `PROMOCAO` combo (38), `PROMOCAO_ACUMULATIVA` (4), `PROMOCAO_DEPARTAMENTO` (0) — telas próprias, baixo uso.
