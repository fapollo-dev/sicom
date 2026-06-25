# O Ciclo de Revisão (Fazer → Revisar → Legado × Novo)

> O loop em detalhe: o agente **Revisor é independente** do autor, o que ele checa (regra preservada, paridade de SQL, teclado, efeitos colaterais, ADRs), o **portão de paridade**, quando reprovar/refazer, e a regra de ouro — **verde só conta se exercita o caminho real.** É a etapa 2 do loop que transforma "fiz" em "fiz certo, provado".

## Pré-requisitos de leitura

- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — o loop em três etapas e a regra de ouro do eval.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — os 3 hábitos inegociáveis e o anti-objetivo do verde cego.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-012** (toda tela passa por dossiê; todo código é revisado contra o legado).
- [roster.md](roster.md) — os papéis (autor vs. Revisor) e o handoff via dossiê.
- [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md) — o loop aplicado por tela e a definição de "concluída".
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — o harness que produz o verde de paridade (etapa 3).

---

## O loop, e por que tem DOIS pontos de revisão contra o legado

```
   ┌─────────────┐     ┌──────────────────┐     ┌──────────────────────────┐
   │  1. FAZER   │ ──► │  2. REVISAR      │ ──► │ 3. REVISAR LEGADO × NOVO │
   │  com dossiê │     │  Revisor         │     │  harness de paridade     │
   │  + testes   │     │  INDEPENDENTE    │     │  (golden do legado)      │
   └─────────────┘     └──────────────────┘     └──────────────────────────┘
         ▲                     │                            │
         └───── reprovou? volta ◄──────────────────────────┘
```

O loop tem **dois** confrontos com o legado, não um — e ambos são necessários porque pegam coisas diferentes:

- **Etapa 2 — o Revisor (humano-no-loop / agente independente):** lê o `.pas` original e confere se o dossiê e o código **dizem a mesma coisa que o legado**. Pega o que **o teste não vê**: uma regra que ninguém capturou como golden, uma condicional não enumerada, um efeito de trigger esquecido. O teste só verifica o que foi escrito como teste; o Revisor verifica o que **deveria** ter sido escrito.
- **Etapa 3 — o harness de paridade:** roda os mesmos inputs no legado e no novo e compara. Pega o que **o Revisor não vê**: 1 centavo de divergência num cálculo, uma ordenação sutil, um branch de SQL que parece certo mas retorna diferente.

> Um sem o outro é furo. Revisor sem paridade aprova código que "parece igual" mas diverge num centavo. Paridade sem Revisor fica verde cobrindo só o que alguém lembrou de testar — e a regra esquecida nunca vira vermelho porque nunca virou golden. **Os dois, sempre.**

---

## A independência é a essência (ADR-012)

> **O agente que FEZ a tela NÃO é o que a REVISA.** Independência não é formalidade — é o mecanismo.

Por que é inegociável:

- **Quem escreveu tem o ponto cego do autor.** Você revisa o código contra o **modelo mental que te fez escrevê-lo** — o mesmo modelo que, se estava errado, errou nos dois lugares. O autor relê e "confirma" o próprio engano. Outro agente chega **sem** esse modelo, lê o legado do zero, e enxerga a divergência.
- **O legado é o oráculo, não o autor.** O Revisor não pergunta "o código está elegante?"; pergunta "o código faz **o que o `.pas` faz**?". A referência é o velho sistema, que produção confia há 20 anos — não a opinião de quem implementou.
- **O Revisor não conserta.** Ele **reprova com motivo rastreável ao legado** e devolve ao autor. Se o Revisor consertasse, viraria coautor e perderia a independência na próxima revisão. Quem fez, refaz.

Consequência prática para o roster ([roster.md](roster.md)): o Orquestrador distribui de modo que autor ≠ revisor por tela; e o dossiê + código + teste estão **no mesmo PR**, para o Revisor auditar a coerência entre os três num lugar só.

---

## O que o Revisor checa (a lista dura)

O Revisor confronta **três coisas ao mesmo tempo**: o **legado** (`.pas`/`.dfm`/runtime), o **dossiê** e o **código/teste**. A divergência entre quaisquer dois é defeito.

### 1. Regra de negócio preservada (nenhuma condicional perdida)

- Cada validação, cálculo e condicional do `.pas` tem **lugar no código** (no service, não no controller, não na SQL) **e** um caso de teste.
- **Nenhuma condicional sumiu.** O Revisor relê o legado contando os `if/case` e confere que cada um tem branch correspondente no novo e um golden que o exercita. Cobrir só o "caminho feliz" é reprovação.
- O **porquê** está no dossiê (§5). Regra sem porquê é regra mal entendida — risco de ter copiado a forma sem a intenção.
- **Casos de borda** (zero, negativo, nulo, arredondamento, limite fiscal) estão capturados — é onde o legado guarda 20 anos de correções.

### 2. Paridade de SQL (o branch certo foi tomado)

- A SQL emitida pelo novo, **normalizada**, bate com a do golden capturado do legado em runtime ([../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md)).
- **Cada caminho condicional** da §4 do dossiê é um golden próprio — o `query builder implícito` do Delphi virou `.where()` encadeado **na mesma ordem e semântica** (incluindo `UPPER`/`LIKE`/acento/ordenação).
- Macro/concatenação que mudava **estrutura** virou **branch** (não param); param continuou param. Confundir os dois muda a SQL.
- A SQL foi **validada contra o banco real** (resultado == golden, `EXPLAIN` sadio) via MCP de Postgres ([mcp-and-tools.md](mcp-and-tools.md)).

### 3. Teclado (a memória muscular — critério de aceite, ADR-010)

- **Taborder** idêntico (ordem do DOM, nunca `tabindex` positivo); **Enter-avança-campo** onde o legado avança e **confirma** onde ele confirma.
- **Mnemônicos `&`** extraídos do `.dfm` (Alt+letra **aciona** ação / **foca** campo, conforme o papel), com sublinhado renderizado — **não** `accesskey` do browser.
- **F-keys/Ctrl** do `TActionList` replicados no escopo certo; a casca (Electron vs browser) é a correta para as teclas que o browser reserva.
- Há **teste Playwright** que prova o fluxo de teclado ([../06-testing-quality/playwright-e2e.md](../06-testing-quality/playwright-e2e.md)). "Modernizar" atalho é anti-objetivo — reprova.

### 4. Efeitos colaterais e estado externo (a armadilha de acoplamento)

- **Triggers / escritas-fantasma:** o que a tela grava **indiretamente** (trigger insere em outra tabela, consome sequence, gera documento) está mapeado no dossiê (§6) e coberto por golden de **efeitos** ([../03-legacy-analysis/hidden-coupling-traps.md](../03-legacy-analysis/hidden-coupling-traps.md)).
- **Estado global do datamodule:** a condicional que dependia de uma global setada por **outra** tela (`EmpresaAtual`) virou dependência **explícita** — não um singleton mutável escondido. É a causa nº1 de "funciona isolado, quebra integrado".
- **Fronteira de tenant:** o acesso a dados passa pelo contexto request-scoped; nada escolhe banco "na mão" ([../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md)).
- **Caminho assíncrono:** se salvar dispara fila/worker, o efeito ao final do dispatch foi verificado — não só o handler síncrono.

### 5. Aderência aos ADRs

- Regra **no service** (não no controller/SQL); leitura pesada no **worker/replica** (ADR-005), não na API; **db-per-tenant** respeitado; **expand/contract** se mexeu em schema (ADR-009); **offline/Electron** correto se é PDV (ADR-008).
- Nenhuma decisão travada foi **rediscutida em silêncio**. Se o achado **contradiz** um ADR, isso **escala ao Orquestrador** (vira proposta de ADR que supersede) — não se "resolve" localmente.

### 6. O portão de paridade (etapa 3, que o Revisor exige antes de aprovar)

- O harness rodou os golden, comparou **outputs + SQL + efeitos**, e **bateu** — incluindo o **fiscal** (tolerância **zero**: 1 centavo reprova) e o golden fiscal rodando no **motor offline** que o PDV usa.
- A cobertura **deriva do dossiê** (um golden por condicional/regra), não de % de linha.
- E — o coração — o verde **exercita o caminho real**.

---

## O portão de paridade e a regra "verde só conta se exercita o caminho real"

> Um teste verde que **não toca a SQL real, a condicional real e o dispatch real** é **falsa confiança** ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)). O portão de paridade existe para que isso **não passe**.

O Revisor não aceita "está verde" no atacado. Ele confirma que o verde é **honesto**:

- **SQL real:** a comparação inclui a SQL emitida (`compareSql`). Se o novo não emitiu a query equivalente à do golden, **reprova** — mesmo que o output "por acaso" bata. Um mock de repository não tem SQL para comparar → não passa o portão.
- **Condicional real:** **um golden por branch** (§4 do dossiê). Branch sem golden é **lacuna de cobertura** que o Revisor acusa — não "verde".
- **Dispatch real:** caminho assíncrono (fila/worker, ADR-005) é exercitado **através** do dispatch, com verificação do efeito ao final — não chamando o handler direto e pulando a fila. (Lição cara importada de outros sistemas: feature que vive no síncrono e some no assíncrono **passa** num eval cego. Aqui não, porque o caso roda o dispatch que produção roda.)
- **Banco real / motor offline real:** integração contra **Postgres real** (não in-memory que diverge em trigger/dialeto/ordenação); golden fiscal/PDV no **motor offline** do Electron (ADR-008).

O teste de fumaça do próprio portão: **mute uma linha de regra no novo e confirme que algum caso fica vermelho.** Se nada quebra, a suíte é falsa confiança — conserta-se a suíte **antes** de confiar no verde (mutation testing dirigido ao dossiê). O Revisor pode exigir essa prova.

---

## Quando reprovar / refazer

O Revisor **reprova** (volta para Fazer, etapa 1) quando:

| Achado | Por quê reprova |
|---|---|
| Condicional do `.pas` **sem** branch/golden no novo | regra perdida — o pior tipo de falha (paridade silenciosamente quebrada) |
| SQL diverge da do golden (estrutura/ordem/semântica) | branch errado tomado; resultado pode diferir nos dados que o caminho feliz não cobre |
| Divergência fiscal/financeira (≥ 1 centavo) | tolerância é **zero**; 20 anos de confiança do legado não se quebram por arredondamento |
| Teclado diferente do `.dfm` (taborder/mnemônico/F-key/casca) | quebra a memória muscular — critério de aceite (ADR-010) |
| Efeito de trigger / escrita-fantasma **não** mapeado | "funciona isolado, quebra integrado" — a armadilha de acoplamento |
| Estado global virou singleton mutável escondido (não dependência explícita) | acoplamento oculto reintroduzido |
| Verde que **não exercita o caminho real** (mock no caminho que produção usa) | falsa confiança — o portão de paridade barra |
| Decisão que **contradiz um ADR** resolvida localmente | ADR travado não se rediscute em silêncio → escalar ao Orquestrador |
| Dossiê e código **divergem** entre si | o dossiê é o contrato (ADR-012); um dos dois está errado |

Como reprova:

- **Motivo rastreável ao legado.** "Reprovado" sem apontar *qual linha do `.pas`* o novo violou não ajuda o autor. O veredito cita o legado/dossiê/golden específico.
- **Devolve ao autor.** O Revisor **não conserta** (perderia independência). O autor refaz, e o ciclo recomeça — **mesmo Revisor** revalida o ponto que reprovou.
- **Reprova cedo é barato.** Pegar a condicional perdida na etapa 2 custa um refazer; pegá-la em produção custa um incidente fiscal. O loop existe para mover o custo para a esquerda.

---

## Quando aprovar (a definição de "concluída")

Aprova-se uma tela quando os três estão verdes **na ordem** ([../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md)):

1. **Dossiê completo** — §1..§10 sem branco, SQL com todos os caminhos **confirmados em runtime**, regras com porquê e procedência, estado externo mapeado, mapa de teclado extraído do `.dfm`, golden por condicional/regra.
2. **Revisão aprovada** — o Revisor independente assinou dossiê + código contra o legado (esta página).
3. **Paridade verde que exercita o caminho real** — harness bateu (incl. fiscal a 1 centavo e teclado em Playwright).

> Status no cabeçalho do dossiê: `rascunho → em-revisão → paridade-verde → concluído`. Nenhuma tela pula etapa. **"Parece igual" não é critério — é igual, provado.**

---

## Ver também

- [roster.md](roster.md) — os papéis (autor vs. Revisor independente) e o handoff via dossiê.
- [mcp-and-tools.md](mcp-and-tools.md) — MCP de Postgres (validar SQL/plano) e Playwright (teclado) que sustentam a revisão.
- [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md) — o loop por tela e a "concluída" em definição dura.
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — o harness que produz o verde de paridade (etapa 3).
- [../03-legacy-analysis/hidden-coupling-traps.md](../03-legacy-analysis/hidden-coupling-traps.md) — os efeitos colaterais/estado externo que o Revisor caça.
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — o loop e a regra de ouro do eval.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-012.
