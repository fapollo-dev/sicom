# 05 — Engenharia de Migração

> Como o Apollo sai do Oracle/Delphi e **fica de pé em movimento**: tirar o banco do Oracle e assentá-lo no PostgreSQL sem perder regra; evoluir o schema de **900 bancos** que migram cada um no seu tempo, **sem downtime**, via expand/contract; manter o contrato de API/sync **backward-compatible** porque PDV e edge ficam offline ou pinados; e o **protocolo de sync** que substitui o Horse, com idempotência, conflito = regra de negócio e contingência fiscal. Esta seção concretiza ADR-008, ADR-009, ADR-010 e ADR-011.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-008 (PDV offline-first, edge sucede o Horse), ADR-009 (zero-downtime, expand/contract, janela de versão), ADR-010 (fiscal pinável), ADR-011 (Oracle→Postgres).
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — "migre o que o sistema faz, não o que você vê"; o risco-coroa fiscal.
- [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) — db-per-tenant: cada cliente é um banco, migra na sua janela.
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — a face arquitetural do offline/sync que esta seção detalha no protocolo.

## Arquivos da seção

| Arquivo | Para quê | ADR |
|---------|----------|-----|
| [oracle-to-postgres.md](oracle-to-postgres.md) | Mapeamento de tipos (NUMBER/VARCHAR2/DATE/CLOB/BLOB), sequences, triggers, **PL/SQL → service OU pl/pgsql (caso a caso)**, packages, views. ETL, reconciliação (contagem/checksum/amostra), ferramentas (ora2pg, MCP de Postgres), cutover por tenant + dual-run. As armadilhas: NULL vs `''`, DATE com hora, unaccent/collation, arredondamento. | ADR-011 |
| [migrations-expand-contract.md](migrations-expand-contract.md) | **Arquivo-coroa.** Schema versionado **por tenant**; coexistência vN/vN+1 como fato de vida. Expand/contract passo a passo, **DDL online** (1TB sem travar), **migration runner** orquestrando os 900 bancos em lote/retomável, e o **exemplo completo**: renomear coluna que o PDV offline ainda usa sem quebrar 900 bancos nem PDVs pinados. | ADR-009 |
| [versioning-and-compatibility.md](versioning-and-compatibility.md) | Contrato de API/sync **backward-compatible** (só aditivo, nunca quebrar campo, depreciar devagar). Negociação de versão. **Módulo fiscal pinável independente.** Feature flags por tenant + canário. A mudança cultural: acabou o "trocar todos os exes na mesma janela". | ADR-009/010 |
| [sync-protocol.md](sync-protocol.md) | **Arquivo-coroa.** O protocolo edge↔nuvem que **substitui o Horse**: carga inicial (bootstrap), sync incremental (watermark/changelog), **conflito = regra de negócio** (não last-write-wins), **idempotência** (chaves, dedup, `ON CONFLICT`), ordenação, fila offline no PDV, reconciliação e **transmissão de contingência fiscal**. Com payloads JSON. | ADR-008 |

## Ordem de leitura sugerida

1. [oracle-to-postgres.md](oracle-to-postgres.md) — primeiro, **chegar** no Postgres com os dados certos.
2. [migrations-expand-contract.md](migrations-expand-contract.md) — depois, **evoluir** o schema sem downtime nos 900.
3. [versioning-and-compatibility.md](versioning-and-compatibility.md) — a face externa: o contrato que não pode quebrar quem está no campo.
4. [sync-protocol.md](sync-protocol.md) — o protocolo concreto que carrega tudo isso entre PDV, edge e nuvem.

## As leis desta seção

1. **Migre o que o sistema faz.** No Oracle, a regra mora em trigger/package/view — extraia-a (dossiê), não só o `CREATE TABLE`. PL/SQL de regra vai para o service testável; agregação pesada fica em pl/pgsql.
2. **Nunca destrua no lugar.** Rename/drop/mudança de tipo viram sempre **expand → backfill → [esperar todos] → contract**. O contract é um passo **ativo e agendado**, não um esquecimento.
3. **O lado novo garante a compatibilidade.** O PDV no campo está offline/pinado e não pode ser forçado a subir; o servidor fala com N e N-1, só aditivo, e aposenta o velho devagar.
4. **Conflito de sync é semântica, não timestamp.** Venda é imutável; preço é vigência; estoque é regra de baixa/entrada. Last-write-wins está errado.
5. **Idempotência é inegociável.** Identidade estável na origem + `ON CONFLICT` + ack/retry = reenvio nunca duplica (e nunca dupla-autoriza documento fiscal).
6. **Prove que nada se perdeu.** Cutover por tenant com dual-run e reconciliação (contagem/checksum/amostra) como **gate** de go-live.

## Como esta seção se encaixa

A seção 05 é a engenharia que transforma as decisões estruturais da [01-architecture](../01-architecture/) (edge+nuvem, db-per-tenant, offline-first) em **movimento seguro**: como sair do legado e como mudar o sistema **enquanto ele roda** para 900 clientes e milhares de PDVs em versões diferentes. Ela consome o **dossiê** ([../04-screen-dossier/](../04-screen-dossier/)) — de onde saem as regras escondidas em PL/SQL e as políticas de conflito reais do Delphi — e entrega para a [06-testing-quality](../06-testing-quality/) os pontos que o teste de paridade tem de provar (centavo no fiscal, idempotência no sync, reconciliação dos dados migrados). A esteira que executa tudo isso sem downtime — rolling/blue-green do código, canário, o runner de schema — vive na [07-devops-infra](../07-devops-infra/).

## Ver também

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — os ADRs que esta seção concretiza.
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — a face arquitetural do offline/sync.
- [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) — db-per-tenant, registry, particionamento do grande.
- [../04-screen-dossier/](../04-screen-dossier/) — de onde saem as regras e políticas de conflito reais.
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — paridade legado×novo (prova a lógica; a reconciliação prova os dados).
- [../07-devops-infra/ci-cd-zero-downtime.md](../07-devops-infra/ci-cd-zero-downtime.md) — o deploy zero-downtime do código que roda em N e N-1.
- [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) — MCP de Postgres para inspecionar schema/volume antes de decidir.
