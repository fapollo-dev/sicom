# Dossiê de Tela — AGENDA DE PROMOÇÃO — `FRMAGENDAPROMOCAO` (`uCadAgendaPromocao`)

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | **corte-3 MULTI-LOJA + ciclo do status ENTREGUE** (2026-09-23, mig 312, smoke 1451/0 — §5 abaixo). **corte-1 + corte-2 ENTREGUES e verdes** (2026-07-15). corte-1 NÚCLEO: cadastro header+itens + período (data+hora) + validações + workflow encerrar/reabrir + front. **corte-2 APLICAÇÃO**: ativar→`multi_preco.promocao='S'/vrpromo/codagenda`; encerrar reverte por codagenda. Auditoria adversarial (6 achados: 1 ALTA + 3 MÉDIA + 2 BAIXA) folded (mig 082). Verde: api tsc 0 · api test 145 · **smoke 533/0** (§76.1-9) · web tsc 0 · test 32 · build. Efeito-PDV adiado. |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `uCadAgendaPromocao.pas` (2.621 linhas) + `udmCadAgendaPromocao.pas`/`.dfm`. Lido no disco (`/Users/apollosistemas/Downloads/retaguarda-master/fonte/Units/`). |
| **Golden** | Oracle PINHEIRAO (READ-ONLY, verificado 2026-07-15): `AGENDA_PROMOCAO` (2.027; 2.012 não-encerradas), `AGENDA_PROMOCAO_ITENS` (23.666; ATIVO S=22.505/N=660), `AGENDA_PROMOCAO_EMPRESA` (790). |

## 1. Descoberta-âncora (escopo)

Há **dois sistemas de promoção** no legado; a tela nomeada pelo usuário (`UCadPromocao`) é a **promoção-COMBO** (tabela `PROMOCAO`, 15 col, **38 linhas** — leve/leve-pague, `VALORCOMBO`/`TIPOCOMBO`/`VALOR_MINIMO_COMPRA`), niche. O sistema **de verdade** é a **AGENDA DE PROMOÇÃO** (`uCadAgendaPromocao` → `AGENDA_PROMOCAO`), consumida por PDV/etiqueta/precificação (`uVendas`, `Uetiqueta`, `uPrecificacaoProdutos`, `UCadProduto`). Decisão do usuário: **mirar na AGENDA**. Outras variantes (`PROMOCAO_ACUMULATIVA` 4 linhas; `PROMOCAO_DEPARTAMENTO` 0 linhas) ficam adiadas.

## 2. Modelo (Oracle real → migração)

- **AGENDA_PROMOCAO** (header): `CODAGENDA` PK, `NOMEPROMO`, `DTINICIOPROMOCAO`/`DTFIMPROMOCAO` (**timestamp — período com HORA**), `FLAGPROMOCAO` (⚠️ **corrigido no §5**: N=ABERTA · E=EXECUTANDO · J=FECHADA — a leitura original "'J' agendada=norma" estava errada), `CODEMPRESA`, `OPCOES`, `DTENCERRAMENTO` (null=aberta; 2.012 abertas), `CODOPERADORENC`, auditoria, `INDR`.
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
- ~~**Multi-empresa**~~ → **convertido no corte-3 (§5)**. A premissa ("cross-docking", número da homologação) caiu como no pedido de compra: em 2026, 185 de 468 agendas valem para mais de uma loja.
- **Atualização por grupo de preço** (`ATUALIZACAO_GRUPO`/`CODGRUPO`): aplica o preço promo a todos os produtos de um grupo. Adiado.
- **Outras promoções**: `PROMOCAO` combo (38), `PROMOCAO_ACUMULATIVA` (4), `PROMOCAO_DEPARTAMENTO` (0) — telas próprias, baixo uso.

## 5. Corte-3 (ENTREGUE, 2026-09-23, mig 312) — MULTI-LOJA e o ciclo do status

Aberto pela triagem das tabelas fora do plano (FILA, Achado 20). Medido na PRODUÇÃO (Oracle RO).

**O status (`FLAGPROMOCAO`) — a leitura de julho estava errada.** É o combo `cbbStatus` (uCadAgendaPromocao.dfm:505-520):
`N` = ABERTA · `E` = EXECUTANDO · `J` = FECHADA. A produção bate: em 2025-26, E = as 6 agendas vigentes (todas com
`DATAEXECUCAO`), J = as 1.142 passadas, N = a 1 futura. Agenda nova nasce 'N' (udmCadAgendaPromocao.pas:359). A mig 080
tinha `DEFAULT 'J'` — **toda agenda criada no Apollo nascia FECHADA** — e a tela oferecia valores inventados (A/I/P).
- quem move o status no legado é um serviço fora do fonte (N→E na data, carimbando `DATAEXECUCAO`; E→J no fim). No
  Apollo é a **vigência** (`processar-vigencia`): N no período → aplica e vira E; E com o fim passado → desliga e vira J;
  N com o fim passado sem ter rodado → J (6 das 1.142 fechadas não têm DATAEXECUCAO). O status é o marcador (idempotente).
- à mão (cbbStatus): desabilitado enquanto ABERTA (:517); de E não vai a J nem de J a E (cbbStatusExit:1088) — sobra
  voltar a ABERTA. **Gravar uma agenda EXECUTANDO a devolve para ABERTA** (:757), e a vigência liga o preço de novo.
- `encerrar` (DTENCERRAMENTO, do binário novo — 1 uso na produção) passa a deixar a agenda FECHADA; `reabrir`, ABERTA.

**As lojas.** Quem decide em que loja o preço entra é a lista de CADA ITEM (`AGENDA_PROMOCAO_ITENS.EMPRESAS`, '1, 2'):
o `AtualizaAtivo` (:232) percorre a lista e o multi_preco segue ela em 106 de 108 agendas desde jun/2026. O form enche
todos os itens com a lista das empresas selecionadas ao incluir (`cdsAgendaPromocaoBeforeInsert` → `TrocarEmpresa`) —
nenhuma agenda de 2026 tem itens com listas diferentes. A `AGENDA_PROMOCAO_EMPRESA` (3.191, binário novo) é a mesma
lista para o app de gestão (`Controller.GestaoMobile.pas:10210` filtra por ela) — em 110 agendas de 2026 ela difere
da dos itens, e o preço seguiu os itens; é gravada junto.
- **a agenda é da REDE**: a pesquisa do legado (`GET_AGENDA_PROMOCAO`) não filtra loja — a dona (`CODEMPRESA`) é só quem
  criou. O agregado deixou de ser `empresaScoped` (a loja logada carimba a dona no create).
- lojas obrigatórias ("Selecione as Empresas participantes", :491) e existentes; ao gravar, os itens levam a lista.
- **aplicar** e a vigência ligam o preço em cada loja da lista do item; **encerrar** e o fim desligam em todas.
- **gravar sem uma loja**: ela perde o preço desta agenda (`IDEMPRESA NOT IN (EMPRESAS)`, :750); o item removido (trigger
  `CONTROLADELETEAGENDA`) e o desativado (`AtualizaAtivo(False)`) também.
- **sobreposição por loja** e só contra agenda ABERTA ou EXECUTANDO (`FLAGPROMOCAO IN ('N','E')`, `ProdutoOutraPromocao`:1586)
  — o Apollo comparava com toda agenda não encerrada da loja logada. ⚠️ o legado compara `EMPRESAS LIKE '%n%'` (a loja 1
  casaria com a 51): aqui é loja a loja; no dado de 2026 as listas são só '1', '2' e '1, 2', então não há diferença prática.

**Flags de mídia** do item: 'T'/'F' no legado (15.865 de 15.865 itens desde 2025 = 'F'); o schema do Apollo só aceitava
'S'/'N' — **editar pela web uma agenda carregada seria recusado**. Aceita os dois e grava 'T'/'F'.

**Tela:** lojas participantes, status fiel, **edição de agenda gravada** (não existia — só criar), marcar item como
ativo/inativo, colunas Lojas e Status na lista.

**Motor:** gancho genérico `aposGravarTrx` no master (efeitos do btnGravar no mesmo commit, mesmo sem itens no dto).

**Smoke** 76.10c-76.15: ciclo E/J da vigência · multi-loja (item '1, 2', agenda_promocao_empresa, 2 lojas aplicadas) ·
retirar loja (reverte só a loja 2; E→N; leitura [1]) · transições do status · sobreposição por loja e contra FECHADA ·
agenda da loja 2 visível na loja 1, loja inexistente 422, flags T/F.

**Continua adiado:** atualização por grupo de preço (`ATUALIZACAO_GRUPO`/`CODGRUPO`), opções obrigatórias
(`OpcoesAgendaPromocaoObrigatorio`), relatórios, clonar e etiquetas.
