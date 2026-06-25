# Como os Agentes Trabalham

> Disciplina de trabalho para agentes (e humanos) no Apollo. Vale para **toda** tarefa.

## Disciplina de contexto (não estourar a janela)

Este é um projeto **gigante**. Carregar tudo é impossível e contraproducente. Regras:

1. **Carregue só a seção relevante.** Comece sempre pela canon (00). Depois abra **apenas** a seção da tarefa. Os índices (`README.md` de cada seção) existem para você escolher o arquivo certo sem ler a seção inteira.
2. **Siga os links, não copie.** Quando precisar de algo de outra seção, **referencie** (`[texto](../caminho.md)`) em vez de duplicar conteúdo. Duplicação apodrece.
3. **Trabalhe por dossiê.** A unidade de trabalho é **uma tela / um módulo**, não "o ERP". Um dossiê (seção 04) cabe no contexto; o ERP inteiro não.
4. **Externe o que descobriu.** Achou uma regra escondida, uma armadilha de estado global? Escreva no dossiê e, se for canônico, registre em [canonical-decisions.md](canonical-decisions.md). Contexto que não vira artefato se perde.

## O loop de trabalho: Fazer → Revisar → Revisar legado × novo

Todo entregável passa por este ciclo. Nunca pule etapas.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────────────┐
│  1. FAZER   │ ──> │  2. REVISAR  │ ──> │ 3. REVISAR LEGADO×NOVO  │
│  com dossiê │     │ agente revisor│     │  teste de paridade      │
│  + testes   │     │  independente │     │  (golden do legado)     │
└─────────────┘     └──────────────┘     └─────────────────────────┘
       ▲                                              │
       └──────────────── reprovou? volta ◄────────────┘
```

- **Fazer:** implemente a partir do dossiê (regra extraída, SQL reconstruída, casos de teste). Nunca a partir de "olhei a tela".
- **Revisar:** um **agente revisor** (diferente do autor) audita o artefato. Detalhe em [../08-agents/review-loop.md](../08-agents/review-loop.md).
- **Revisar legado × novo:** rode o **teste de paridade** — mesmos inputs no legado e no novo, compare outputs. Verde aqui é o único verde que vale (ver harness em [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)).

> **Regra de ouro do eval:** um teste verde que **não exercita o caminho real** (a SQL real, a condicional real, o dispatch real) é **falsa confiança**. Sempre confirme que o teste toca o caminho que produção toca.

## Quando agir vs. quando perguntar

- **Aja** quando a canon (00) já decide. Não rediscuta ADRs.
- **Aja** com o default sensato quando a escolha é convencional e reversível — registre a escolha no dossiê.
- **Pergunte** (ou escale ao orquestrador) só quando: falta uma regra de negócio que **não está no legado** (decisão de produto), ou quando o achado **contradiz** um ADR (pode exigir superseder).

## Uso de ferramentas e MCPs

- **MCP de Postgres / banco:** use para **decisões informadas por dados reais** — inspecionar schema, volume de tabela, índices existentes, cardinalidade, planos de query (`EXPLAIN`) antes de decidir particionamento/índice. Nunca decida estrutura de banco "no escuro". Detalhe em [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md).
- **Playwright:** todo teste de UI/fluxo é **estruturado** em Playwright — incluindo **fluxos de teclado** (taborder, F-keys, mnemônicos). Ver [../06-testing-quality/playwright-e2e.md](../06-testing-quality/playwright-e2e.md).
- **Captura de runtime:** para SQL dinâmica, ligue log de query e **exercite a tela** para capturar a verdade (ver [../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md)).

## Convenções de output dos arquivos

Todo arquivo `.md` de conteúdo segue:

1. **Título `#`** + **1 linha de propósito** (citação `>`).
2. **Pré-requisitos de leitura** quando houver (links para a canon/outros arquivos).
3. **Conteúdo denso, sem filler.** Exemplos concretos (código NestJS/React/TS, SQL, `.dfm`) onde ajudar.
4. **"Ver também"** ao final com links relativos.
5. **Português** na prosa; **inglês** em código, identificadores e termos técnicos canônicos.
6. Caminhos de arquivo como links markdown relativos (`[x](../y/z.md)`), nunca em backticks.

## Trabalhando com o Design System (DS)

Todo trabalho de frontend passa pelo **Apollo DS** (submodule). Regras canônicas (ADR-014, detalhe em [../09-design-system-and-ai/ds-agent-workflow.md](../09-design-system-and-ai/ds-agent-workflow.md)):

1. **Leia a lei do DS primeiro:** `design-system/CLAUDE.md` + `.claude/rules/ds-standards.md` + cheque `pipeline-state.md`. A lei do DS vence a memória do agente — igual à canon vence aqui.
2. **Fronteira dura:** componente/token/visual → repo do DS; **tela/página/fluxo → repo do app**. Não criar tela dentro do DS nem hackear componente dentro do app.
3. **Tela de tabela/CRUD → skill `crud-builder`** (`/ds-create-crud`), seguir à risca, **entrevista alimentada pelo dossiê** (seção 04), aprovar o blueprint, gerar.
4. **Autonomia em zonas** (não travar, não driftar): 🟢 consumir/compor/gerar CRUD (flui) · 🟡 componente/token novo → rodar o pipeline do DS (`ds-designer → GATE rápido → ds-dev → ds-reviewer`) · 🔴 push/publish/release/bump (mantenedor).
5. **Sempre no tronco:** tokens 3-tiers, `tv()`, zero hardcode, prefixos DS, inventory-first, teclado.

## Higiene de fork (DS e DataScience)

Ao clonar Design System ou DataScience da Apollo: rode o **checklist de strip Apollo** antes de
qualquer commit no git do cliente (marca, cores, nomes, tokens, URLs, dados, segredos). Detalhe em
[../09-design-system-and-ai/](../09-design-system-and-ai/).

## Ver também

- [mission-and-principles.md](mission-and-principles.md) — a tese e os critérios de sucesso.
- [canonical-decisions.md](canonical-decisions.md) — o que não rediscutir.
- [../08-agents/roster.md](../08-agents/roster.md) — quem faz o quê.
