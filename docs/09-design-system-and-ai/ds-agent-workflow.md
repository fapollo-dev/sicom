# Workflow do Agente com o Design System

> Como um agente da migração trabalha **com o Apollo DS em cada etapa, de forma correta** —
> o contrato de leitura, a skill `crud-builder` para telas de tabela/CRUD, e o modelo de
> **autonomia** que deixa o DS se auto-evoluir sem que os agentes travem a cada passo.

**Pré-requisitos de leitura:** [ds-as-submodule.md](ds-as-submodule.md) · [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) (ADR-014) · [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)

---

## 1. O contrato de entrada (obrigatório, toda vez)

Antes de **qualquer** trabalho de frontend/DS, o agente carrega a lei do DS — não a memória, não o palpite:

```
1. Ler  design-system/CLAUDE.md            → regras de comportamento + mapa de tarefas
2. Confirmar carga de  design-system/.claude/rules/ds-standards.md  (regras + 14 lições + anti-patterns)
3. Verificar  design-system/.ai/status/pipeline-state.md  → há tarefa PAUSADA ou cascata aberta?
4. Só então agir.
```

> É o equivalente, dentro do DS, à canon do Apollo (seção 00): **a lei do domínio vence a memória do agente.** Pular isso é como migrar uma tela sem dossiê — drift garantido.

A precedência de fonte do DS (anti-drift) é dura e os agentes obedecem:
```
1. types do componente (ex: data-table.types.ts) + exemplo canônico (.tsx)
2. USAGE.md do componente
3. snippets da skill
4. memória da IA  ← NUNCA confiar sozinha
```
Se duas fontes divergirem, **types + exemplo canônico vencem**.

---

## 2. A fronteira: trabalho de DS vs trabalho de App

Decida **onde** a tarefa mora antes de tocar em arquivo (ver [ds-as-submodule.md](ds-as-submodule.md)):

| Se a tarefa é… | Mundo | Onde edita | Pipeline |
|---|---|---|---|
| componente, token, ajuste visual, exemplo canônico | **DS** | dentro de `design-system/` (branch do DS) | `ds-designer → GATE → ds-dev → ds-reviewer` |
| tela, página, fluxo, CRUD real do ERP | **App** | `src/` do app, consumindo o DS | `app-designer → app-dev-react` (+ `crud-builder`) |

Errar a fronteira é o erro mais comum: criar uma tela dentro do DS, ou hackear um componente dentro do app. **Tela → app. Componente → DS.**

---

## 3. Telas de tabela/CRUD → skill `crud-builder` (o caminho padrão do ERP)

A retaguarda de um ERP é **majoritariamente tabela e CRUD**. Para essas telas existe um caminho sancionado e à prova de drift — a skill `crud-builder`, entry point `/ds-create-crud`. O agente **segue a skill à risca**: não inventa API de props, não gera de memória, não toca em disco antes do gate.

### Fluxo (3 estágios, carga incremental)

```
/ds-create-crud
   │
   ▼  1. ENTREVISTA   → fonte de dados, colunas, filtros, views, kanban, virtualização…
   │     (alimentada pelo DOSSIÊ — ver abaixo)        ZERO edição em disco
   ▼  2. BLUEPRINT [GATE]  → preview consolidado + pré-validações → aguarda "aprovar"
   ▼  3. GERAÇÃO     → lê exemplo canônico → cria página → registra → tsc → handoff
```

### O encaixe com o dossiê (a peça que falta na descrição padrão)

A entrevista do crud-builder **não parte do zero** — ela é **alimentada pelo dossiê da tela** (seção 04). O dossiê já tem o que a entrevista pergunta:

| Entrevista do crud-builder pede… | O dossiê já entregou… |
|---|---|
| fonte de dados, colunas | seção **Dados** (queries reconstruídas, tabelas, campos) |
| filtros, views | seção **Eventos** + **Regras de negócio** (condicionais da tela legada) |
| validações, edição inline | seção **Regras de negócio** |
| ordem de tabulação, atalhos | seção **TabOrder + mapa de atalhos** |
| casos de teste | seção **Casos de teste (golden)** |

Então o fluxo real ponta a ponta da migração de uma tela de tabela é:

```
tela legada (.pas/.dfm)
   → DOSSIÊ (seção 04: campos, regras, dados, golden)
   → /ds-create-crud  (entrevista pré-preenchida pelo dossiê → BLUEPRINT [GATE] → gera no padrão DS)
   → fiação ao endpoint NestJS (seção 02/05)
   → TESTE DE PARIDADE (seção 06: golden do legado × novo)
```

O dossiê de-risca o **"o quê"**; o crud-builder padroniza o **"como aparece"**; o service NestJS é o **"a lógica"**; a paridade prova que bate.

---

## 4. O modelo de autonomia (o coração: não travar, mas não driftar)

A premissa é: o DS vai se auto-evoluir rumo à Apollo — componentes e padrões novos vão nascer — e os agentes precisam de **autonomia pra criar**, senão param a cada falta. A solução **não** é remover gates; é entender que o DS **já tem um pipeline autônomo com revisor**, e que só **dois** freios são reais. Tudo o resto flui.

### 🟢 Zona verde — autonomia total, sem parar
O agente flui sem pedir permissão a cada passo:
- Consumir componentes do DS que **já existem** (`<DataTable>`, `<Button>`, …).
- Gerar telas de tabela/CRUD via `crud-builder` (o gate dela é o **blueprint**, uma aprovação rápida do usuário — barata, não um bloqueio).
- Compor páginas/fluxos do app a partir de componentes existentes (`app-designer → app-dev-react`).
- Editar visual de componente **existente** (só o `[nome].styles.ts`).

### 🟡 Zona amarela — autônomo, mas passa pelo gate embutido do DS
Quando a migração precisa de algo que **não existe** no DS (componente/token novo), o agente **não freelanca** — ele **roda o pipeline sancionado do DS**, que já tem o revisor como rede de segurança:

```
ds-designer (spec)  →  [GATE: aprovação rápida do usuário]  →  ds-dev (impl)  →  ds-reviewer (valida)
```

- O **GATE** é uma aprovação **rápida** de uma spec curta (igual ao blueprint do crud-builder) — é o que **protege o tronco central** de drift, não um bloqueio burocrático.
- O agente **conduz o pipeline inteiro** sozinho (designer→dev→reviewer); o único humano-no-loop é o "sim" da spec.
- Comandos de entrada: `/ds-create-component`, `/ds-create-composite`, `/ds-add-token`, `/ds-add-shadcn`, `/ds-extract-figma`.
- Os **hooks** do DS (`ds-lint-styles`, `ds-inventory-check`) e o `ds-reviewer` enforçam o tronco automaticamente — o agente cria com liberdade, e o sistema barra o que sair do padrão.

> É assim que "autonomia" e "não driftar" coexistem: o agente tem liberdade total **de processo** (rodar todo o pipeline), e o tronco é protegido por um gate barato + revisor automático — não por um humano aprovando cada linha.

### 🔴 Zona vermelha — nunca autônomo (decisão do mantenedor)
- `git push`, `npm publish`, **release**, bump de versão → **só o mantenedor (Leandro)**. O agente **para e pede**.
- Bump do ponteiro do submodule no app = também decisão deliberada (ver [ds-as-submodule.md](ds-as-submodule.md)).

| Zona | Exemplos | Quem decide |
|------|----------|-------------|
| 🟢 Verde | consumir componente, gerar CRUD, compor tela, editar styles existente | o agente, sozinho |
| 🟡 Amarela | componente/token NOVO | agente roda o pipeline; usuário só dá o "sim" da spec |
| 🔴 Vermelha | push, publish, release, bump de submodule | mantenedor |

---

## 5. O tronco central (invariantes que todo componente novo obedece)

A "auto-evolução rumo à Apollo" só fica saudável se o novo respeitar o tronco. Estes são inegociáveis (do `CLAUDE.md`/`ds-standards.md` do DS):

1. **Arquitetura de tokens em 3 tiers** — primitives (privado) → semantic (CSS vars) → component tokens. Componente **nunca** importa token direto; usa **classes geradas via `tv()`** (`*.styles.ts`).
2. **Zero hardcoded** — nada de `#fff`, `16px`, `0.875rem`. Cor/spacing/tipografia só via tokens.
3. **Prefixos de classe DS** — `gap-gp-*`, `p-sp-*`, `px-pad-*`, `rounded-radius-*`, `shadow-sh-*`, `min-h-form-*`, `size-icon-*` (nunca os literais Tailwind `gap-4`, `p-4`, `rounded-md`…).
4. **Inventory-first** — antes de criar, ler `.ai/context/components/inventory.md`; só criar se **comprovadamente ausente** (regra de self-interrupt do DS).
5. **Camada de teclado** ([../02-stack-and-standards/keyboard-ux-layer.md]) é parte do tronco — componente novo nasce navegável por teclado (taborder, foco, mnemônicos).
6. **Dark mode só em `color-dark.ts`**; após token, `npm run tokens:tw4`.

O `ds-reviewer` + hooks checam tudo isso. Um componente que viola o tronco **não passa** — é assim que o DS cresce sem deixar de ser o DS.

---

## 6. Resumo operável (o que colar no início)

- **Toda sessão de frontend:** ler `design-system/CLAUDE.md` + `.claude/rules/ds-standards.md` + checar `pipeline-state.md`.
- **Tela de tabela/CRUD:** `/ds-create-crud`, seguir a skill à risca, entrevista **alimentada pelo dossiê**, aprovar o blueprint, gerar.
- **Falta um componente:** rodar o pipeline do DS (`/ds-create-component` → spec → GATE rápido → dev → reviewer), dentro do submodule, numa branch do DS.
- **Nunca sozinho:** push, publish, release, bump de submodule.
- **Sempre no tronco:** tokens 3-tiers, `tv()`, zero hardcode, prefixos DS, inventory-first, teclado.

## Ver também
- [ds-as-submodule.md](ds-as-submodule.md) — o submodule, consumo e versionamento.
- [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md) — o dossiê que alimenta o crud-builder.
- [../08-agents/roster.md](../08-agents/roster.md) — os agentes da migração e o handoff via dossiê.
- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) — a camada de teclado (parte do tronco).
