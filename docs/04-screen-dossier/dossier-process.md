# O Processo do Dossiê

> Como uma tela percorre o ciclo **Fazer → Revisar → Revisar legado×novo** até virar código com paridade provada. Quem faz o quê, quando uma tela está "concluída", como o dossiê alimenta backend/frontend/testes, e por que o dossiê é versionado junto do código. **Verde só conta se exercita o caminho real.**

## Pré-requisitos de leitura

- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — o loop fazer→revisar→legado×novo e a disciplina de contexto (uma tela = uma unidade).
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-012** (dossiê é a unidade de trabalho e o contrato de refatoração).
- [dossier-template.md](dossier-template.md) — o template que este processo preenche e fecha.
- [../08-agents/roster.md](../08-agents/roster.md) — os papéis citados aqui (analista de legado, dossiê writer, backend/frontend, QA, revisor, orquestrador).
- [../08-agents/review-loop.md](../08-agents/review-loop.md) — o ciclo de revisão independente.
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — o harness que produz o verde de paridade.

---

## Por que existe um processo (e não "só preencher o template")

O dossiê é a **materialização da tese** "contexto é tudo" (ADR-012). Sem processo, um template vira checklist preenchido na superfície — exatamente a armadilha que o Apollo combate. O processo garante três coisas: que o dossiê foi **construído da camada de baixo** (do `.pas`/`.dfm`/runtime, não da tela), que passou por **olhos independentes**, e que a implementação foi **provada igual ao legado**. Cada uma é uma etapa do loop.

---

## O loop aplicado por tela

```
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ TELA = uma unidade de trabalho (um TForm). Cabe no contexto; o ERP não.   │
   └──────────────────────────────────────────────────────────────────────────┘

   1. FAZER ───────────────────────► 2. REVISAR ──────────► 3. REVISAR LEGADO×NOVO
   (a) Analisar o legado              Revisor independente   Harness de paridade
       .pas/.dfm/datamodule/runtime   audita o dossiê E       (golden capturado)
   (b) Preencher o DOSSIÊ             o código contra o       roda os mesmos inputs
       (template, seções 1–10)        legado                  no legado e no novo
   (c) Implementar a partir                                   compara outputs
       do dossiê (back/front/test)              ▲                     │
            │                                   │                     │
            └───────────── reprovou? volta para FAZER ◄───────────────┘
```

O loop tem **dois** pontos de revisão contra o legado, não um: o **revisor** (etapa 2) confere o dossiê e o código contra o `.pas` original (achado faltando, regra mal lida), e o **harness** (etapa 3) prova comportamento idêntico rodando o caminho real. Os dois são necessários — revisor pega o que o teste não vê (regra não capturada como golden), o teste pega o que o revisor não vê (1 centavo de divergência num cálculo).

---

## Quem faz o quê

Papéis em [../08-agents/roster.md](../08-agents/roster.md). O mesmo agente **não** pode fazer e revisar a mesma tela (independência é a essência da etapa 2).

| Etapa | Quem | Entregável |
|---|---|---|
| **1a. Analisar legado** | Analista de Legado | Leitura do `.pas`/`.dfm`/datamodules + **captura de runtime** da SQL dinâmica e golden (seções 4, 9 do template). Ver [../03-legacy-analysis/](../03-legacy-analysis/). |
| **1b. Escrever dossiê** | Dossiê Writer (pode ser o próprio analista) | [dossier-template.md](dossier-template.md) preenchido, seções 1–10, com procedência por achado. |
| **1c. Implementar** | Backend + Frontend + QA | Endpoints/módulo NestJS, componente/rota React, testes de paridade — **derivados do dossiê**, não da tela. |
| **2. Revisar** | Revisor independente | Veredito do dossiê e do código contra o legado ([../08-agents/review-loop.md](../08-agents/review-loop.md)). |
| **3. Paridade** | QA + harness | Verde de paridade que exercita o caminho real ([../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)). |
| **Orquestração** | Orquestrador | Sequencia telas (ordem strangler, [../10-roadmap/phases.md](../10-roadmap/phases.md)), resolve dúvidas que contradizem ADR. |

> **Quando perguntar vs. agir** (de [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)): aja quando o legado já decide; escale ao orquestrador só quando falta uma regra que **não está no legado** (decisão de produto) ou o achado **contradiz um ADR**.

---

## Como o dossiê alimenta os três entregáveis

O dossiê **não** é documentação que se lê e arquiva — é a **fonte** de onde saem backend, frontend e testes. Cada seção tem um destino:

```
  DOSSIÊ (seção)                          ALIMENTA
  ─────────────────────────────────────────────────────────────────────────
  §4 Dados (SQL + caminhos)        ─────► Backend: repository/query builder (cada
                                          branch condicional = branch do builder);
                                          endpoints; DTOs.
  §5 Regras de negócio (porquê)    ─────► Backend: service (regra) + DTO/zod (validação).
                                          Testes: 1 caso por regra.
  §6 Efeitos + estado externo      ─────► Backend: tenant context, transação, audit/
                                          interceptor (triggers/escritas-fantasma).
  §2 UI + §8 Teclado               ─────► Frontend: componentes do DS, mapa de teclado
                                          (label="&…", ShortcutScope, useEnterAdvances).
  §9 Casos golden                  ─────► Testes: parity harness (data-driven) +
                                          Playwright (E2E e teclado).
  §10 Alvo + decisões offline      ─────► Tudo: a especificação de implementação;
                                          o que roda local no Electron (PDV).
```

A regra prática: **se um endpoint, validação, branch de query ou caso de teste não rastreia para uma linha do dossiê, ou o dossiê está incompleto, ou alguém implementou pela superfície.** O dossiê é o contrato de refatoração (ADR-012) — divergência entre código e dossiê é defeito de um dos dois.

> **Telas de tabela/CRUD (a maioria da retaguarda):** o §1c do frontend **não é manual** — passa pela skill **`crud-builder`** do DS (`/ds-create-crud`), com a **entrevista pré-preenchida pelo dossiê** (§4 dados → colunas/fonte, §5 regras → validações/filtros, §8 → taborder/atalhos, §9 → casos golden). É o caminho sancionado e à prova de drift. Detalhe em [../09-design-system-and-ai/ds-agent-workflow.md](../09-design-system-and-ai/ds-agent-workflow.md) (ADR-014).

---

## Quando uma tela está "concluída"

"Concluída" tem definição dura (ADR-012). Os três têm de estar verdes — **na ordem**:

1. **Dossiê completo** — checklist de fechamento do [dossier-template.md](dossier-template.md) todo marcado: seções 1–10 sem branco, SQL reconstruída com todos os caminhos e **confirmada em runtime**, regras com *porquê* e procedência, estado externo mapeado (triggers inclusas), mapa de teclado extraído do `.dfm`, golden cobrindo cada condicional/regra.
2. **Revisão aprovada** — revisor independente assinou dossiê e código contra o legado ([../08-agents/review-loop.md](../08-agents/review-loop.md)). Reprovou → volta para Fazer.
3. **Paridade verde (que exercita o caminho real)** — o harness rodou os golden, comparou legado×novo, bateu. Inclui o **fiscal** (1 centavo reprova) e o **teclado** (taborder, Enter, F-keys, mnemônicos via Playwright).

> Status de transição moram no cabeçalho do dossiê: `rascunho → em-revisão → paridade-verde → concluído`. Nenhuma tela pula etapa. "Parece igual" não é critério — **é** igual, provado.

---

## A regra de ouro: verde só conta se exercita o caminho real

> Um teste verde que **não toca a SQL real, a condicional real e o dispatch real** é **falsa confiança** ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md), anti-objetivos em [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md)).

Por que isto é uma regra e não um conselho: já mordeu em produção noutros sistemas — uma suíte verde que mockava o caminho assíncrono escondeu um no-op (a feature nasceu no caminho síncrono e ficou órfã no assíncrono, que era o caminho real de produção). A tradução para o Apollo:

- **A SQL real:** o teste de paridade roda contra o **branch de query que produção dispara** — não uma versão simplificada. Cada caminho condicional da §4 do dossiê é um golden próprio (§9).
- **A condicional real:** cada `if/case` que muda a SQL/regra tem seu caso. Cobrir só o "caminho feliz" deixa metade do legado não-testada.
- **O dispatch real:** se a tela tem caminho síncrono **e** assíncrono (ex.: salvar dispara fila/worker, ADR-005), **os dois** são exercitados. Uma feature que funciona no síncrono e some no assíncrono passa num eval cego.
- **No PDV/offline:** o golden fiscal roda **no motor que o caixa usa offline** (Electron), não só na API da nuvem — senão o verde não prova o caminho que produção executa (ADR-008, [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md)).

O harness ([../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)) é construído para tornar isso difícil de burlar: ele compara contra o **golden capturado do legado rodando**, então um teste que não exercita o caminho real simplesmente não tem golden para comparar.

---

## Versionar o dossiê junto do código

O dossiê **vive no mesmo repositório/PR** do código que ele gera, não num wiki à parte. Razões:

- **Rastreabilidade:** o `v<N>` no cabeçalho do dossiê casa com o commit/PR ([dossier-template.md](dossier-template.md) §0). Quem lê o diff do código lê a regra que o justifica.
- **Não apodrece:** mudou a regra (lei fiscal nova, decisão de produto)? O mesmo PR atualiza dossiê **e** código **e** golden — os três juntos, sempre. Dossiê que descola do código é pior que nenhum dossiê.
- **Revisão num lugar só:** o revisor (etapa 2) vê dossiê + código + teste no mesmo PR e audita a coerência entre eles.
- **Convivência com o legado (strangler):** enquanto a tela velha ainda roda ([../10-roadmap/phases.md](../10-roadmap/phases.md)), o dossiê é a ponte viva entre as duas — e a base do harness que prova que a nova substitui a velha sem perda.

> Localização sugerida: `04-screen-dossier/dossiers/<modulo>/<form>.md`, no mesmo repo do código-alvo (ou submódulo espelhado), referenciado pelo PR. Mudança em regra **canônica** descoberta no caminho ainda vai para [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) (externe o que descobriu).

---

## Erros comuns (anti-padrões deste processo)

- **Preencher o dossiê olhando a tela rodando** em vez do `.pas`/runtime — captura a superfície, perde a condicional escondida e o efeito-fantasma da trigger.
- **Marcar SQL dinâmica como certa sem runtime** — reconstrução por leitura estática é hipótese; sem `[runtime]` é risco aberto (§4 do template).
- **Pular a §6 (estado externo)** — a armadilha de acoplamento ([../03-legacy-analysis/hidden-coupling-traps.md](../03-legacy-analysis/hidden-coupling-traps.md)); é a causa nº1 de "funciona isolado, quebra integrado".
- **Mesmo agente faz e revisa** — mata a independência da etapa 2.
- **Verde sem caminho real** — a falsa confiança da regra de ouro acima.
- **Dossiê e código em repos diferentes** — descolam, o dossiê apodrece.

---

## Ver também

- [dossier-template.md](dossier-template.md) — o template que este processo preenche e fecha.
- [README.md](README.md) — índice da seção 04.
- [../08-agents/roster.md](../08-agents/roster.md) — os papéis citados.
- [../08-agents/review-loop.md](../08-agents/review-loop.md) — o ciclo de revisão independente (etapa 2).
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — o verde de paridade (etapa 3).
- [../06-testing-quality/testing-strategy.md](../06-testing-quality/testing-strategy.md) — como a cobertura deriva do dossiê.
- [../03-legacy-analysis/](../03-legacy-analysis/) — onde a etapa 1a (análise) é detalhada.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-012.
