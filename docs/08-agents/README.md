# 08 — Agentes

> Quem faz a migração e como trabalham juntos: o **roster** de agentes (inputs/outputs e handoff via dossiê), o **ciclo de revisão** (fazer→revisar→legado×novo, com Revisor independente e portão de paridade) e as **ferramentas/MCPs** que sustentam decisões informadas por dado real. O fio condutor: **o dossiê é o contrato** e **verde só conta se exercita o caminho real.**

## Pré-requisitos de leitura

- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — a disciplina de contexto, o loop de trabalho e quando agir vs. perguntar.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — os 3 hábitos inegociáveis que estes agentes executam.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-012** (dossiê é a unidade de trabalho; código revisado contra o legado).

## Arquivos da seção

| Arquivo | Para quê |
|---------|----------|
| [roster.md](roster.md) | O roster: **Analista de Legado**, **Dossiê Writer**, **Backend Builder** (NestJS), **Frontend Builder** (React/teclado), **Migration Engineer** (Oracle→PG, expand/contract, sync), **QA/Playwright**, **DevOps**, **Revisor** (independente) e **Orquestrador**. Inputs/outputs de cada um, as seções que lê, e o **handoff via dossiê** (o contrato entre eles). |
| [review-loop.md](review-loop.md) | O ciclo **fazer→revisar→legado×novo** em detalhe. O Revisor é **independente** do autor; o que checa (regra preservada, paridade de SQL, teclado, efeitos colaterais, ADRs); o **portão de paridade**; quando reprovar/refazer; e a regra "verde só conta se exercita o caminho real". |
| [mcp-and-tools.md](mcp-and-tools.md) | As ferramentas: **MCP de Postgres** (inspecionar schema/volume/índices/cardinalidade, `EXPLAIN`/planos antes de decidir índice/partição — nunca no escuro), **Playwright** (teste estruturado, inclusive teclado), **captura de SQL em runtime**, uso responsável, e como os agentes os invocam. |

## Ordem de leitura sugerida

1. [roster.md](roster.md) — **quem** faz o quê e como passa o bastão.
2. [review-loop.md](review-loop.md) — **como** o trabalho é auditado e provado.
3. [mcp-and-tools.md](mcp-and-tools.md) — **com que** ferramentas se decide informado por dado real.

## As leis desta seção

1. **O dossiê é o contrato.** Cada agente escreve ou lê o dossiê ([../04-screen-dossier/](../04-screen-dossier/)); o handoff acontece por ele, não "no ar". Trava o handoff? Conserta-se o dossiê, não a conversa.
2. **Independência na revisão (ADR-012).** Quem **faz** uma tela **não** a **revisa**. O Revisor confere contra o **legado**, reprova com motivo rastreável, e **não conserta** (quem fez, refaz).
3. **Dois confrontos com o legado, não um.** O Revisor (etapa 2) pega a regra que nunca virou golden; o harness de paridade (etapa 3) pega o centavo que diverge. Os dois, sempre.
4. **Verde só conta se exercita o caminho real.** SQL real, condicional real, dispatch real, motor offline real. Mock no caminho de produção é falsa confiança — o portão de paridade barra.
5. **Nunca decida no escuro.** Índice, partição, empacotamento, reconstrução de SQL — medidos com o MCP de Postgres e provados com plano/resultado. A ferramenta informa; o harness prova.

## Como esta seção se encaixa

A seção 08 é a **camada operacional humana/agêntica** sobre todo o resto do playbook: o roster executa o processo do dossiê (04) lendo a análise do legado (03), construindo na stack (02) sob a arquitetura (01), migrando (05), provando em testes (06) e operando a infra (07). O ciclo de revisão e as ferramentas são o que garante que cada entrega respeita os ADRs (00) e prova paridade com o legado — não "parece igual", **é** igual.

## Ver também

- [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md) — o processo por tela que estes agentes percorrem (quem faz o quê, "concluída").
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — o harness de paridade (etapa 3) que o QA roda e o Revisor exige.
- [../03-legacy-analysis/](../03-legacy-analysis/) — o que o Analista de Legado lê e extrai para o dossiê.
- [../07-devops-infra/](../07-devops-infra/) — o que o DevOps opera (infra, CI/CD, banco, observabilidade).
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — a disciplina de contexto e o loop de trabalho.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-012 e os demais que todos obedecem.
