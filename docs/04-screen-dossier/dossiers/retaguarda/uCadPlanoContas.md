# Dossiê de Tela — PLANO DE CONTAS (contábil) — `uCadPlanoContas`

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | corte-1 (cadastro + árvore + travas) ENTREGUE e verde, 2026-07-02. Recon 3 agentes; auditoria adversarial. Verde: api tsc 0 · api test 123 · smoke 241/0 · web tsc 0 · web test 25 · web build. |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `uCadPlanoContas.pas` (676) + `.dfm` (árvore `TdxDBTreeView`); `uCadContaContabil.pas` (542, editor modal); `uDMCadPlanoContas.pas` (377, SQL + `ValidaExclusao`); `uCadConfPlanoContas`/`uDMConfigPlanoContas` (máscara). `FuncoesApollo.pas` (GetMascara/GetNivel) **ausente no dump**. |
| **Golden** | Oracle PINHEIRAO: PLANO_CONTAS 11.024 · DIARIO 888.243 |

## 1. Modelo (Oracle real)
- **PLANO_CONTAS**: PK `CODPLANOCONTAS` (surrogate, sequence). Chave de negócio = **`CODIEXPANDIDO`** (máscara pontilhada única, ex.: `1.1.03.01.0002`) + `CODIREDUZIDO` (reduzido único). **`CLASSE`** CHAR(1): **T=sintética (78)** / **A=analítica lançável (10.946)** — *NÃO* `TIPO` (constante 'E'). **`NATUREZA`** NUMBER: 1 Ativo/2 Passivo/3 PL/4 Resultado/5 Compensação/9 Outras (grupo do balanço/DRE — **não D/C**; devedora/credora deriva da raiz). **`NIVEL`** (1–5). **`CODPAI`** = FK auto-referente (a árvore; NULL nas 3 raízes). `STATUS` 'A'. `INTEGRADO` S/N. `CODPARCEIRO` (fornecedor-como-conta). **Global por schema** (sem CODEMPRESA).
- **Árvore por CODPAI explícito** (não por prefixo), 5 níveis, 3 raízes (1 ATIVO, 2 PASSIVO, 3 RESULTADO). Sub-árvore ex.: `1 → 1.1 → 1.1.03 → 1.1.03.01 → 1.1.03.01.0002 (148 COMPRAS)`.
- **Máscara CONFIGURÁVEL** (`CONFIG_PLANO_CONTAS.NDIG_1..8`, por TIPO E/R), travada após a 1ª conta. `FuncoesApollo` (auto-código) não está no dump → **corte-2**.
- **Quem aponta p/ PLANO_CONTAS**: `DIARIO.CONTADEBITO/CONTACREDITO` (888k), `ITENS_INTEGRACAO_CONTABIL.CODCONTA_CONTABIL`, **`PLC.CODCONTABIL`** (ponte gerencial→formal; 72 órfãs = dado sujo), `PARCEIROS.CODCONTABIL_FOR` (10.660). **Correção**: `ARECEBER/APAGAR.CODCONTA → CONTAS_BANCARIAS`, não PLANO_CONTAS.

## 2. Tela legada (procedência)
`TfrmCadPlanoContas(TfrmCadMaster)` — **TREEVIEW read-only** (`uCadPlanoContas.pas:34`, KeyField CODPLANOCONTAS/ParentField CODPAI/RootValue Null) + **editor modal** `TfrmContaContabil` (`uCadContaContabil.pas`). Custom draw: sintéticas negrito, analíticas verde.

| Regra/validação | Procedência | Condição |
|---|---|---|
| Descrição obrigatória | `uCadContaContabil.pas:457` | barra Post |
| Código extenso obrigatório | `:465` | barra Post |
| Cód. extenso ÚNICO | `:500` | Locate CODIEXPANDIDO |
| Cód. reduzido ÚNICO (BD+cds, por TIPO) | `:473/:488` | — |
| **Código deve conter o PREFIXO do pai** | `:511-520` | `Pos(codPai, código)=0` → "incompatível com a estrutura da conta pai" |
| **Natureza obrigatória** | `:522-528` | combo ≠ -1 |
| **Não inserir filha em ANALÍTICA** | `uCadPlanoContas.pas:262-266` | pai `CLASSE='A'` → erro |
| **Classe derivada** (nível < últimoNível → T; senão A) | `:396-399` (combo ReadOnly) | vem da máscara-config (corte-2) |
| **NIVEL derivado** do código (nº de separadores) / do pai+1 | `:369-371` | — |

**Exclusão = DELETE FÍSICO** (sem INDR) com varredura recursiva da sub-árvore + **9 travas** (`ValidaExclusao`, `uDMCadPlanoContas.pas:211-375`): (1) IIC, (2) **DIÁRIO**, (3) LANCAMENTO_CONTABIL, (4) CONFIG_PLANO_CONTAS, (5) PARCEIROS.CODCONTABIL/_FOR, (6) FORMAS_PGTO, (7) CONTAS_BANCARIAS, (8) PDV, (9) **PLC**. + não excluir com filhos.

## 3. Monorepo hoje
`plano_contas` (035) = subset flat de ~15 contas p/ o DIÁRIO. Colunas: codplanocontas(PK), descricao, `tipo char(1)` (**rotulado errado 'A'**), classe varchar(20) (vazia), codpai (vazio), codparceiro, status. Sem view/CRUD/tela/sequence/hierarquia. Engine é **flat** → árvore no front (DS `DataTable` tree-data por codpai). ⚠️ Não confundir com **PLC** (gerencial, já CRUD backend `plc.crud.ts`; ponte `plc.codcontabil → plano_contas`).

## 4. Plano de cortes
- **Corte-1 (ESTE) — cadastro + árvore + travas:** migration enriquece `plano_contas` (`codiexpandido` único + `codireduzido` + **`classe` char(1) T/A** [corrige rótulo] + `natureza` + `nivel` + self-FK `codpai` + auditoria + sequence do PK) + view `get_plano_contas` + seed do ESQUELETO (3 raízes + sintéticas que parenteiam as 15 contas, máscara/natureza do golden) + RBAC `FRMCADPLANOCONTAS`. **Módulo vertical** (CRUD global): derivação `nivel` do código; validações (codiexpandido único + **prefixo-do-pai** + natureza obrigatória + **pai deve ser sintética T**); travas de exclusão (filhos/DIÁRIO/IIC/PLC/parceiros → bloqueia, sugere inativar via `status`). Front **árvore** (DataTable tree-data por codpai) + editor de conta. **Classe explícita** no corte-1 (a derivação por máscara-config é corte-2).
- **Corte-2 (adiado/registrado):** máscara configurável (`CONFIG_PLANO_CONTAS` NDIG_1..8) + auto-código (reconstruir `FuncoesApollo`), classe derivada da máscara, plano **referencial** (TIPO='R' + CODPLANOREFERENCIAL/SPED), demais travas de exclusão (LANCAMENTO_CONTABIL/CONFIG/FORMAS_PGTO/CONTAS_BANCARIAS/PDV), seed/importação completa (11k), reparent com reescrita de máscara da sub-árvore, contas default (CONFIG_PLANO_CONTAS For/Cli/Cxa/Bco).

## 4b. Auditoria do corte-1 (2026-07-02) — 2 ALTA corrigidas
- **[ALTA] Ciclo por descendente** — `atualizar` só barrava `pai==si`; setar `codpai` para um descendente criava ciclo (a self-FK não impede). Corrigido com `garantirSemCiclo` (sobe a cadeia de ancestrais do novo pai; se `id` aparecer → `CONTA_PAI_INVALIDO`). Smoke §34.4b.
- **[ALTA] Trava de exclusão por parceiro `varchar × integer` + `.catch` mascarante (falha-aberta)** — `parceiros.codcontabil/_for` são varchar; a comparação com int podia lançar e o `.catch(()=>undefined)` engolia → excluía conta em uso. Corrigido: coerção `String(id)` + **removido o `.catch`** de todas as travas (uma trava de exclusão falha-FECHADO).
- **[MÉDIA] `codireduzido` sem unicidade** — adicionada checagem `CONTA_REDUZIDO_DUPLICADO` (criar/atualizar). Smoke §34.4c.
- **[MÉDIA] flip classe A→T com movimento** — bloqueado (`CONTA_COM_MOVIMENTO`): sintética não recebe lançamento.
- **Melhoria intencional (registrada):** o prefixo-do-pai usa `startsWith(pai+'.')` (mais forte que o `Pos()` do legado, que aceitava substring em qualquer posição).
- **Aprovado sem achado:** sem regressão na NF (contabilização lê ids/strings, não afetada pelo ALTER); ordem seed×self-FK correta; backfill bate com o golden; multi-tenant (global/schema) correto; as 4 travas adiadas referenciam tabelas que **não existem** no monorepo (não são buracos).
- **Limite conhecido (corte-2):** `list()` teto 2000/5000 + ordenação textual da máscara — só afeta escala (11k); a árvore usa filler nodes p/ ancestrais ausentes.

## 5. Riscos
Código hierárquico com 3 representações (CODIEXPANDIDO/CODEXPINTEIRO/CODIREDUZIDO); reparentar reescreve máscara da sub-árvore (o legado NÃO propaga — só valida prefixo na inclusão); CODEXPINTEIRO não é único; escala 11k (maioria fornecedor-conta); dado sujo (72 pontes PLC órfãs); só **analítica (A)** recebe lançamento (validação a jusante no DIÁRIO/IIC).
