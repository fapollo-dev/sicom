# 01 — Arquitetura

> A arquitetura-alvo do Apollo: as 3 camadas, o modelo de tenancy, as topologias de deploy, os tiers de carga, o offline-first e o tratamento dos dias pesados.

## Arquivos da seção

- [target-architecture.md](target-architecture.md) — A arquitetura-alvo em 3 camadas (nuvem central multi-tenant, edge por loja, PDV por caixa) e a costura limpa tempo-real/analítico. ADR-001.
- [tenancy-and-data.md](tenancy-and-data.md) — db-per-tenant (cliente=tenant, filiais no mesmo banco), "pool no compute, silo no dado", tiers de dado e o roteamento de tenant no NestJS sem vazar dado. ADR-003/004.
- [deployment-topologies.md](deployment-topologies.md) — Um código, múltiplas topologias (SaaS puro → nuvem dedicada → on-prem), sempre edge+PDV local; proibição de fork cloud vs on-prem. ADR-002.
- [workload-tiers.md](workload-tiers.md) — Tiers API/Worker/Read-replica, o cenário Y+B (horizontal, fora da API, paralelo, isolado por tenant) e enfileiramento BullMQ. ADR-005/007.
- [offline-edge-sync.md](offline-edge-sync.md) — PDV offline-first, carga inicial, reconciliação idempotente, contingência fiscal como driver e conflito como regra de negócio. ADR-008.
- [heavy-days-thundering-herd.md](heavy-days-thundering-herd.md) — O thundering herd do SPED (mesmo prazo p/ todos) e as estratégias para achatar, espalhar, ordenar e suprir o pico, com FinOps.

## Como esta seção se encaixa

Esta seção materializa os ADRs estruturais da canon ([../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md)) em desenho concreto: ela responde **o que roda onde** e **por quê**. Tudo parte de uma restrição física — o PDV não pode cair quando a internet cai (ADR-001) — que ancora as 3 camadas, o offline-first e a separação tempo-real/analítico. Sobre essa base assentam o isolamento de clientes (db-per-tenant), a portabilidade de deploy (um código, vários alvos), a separação de cargas (API/Worker/Replica) e o tratamento dos picos correlacionados por lei (dia do SPED). As seções seguintes detalham a implementação: padrões de stack (02), análise do legado (03), o dossiê de tela (04), a engenharia de migração e o protocolo de sync (05), testes e paridade (06) e a operação de infra/banco (07).

## Ver também

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — os ADRs que esta seção concretiza.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — a tese central e o risco-coroa fiscal.
- [../05-migration-engineering/sync-protocol.md](../05-migration-engineering/sync-protocol.md) — o protocolo de sync que sucede o Horse.
- [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md) — operação de bancos, replicas e autoscaling.
