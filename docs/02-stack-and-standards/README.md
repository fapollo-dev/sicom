# 02 — Stack & Padrões

> A stack travada do Apollo e os padrões de engenharia que materializam as decisões canônicas (ADR-006 monólito modular, ADR-007 read replica + rollups, ADR-008 Electron, ADR-010 teclado primeira classe). Carregue só o arquivo da sua tarefa.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — os ADRs que esta seção obedece.
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — disciplina de contexto e convenções de output.

## Arquivos da seção

| Arquivo | Para quê |
|---------|----------|
| [tech-stack.md](tech-stack.md) | Stack travada com versões e justificativa: NestJS, React+Vite+TS (uma app, duas cascas), PostgreSQL, Redis+BullMQ, Electron; query builder explícito (Kysely/Knex) vs ORM; UI headless (Radix/React Aria), grid teclado-first (AG Grid/TanStack), react-hook-form+zod, React Query, Playwright. Tabela resumo. |
| [backend-nestjs-standards.md](backend-nestjs-standards.md) | **ADR-006**: monólito modular (um módulo por domínio, fronteira via módulo); camadas controller/service/repository; DTOs+zod; **tenant context module** (request-scoped + connection por tenant); app sobe como web ou worker; **mapeamento SQL dinâmica do Delphi → query builder** lado a lado; tratamento de erro, pastas, nomenclatura. |
| [frontend-react-standards.md](frontend-react-standards.md) | Estrutura feature-based; React Query (server state); forms react-hook-form+zod; routing; **duas cascas (browser/Electron) com código único**; biblioteca de componentes sobre o design system; grid teclado-first; estado de cliente mínimo. |
| [performance-playbook.md](performance-playbook.md) | **ADR-007**: paginação keyset/cursor (não offset); índices decididos com EXPLAIN via MCP de Postgres; evitar N+1; rollups/materialized views incrementais; streaming de export; particionamento por loja/período; pooling; sem SELECT *; operações em lote; leitura pesada na read replica. |
| [keyboard-ux-layer.md](keyboard-ux-layer.md) | **ADR-010 (arquivo-coroa)**: a UX de teclado como fundação compartilhada — taborder, Enter-avança-campo, atalhos F-keys/Ctrl com escopo (e o caveat do browser que reserva teclas → **Electron resolve**), foco/focus-trap/roving tabindex, grid teclado-first, e os **mnemônicos `&` (Alt+letra sublinhada)** implementados na própria camada e **extraídos do `.dfm`**. |

## Ordem de leitura sugerida

1. [tech-stack.md](tech-stack.md) — o que usamos e por quê.
2. [backend-nestjs-standards.md](backend-nestjs-standards.md) / [frontend-react-standards.md](frontend-react-standards.md) — como estruturar cada lado.
3. [performance-playbook.md](performance-playbook.md) — como escalar a leitura/processamento.
4. [keyboard-ux-layer.md](keyboard-ux-layer.md) — a fundação de teclado que toda tela herda (leitura obrigatória para qualquer trabalho de UI).

## Ver também

- [../01-architecture/](../01-architecture/) — alvo edge+nuvem, tenancy, workload tiers.
- [../04-screen-dossier/](../04-screen-dossier/) — o dossiê captura o mapa de teclado e a SQL reconstruída.
- [../06-testing-quality/](../06-testing-quality/) — harness de paridade e Playwright (inclui fluxos de teclado).
- [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) — MCP de Postgres para decisões de banco informadas.
- [../09-design-system-and-ai/](../09-design-system-and-ai/) — design system (rebrand verde→azul, ADR-013).
