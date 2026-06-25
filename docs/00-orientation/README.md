# 00 — Orientação (a canon)

> Esta é a camada canônica do Apollo. **Todo agente lê esta seção antes de qualquer tarefa.**
> Tudo nas seções 01–10 deve obedecer ao que está aqui. Se um arquivo de outra seção
> contradiz a canon, a canon vence (ou abre-se uma exceção registrada em
> [canonical-decisions.md](canonical-decisions.md)).

## Arquivos desta seção

| Arquivo | O que contém |
|---------|--------------|
| [mission-and-principles.md](mission-and-principles.md) | Missão, a tese "contexto é tudo", os 3 hábitos, critérios de sucesso, anti-objetivos, o risco-coroa (fiscal). |
| [canonical-decisions.md](canonical-decisions.md) | As decisões **travadas** (ADRs) que saíram da análise. Não rediscutir sem registro. |
| [how-agents-work.md](how-agents-work.md) | Disciplina de contexto, o loop fazer→revisar→legado×novo, uso de MCP/Playwright, convenções de output. |
| [glossary.md](glossary.md) | Vocabulário: Delphi, ERP-fiscal-BR, stack moderna. Cola para alinhar agentes. |

## Árvore completa do Apollo (1 linha por arquivo)

```
README.md ........................... porta de entrada, diretriz primária, índice
00-orientation/
  mission-and-principles.md ......... por que e como; tese de contexto; risco fiscal
  canonical-decisions.md ............ decisões travadas (ADR-000..)
  how-agents-work.md ................ loop de trabalho, contexto, MCP, output
  glossary.md ....................... vocabulário cruzado
01-architecture/
  target-architecture.md ............ 3 camadas: nuvem + edge de loja + PDV
  tenancy-and-data.md ............... db-por-tenant, empacotamento, tiers, 900 clientes
  deployment-topologies.md .......... um código, múltiplas topologias (cloud/on-prem/híbrido)
  workload-tiers.md ................. API / worker (fila) / read-replica
  offline-edge-sync.md .............. PDV offline, edge, carga e reconciliação
  heavy-days-thundering-herd.md ..... dias pesados (SPED no mesmo dia p/ todos)
02-stack-and-standards/
  tech-stack.md ..................... stack travada e versões
  backend-nestjs-standards.md ....... módulos, camadas, padrões NestJS
  frontend-react-standards.md ....... estrutura React/Vite, estado, data-fetching
  performance-playbook.md ........... paginação, índices, rollups, N+1, streaming
  keyboard-ux-layer.md .............. taborder, atalhos, mnemônicos &, Enter-avança-campo
03-legacy-analysis/
  delphi-anatomy.md ................. .dpr/.pas/.dfm/datamodules para agentes
  dynamic-sql-extraction.md ......... SQL espalhada e mutável: estático + runtime
  business-rule-extraction.md ....... extrair e documentar regra com profundidade
  hidden-coupling-traps.md .......... datamodules e estado global (acoplamento oculto)
04-screen-dossier/
  dossier-template.md ............... O template do dossiê (a unidade de trabalho)
  dossier-process.md ................ o processo do dossiê, do→revisar→legado×novo
05-migration-engineering/
  oracle-to-postgres.md ............. migração de dados e PL/SQL
  migrations-expand-contract.md ..... migrations sem downtime, versão por tenant
  versioning-and-compatibility.md ... janela de versão, contrato API/sync compatível
  sync-protocol.md .................. protocolo edge↔nuvem, conflito, idempotência
06-testing-quality/
  testing-strategy.md ............... pirâmide de testes, paridade legado×novo
  parity-harness.md ................. capturar golden do legado e comparar
  playwright-e2e.md ................. E2E estruturado, fluxos de teclado
07-devops-infra/
  infrastructure.md ................. topologia de infra, instâncias, rede
  ci-cd-zero-downtime.md ............ pipelines, rolling/blue-green, migration runner
  database-ops.md ................... backup, replica, empacotamento, failover, DR
  observability.md .................. logs, métricas, tracing, alertas, NOC por tenant
08-agents/
  roster.md ......................... os papéis de agente e o que cada um faz
  review-loop.md .................... o ciclo de revisão e revisão legado×novo
  mcp-and-tools.md .................. MCPs (Postgres p/ decisões de banco), Playwright
09-design-system-and-ai/
  design-system-rebrand.md .......... clonar DS verde→azul, remover vínculos iGreen
  ds-as-submodule.md ................ DS como git submodule, consumo e versionamento
  ds-agent-workflow.md .............. contrato, crud-builder, autonomia em 3 zonas
  datascience-port.md ............... port do DataScience/IA para o git deles
10-roadmap/
  phases.md ......................... fases strangler, ordem de módulos
  blind-spots.md .................... pontos cegos e riscos (fiscal, TEF, LGPD, ...)
```
