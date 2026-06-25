# 07 — DevOps & Infra

> Como o Apollo **roda, sobe e se mantém de pé** em escala 900+: a topologia de infra (frota stateless, instâncias Postgres empacotadas, edges geridos por frota), o CI/CD sem downtime (rolling/blue-green + migration runner expand/contract + Electron/edge update escalonado), a operação de banco por tenant (backup/PITR, DR, retenção fiscal, particionamento) e a observabilidade por tenant/edge/PDV. Decisões de estrutura **nunca no escuro** — medidas com o MCP de Postgres.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-004** (pool no compute, silo no dado), **ADR-005** (tiers), **ADR-009** (zero-downtime + expand/contract), ADR-001/002/003/008/010.
- [../01-architecture/](../01-architecture/) — a arquitetura que esta seção operacionaliza (tenancy, tiers, dias pesados, offline/sync, topologias).

## Arquivos da seção

| Arquivo | Para quê |
|---------|----------|
| [infrastructure.md](infrastructure.md) | A topologia: frota API/worker stateless atrás de load balancer, Redis (fila/cache/rate-limit), instâncias Postgres (pequenos empacotados, grandes dedicados, read replicas), CDN do front, object storage fiscal (WORM, retenção 5 anos), VPC/isolamento de tenant, secrets, **frota de edge** (k3s+Fleet/Rancher ou Balena) e a **automação de provisionamento de novo tenant** (criar banco, seed, registry, certificado fiscal). Cloud-agnostic + nota sobre Postgres gerenciado. Diagrama ASCII. |
| [ci-cd-zero-downtime.md](ci-cd-zero-downtime.md) | **ADR-009.** Pipeline com gate de paridade/teclado; deploy rolling/blue-green (health check, connection draining, graceful shutdown — o stateless permite); o **migration runner** (expand/contract nos 900 bancos, em lote, staggered); **Electron auto-update** (rollout escalonado, nunca no meio de venda, pin por cliente, fiscal pinável); feature flags; rollback. A regra: **fix de código = 1 rolling deploy conserta os 900 juntos; o que orquestra é a migration de schema.** |
| [database-ops.md](database-ops.md) | Ops de db-per-tenant: empacotamento por porte, read replicas, **backup por tenant + PITR**, DR com RPO/RTO, retenção fiscal de 5 anos, particionamento dos grandes (loja/período), capacidade para o pico de SPED, monitoramento por tenant. Toda decisão estrutural medida com o **MCP de Postgres**. |
| [observability.md](observability.md) | Logs/métricas/tracing **por tenant**; **sync lag** (edge/PDV); **transmissão fiscal** (NFC-e/contingência/backlog/certificado); alertas acionáveis; a visão **NOC** cobrindo 900 tenants + edges + PDVs; SLOs (incl. fiscal e dia pesado como prazo legal). Exemplos de métrica e alerta. |

## Ordem de leitura sugerida

1. [infrastructure.md](infrastructure.md) — **onde** tudo roda (a planta física).
2. [ci-cd-zero-downtime.md](ci-cd-zero-downtime.md) — **como** o código sobe sem derrubar ninguém.
3. [database-ops.md](database-ops.md) — **como** os 900 bancos são operados e protegidos.
4. [observability.md](observability.md) — **como** se enxerga a frota inteira e se reage a tempo.

## As leis desta seção

1. **Pool no compute, silo no dado (ADR-004).** Uma frota stateless serve todos; dezenas de instâncias hospedam os 900 bancos. Nunca 900 stacks.
2. **Zero-downtime é consequência do stateless (ADR-009).** Rolling/blue-green com health/drain/graceful. O que exige orquestração não é o código — é a **migration de schema** (expand/contract), porque toca 900 bancos com N e N-1 convivendo.
3. **Tudo é por tenant.** Backup, restore, DR, particionamento, log, métrica, alerta — a dimensão é o tenant (e a loja, e o caixa). Blast radius de um incidente de dado é **um** cliente.
4. **O fiscal é o risco-coroa, inclusive em ops.** Object storage imutável (5 anos), transmissão fiscal monitorada (contingência/backlog/A1), módulo fiscal pinável no update. O prazo fiscal é lei, não conforto.
5. **Nunca no escuro.** Índice, partição, empacotamento, promoção de tier — medidos com o **MCP de Postgres** ([../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md)) e provados com `EXPLAIN`/plano.
6. **Escala 900+ exige automação.** Provisionar tenant, migrar 900 bancos, atualizar edges/PDVs — tudo idempotente, em lote, auditado. O manual não escala.

## Ver também

- [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) — o modelo db-per-tenant e empacotamento que esta seção opera.
- [../01-architecture/workload-tiers.md](../01-architecture/workload-tiers.md) — os tiers API/Worker/Replica que a infra materializa.
- [../01-architecture/heavy-days-thundering-herd.md](../01-architecture/heavy-days-thundering-herd.md) — o pico de SPED que dimensiona capacidade e SLOs.
- [../05-migration-engineering/migrations-expand-contract.md](../05-migration-engineering/migrations-expand-contract.md) — o padrão que o migration runner aplica.
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — o gate de paridade que o pipeline exige.
- [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) — o MCP de Postgres que sustenta as decisões de infra.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — os ADRs que esta seção concretiza.
