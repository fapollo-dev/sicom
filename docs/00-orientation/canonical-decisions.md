# Decisões Canônicas (ADRs)

> Decisões **travadas** que saíram da análise de arquitetura. Agentes **obedecem** — não
> rediscutem. Para mudar uma decisão: adicione um ADR novo que **supersede** o antigo, com
> justificativa e data. Nunca edite silenciosamente uma decisão travada.

Formato: cada ADR tem **Decisão**, **Porquê**, **Implicação**.

---

## ADR-001 — Híbrido edge+nuvem por design (não é escolha do cliente)
- **Decisão:** Toda topologia é edge (loja) + nuvem. O caminho operacional/tempo-real (PDV, venda, balcão) roda **sempre local/edge**; o back-office/analítico (retaguarda, consolidação multi-loja, BI, fiscal central) roda na **nuvem**.
- **Porquê:** O PDV não pode cair quando a internet cair. Essa restrição física ancora tudo.
- **Implicação:** Costura limpa — tempo-real no edge, analítico na nuvem. Ver [../01-architecture/target-architecture.md](../01-architecture/target-architecture.md).

## ADR-002 — Um código, múltiplas topologias de deploy
- **Decisão:** Mesmo artefato (containers) roda na nuvem **ou** on-prem no cliente grande. **Proibido** fork "versão cloud" vs "versão on-prem".
- **Porquê:** Dois produtos = morte na manutenção.
- **Implicação:** Pequeno = SaaS puro; grande = nuvem dedicada **ou** on-prem, sob demanda, mas **sempre** edge+PDV local. Ver [../01-architecture/deployment-topologies.md](../01-architecture/deployment-topologies.md).

## ADR-003 — Banco por tenant (db-per-tenant)
- **Decisão:** Cada **cliente** (empresa) tem seu **próprio banco**. Filiais do mesmo cliente ficam **no mesmo banco** (multi-loja integrado). Clientes diferentes **nunca** se juntam.
- **Porquê:** Isolamento, backup/restore por cliente, **janela de upgrade independente**, mobilidade de tenant (levantar on-prem).
- **Implicação:** Filial ≠ tenant. Cliente = tenant. Ver [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md).

## ADR-004 — Pool no compute, silo no dado (900 bancos ≠ 900 servidores)
- **Decisão:** **Uma** frota de aplicação stateless serve todos os tenants, roteando por tenant. Os 900 bancos lógicos vivem numa **frota de dezenas de instâncias**: pequenos (5GB) empacotados muitos por instância; grandes (1TB) em **instância dedicada** + read replica.
- **Porquê:** Replicar a nuvem por cliente é o modelo on-prem disfarçado — caro e insustentável; mata o deploy único.
- **Implicação:** Roteamento de tenant seguro é componente crítico. Ver [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) e [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md).

## ADR-005 — Tiers por carga: API / Worker / Read-replica
- **Decisão:** Cargas pesadas (fechamento fiscal/SPED, relatório de mês, importações) **não** rodam na API interativa. Vão para um **worker tier** (fila BullMQ/Redis, assíncrono) e/ou **read replica**. Relatórios leem **rollups/materialized views** pré-agregados.
- **Porquê:** Cenário Y+B (dois clientes grandes processando pesado ao mesmo tempo) não pode degradar PDV/telas.
- **Implicação:** Escala horizontal + offload. Ver [../01-architecture/workload-tiers.md](../01-architecture/workload-tiers.md).

## ADR-006 — Monólito modular primeiro; microserviço só com motivo
- **Decisão:** NestJS como **monólito modular** (módulos de domínio com fronteiras claras), deployado em papéis (web/worker). Destacar um módulo como serviço **só** quando ele provar necessidade de escala/deploy independente.
- **Porquê:** As fronteiras do domínio ainda não são conhecidas (o dossiê as descobre). Microserviço prematuro = **monólito distribuído** (pior dos mundos) + custo operacional sem retorno.
- **Implicação:** Fronteira via módulo, não via rede. Ver [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md).

## ADR-007 — Leitura escala com read replica + rollups (não CQRS pesado)
- **Decisão:** Primário (escrita + leitura operacional) + **read replica** (replicação automática do Postgres, mesmo schema) para leitura pesada, + **tabelas de rollup/materialized views** para relatório. **Nada** de CQRS com modelo de leitura separado mantido por eventos — só se doer muito, e aí um data warehouse analítico.
- **Porquê:** "Banco de escrita + banco de leitura" no sentido CQRS é complexidade desnecessária agora.
- **Implicação:** Ver [../02-stack-and-standards/performance-playbook.md](../02-stack-and-standards/performance-playbook.md).

## ADR-008 — PDV offline-first em Electron
- **Decisão:** PDV é app **Electron** com banco local (SQLite/embedded), opera 100% offline para vender, sincroniza com o edge da loja quando o link volta. Electron também é a casca para superfícies de teclado-pesado (retaguarda power-user).
- **Porquê:** Devices USB/serial (impressora fiscal, balança, pinpad, gaveta) + offline + **controle total do teclado** (que o navegador não dá).
- **Implicação:** Mesma app React, duas cascas (browser p/ casual, Electron p/ pesado). Ver [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md).

## ADR-009 — Deploy zero-downtime + expand/contract + janela de versão
- **Decisão:** Deploy de **código** = rolling/blue-green, **sem downtime** (stateless permite). Mudança de **schema** = **expand/contract** (parallel change): só aditivo, backfill, e *contract* (remoção) num release posterior, depois que todos migraram. O código suporta uma **janela de 1 versão** (N e N-1), não todas para sempre. O contrato de **API/sync** é **backward-compatible** porque PDV/edge ficam offline ou pinados.
- **Porquê:** 900 bancos migram independentemente; nós e edges no campo ficam em versões diferentes ao mesmo tempo. Não existe mais "trocar todos os exes na mesma janela".
- **Implicação:** A maior mudança cultural. Ver [../05-migration-engineering/migrations-expand-contract.md](../05-migration-engineering/migrations-expand-contract.md) e [../05-migration-engineering/versioning-and-compatibility.md](../05-migration-engineering/versioning-and-compatibility.md).

## ADR-010 — UX de teclado é requisito de primeira classe (e o fiscal é pinável)
- **Decisão:** Taborder, **Enter-avança-campo**, F-keys e **mnemônicos `&` (Alt+letra sublinhado)** são replicados **idênticos** ao Delphi, via uma **camada de teclado própria** (não o `accesskey` do browser, inconsistente). Os mnemônicos são **extraídos do `.dfm`**. O módulo **fiscal é versionável/pinável independente** do resto.
- **Porquê:** A memória muscular do operador é o critério de aceite — perdê-la mata a adoção. A versão fiscal certificada às vezes é obrigatória.
- **Implicação:** Camada de teclado é fundação compartilhada construída uma vez. Ver [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md).

## ADR-011 — Oracle → PostgreSQL
- **Decisão:** O banco-alvo é **PostgreSQL**. PL/SQL, packages e tipos Oracle são migrados/reescritos.
- **Porquê:** Licenciamento Oracle na nuvem é proibitivo; Postgres é o padrão do alvo.
- **Implicação:** Sub-migração de peso (ver [../05-migration-engineering/oracle-to-postgres.md](../05-migration-engineering/oracle-to-postgres.md)). Colocar no radar **cedo**.

## ADR-012 — Toda tela passa por dossiê; todo código é revisado contra o legado
- **Decisão:** O **dossiê de tela** (seção 04) é a unidade de trabalho e o contrato de refatoração. Nenhuma tela é "concluída" sem dossiê + teste de paridade + revisão legado×novo.
- **Porquê:** É a materialização da tese "contexto é tudo".
- **Implicação:** Ver [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md).

## ADR-013 — Design System e DataScience são **forks limpos** (sem vínculo Apollo)
- **Decisão:** O design system do cliente é um **clone** do DS de referência com **rebrand verde→azul**; o DataScience/IA é um **port** — ambos com **toda referência à Apollo removida** antes de subir no git deles.
- **Porquê:** Reuso acelera, mas não pode vazar marca/dados/segredos da Apollo.
- **Implicação:** Checklist de "strip Apollo" obrigatório. Ver [../09-design-system-and-ai/](../09-design-system-and-ai/).

## ADR-014 — DS como submodule; agentes deferem ao pipeline do DS; autonomia em zonas
- **Decisão:** O Apollo DS (`@apollosg/design-system`) entra nos repos de app como **git submodule** (pinado). Todo trabalho de frontend/DS começa lendo `design-system/CLAUDE.md` + `.claude/rules/ds-standards.md`. Os agentes **deferem ao pipeline do próprio DS** (`ds-designer → GATE → ds-dev → ds-reviewer`) e à skill `crud-builder` (`/ds-create-crud`) para telas de tabela/CRUD. Autonomia em 3 zonas: 🟢 consumir/compor/gerar CRUD (sem parar) · 🟡 componente/token novo (o agente roda o pipeline; usuário só dá o "sim" da spec curta) · 🔴 push/publish/release/bump de submodule (só mantenedor).
- **Porquê:** O DS já traz governança própria (gates, `ds-reviewer`, hooks de lint/inventory). Reinventar = drift e atrito; remover gates = drift. A autonomia certa é **rodar o pipeline inteiro do DS sem parar a cada micro-passo**, com o gate barato de spec protegendo o tronco. Submodule dá aos agentes as regras/skills/source + versionamento controlado. Fronteira dura: **componente/token/visual = repo do DS; tela/página/fluxo = repo do app.**
- **Implicação:** Telas de tabela seguem o fluxo: dossiê → `/ds-create-crud` (entrevista alimentada pelo dossiê → blueprint GATE → gera no padrão DS) → fiação NestJS → paridade. Ver [../09-design-system-and-ai/ds-as-submodule.md](../09-design-system-and-ai/ds-as-submodule.md) e [../09-design-system-and-ai/ds-agent-workflow.md](../09-design-system-and-ai/ds-agent-workflow.md).
