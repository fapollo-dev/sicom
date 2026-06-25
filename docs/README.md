# Apollo — Playbook de Migração ERP (Delphi → Web)

> **Apollo** é o codinome do projeto de migração de um ERP de supermercados escrito em
> Delphi (client-server, retaguarda + balcão + PDV) para uma plataforma web moderna
> (**NestJS + React/Vite + TypeScript + PostgreSQL**), com PDV offline em **Electron**.
>
> Este repositório **não é código** — é o **manual de operação** da migração. Foi escrito
> para ser consumido por **agentes de IA** (e humanos) em fatias pequenas, sem estourar
> contexto. Cada seção é autocontida e tem um índice.

---

## A diretriz primária (leia antes de tudo)

> **Contexto é tudo. Nada de superfície.** A regra de negócio de um ERP de 20+ anos está
> enterrada em código procedural, SQL dinâmica e estado global. O sucesso da operação **não**
> vem de reescrever telas bonitas — vem de **analisar → entender → documentar → refatorar →
> testar paridade** cada tela, sem negligenciar nenhuma camada. Toda tela vira um **dossiê**
> antes de virar código. Todo código novo é **revisado contra o legado**. Sempre.

Os três hábitos inegociáveis (detalhados em [00-orientation/how-agents-work.md](00-orientation/how-agents-work.md)):
1. **Fazer** — sempre com dossiê e teste de paridade.
2. **Revisar** — todo artefato passa por um agente revisor.
3. **Revisar legado × novo** — provar que o novo faz *exatamente* o que o velho fazia.

---

## Como navegar este playbook

Carregue **só a seção que importa** para a tarefa atual. Comece sempre pela seção 00.

| # | Seção | Para quê | Quem usa mais |
|---|-------|----------|---------------|
| 00 | [Orientação](00-orientation/) | Missão, decisões travadas, como agentes trabalham, glossário | **Todos, sempre** |
| 01 | [Arquitetura](01-architecture/) | Alvo edge+nuvem, tenancy, tiers, dias pesados (SPED) | Arquiteto, DevOps, Backend |
| 02 | [Stack & Padrões](02-stack-and-standards/) | Stack, padrões NestJS/React, performance, camada de teclado | Backend, Frontend |
| 03 | [Análise do Legado](03-legacy-analysis/) | Anatomia Delphi, extração de SQL dinâmica e regra de negócio | Analista de Legado |
| 04 | [Dossiê de Tela](04-screen-dossier/) | Template e processo de documentação tela-a-tela | Analista, Dossiê Writer |
| 05 | [Engenharia de Migração](05-migration-engineering/) | Oracle→Postgres, migrations expand/contract, versionamento, sync | Migration Engineer |
| 06 | [Testes & Qualidade](06-testing-quality/) | Estratégia de teste, harness de paridade, Playwright | QA |
| 07 | [DevOps & Infra](07-devops-infra/) | Infra, CI/CD zero-downtime, ops de banco, observabilidade | DevOps |
| 08 | [Agentes](08-agents/) | Roster de agentes, loop de revisão, uso de MCPs | Orquestrador |
| 09 | [Design System & IA](09-design-system-and-ai/) | Rebrand do DS (verde→azul), port do DataScience | Frontend, Data |
| 10 | [Roadmap](10-roadmap/) | Fases (strangler), pontos cegos e riscos | Liderança, todos |

> A árvore completa de arquivos com uma linha por arquivo está em
> [00-orientation/README.md](00-orientation/README.md).

---

## Ordem de leitura recomendada (onboarding de um agente novo)

1. [00-orientation/mission-and-principles.md](00-orientation/mission-and-principles.md) — por que e como.
2. [00-orientation/canonical-decisions.md](00-orientation/canonical-decisions.md) — o que já está **decidido** (não rediscutir).
3. [00-orientation/how-agents-work.md](00-orientation/how-agents-work.md) — o loop de trabalho e disciplina de contexto.
4. A seção específica da sua tarefa.

---

## Status

- **Fase atual:** 0 — fundação do playbook e preparação.
- **Próximo marco:** primeira tela-piloto migrada com dossiê + paridade verde (ver [10-roadmap/phases.md](10-roadmap/phases.md)).
- Este playbook é **vivo**: agentes atualizam os arquivos conforme aprendem. Mudança em decisão
  travada exige registro em [00-orientation/canonical-decisions.md](00-orientation/canonical-decisions.md).
