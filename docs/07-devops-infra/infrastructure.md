# Topologia de Infraestrutura

> A planta física do Apollo: a frota de aplicação stateless atrás de load balancer, a frota de worker, o Redis, as instâncias Postgres (pequenos empacotados, grandes dedicados, read replicas), CDN para o front, object storage fiscal com retenção legal de 5 anos, a rede com isolamento de tenant, a gestão de segredos, os **edge servers** geridos por frota, e a **automação de provisionamento de novo tenant** — a peça que torna 900+ clientes operável. Tudo **cloud-agnostic** por princípio.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-004** (pool no compute, silo no dado), **ADR-005** (tiers API/Worker/Replica), ADR-001 (edge+nuvem), ADR-002 (um código, vários alvos), ADR-003 (db-per-tenant).
- [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) — o roteamento de tenant e o empacotamento de bancos que esta topologia hospeda.
- [../01-architecture/workload-tiers.md](../01-architecture/workload-tiers.md) — os três papéis (API/Worker/Replica) que esta infra materializa.
- [../01-architecture/deployment-topologies.md](../01-architecture/deployment-topologies.md) — por que a mesma imagem roda em SaaS, dedicada e on-prem (ADR-002).

---

## O princípio que ancora a topologia (ADR-004)

> **Uma** frota de aplicação stateless serve **todos** os tenants, roteando por tenant. Os 900 bancos lógicos vivem numa **frota de dezenas de instâncias** Postgres, não em 900 servidores.

Duas dimensões independentes que a infra precisa respeitar sem confundir:

- **Compute = pool.** Réplicas stateless, intercambiáveis, escaláveis por taxa de request. Qualquer réplica atende qualquer tenant.
- **Dado = silo.** Cada cliente tem seu banco físico (ADR-003), mas muitos bancos compartilham uma instância. Empacotamento por porte ([../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md)).

A infra é o lugar onde essas duas dimensões viram máquinas, redes e configuração. O erro clássico — "900 bancos = 900 stacks" — é o modelo on-prem disfarçado: caro, insustentável, e mata o deploy único (ADR-002). A topologia abaixo existe para **não** cair nele.

---

## Diagrama da topologia (camada 1 — nuvem central)

```
                              INTERNET / clientes (browser, edge, PDV via edge)
                                                │
                                          ┌─────▼─────┐
                                          │    CDN    │  estáticos do front (Vite build),
                                          │  (front)  │  cache de borda, TLS terminado
                                          └─────┬─────┘
                                                │ (chamadas /api, /sync)
                                       ┌────────▼─────────┐
                                       │  LOAD BALANCER   │  L7, health checks, TLS,
                                       │   (ingress/ALB)  │  connection draining (zero-downtime)
                                       └───┬─────────┬────┘
                          roteia p/ papel  │         │
                ┌─────────────────────────▼──┐   ┌──▼───────────────────────────┐
                │  FROTA API (stateless)     │   │  FROTA WORKER (stateless)    │
                │  • N réplicas, autoscale   │   │  • consome fila BullMQ       │
                │    por RPS/latência        │   │  • SPED, relatório, import    │
                │  • resolve tenant→conexão  │   │  • escala no pico, desce      │
                │  • enfileira o pesado      │   │    depois (FinOps)            │
                └──────┬───────────┬─────────┘   └───────┬──────────────┬───────┘
                       │ pool/tenant│ add(job)            │ consome       │ pool/tenant
                       │            ▼                      ▼               │
                       │     ┌─────────────┐        ┌─────────────┐       │
                       │     │   REDIS     │◄───────│   REDIS     │       │
                       │     │ filas BullMQ│        │  (mesmo)    │       │
                       │     │ + cache +   │        └─────────────┘       │
                       │     │ rate-limit  │                              │
                       │     └─────────────┘                              │
                       ▼                                                  ▼
   ┌──────────────────────────────────┐         ┌───────────────────────────────────┐
   │ INSTÂNCIA PG-A (compartilhada)    │         │ INSTÂNCIA PG-D (dedicada — grande)│
   │  db_ze · db_market42 · db_emp07…  │         │  db_rede_xpto (~1 TB)             │
   │  (dezenas de bancos de ~5 GB)     │         │   └─► READ REPLICA (analítico/SPED)│
   └──────────────────────────────────┘         └───────────────────────────────────┘
                       │                                          │
                       └──────── backup/PITR/WAL ─────────────────┘  ([database-ops.md])

   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │ OBJECT STORAGE (XML/PDF fiscais, retenção legal 5 anos, WORM)   ·   SECRETS MGR    │
   │ TENANT REGISTRY (metadados central: tenantId→host/db/tier)     ·   PROVISIONER     │
   └──────────────────────────────────────────────────────────────────────────────────┘

   ── tudo dentro de uma VPC com sub-redes isoladas; o dado de tenant nunca cruza pública ──
```

> Repare: **edge e PDV não aparecem aqui** porque vivem na loja (camadas 2 e 3 — [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md)). Esta é a **camada 1**. Os edges são geridos por frota e descritos [mais abaixo](#frota-de-edge-servers-camada-2).

---

## Frota de aplicação (API) — stateless atrás do load balancer

A frota API é o tier interativo (ADR-005): telas de retaguarda, endpoints que o edge chama no sync, CRUD. Características de infra:

- **Stateless de verdade.** Nenhum estado de sessão na memória do nó (sessão em JWT + Redis; arquivo em object storage; pool de conexão derivado do tenant do request). Stateless é **o que permite** zero-downtime (ADR-009, [ci-cd-zero-downtime.md](ci-cd-zero-downtime.md)) e escala horizontal — qualquer réplica morre e sobe sem perda.
- **Atrás de um load balancer L7** com health check (`/healthz`, `/readyz`), connection draining e TLS terminado na borda. O LB distribui por **menor conexão/round-robin**, não por afinidade de tenant (qualquer réplica resolve qualquer tenant).
- **Autoscaling por RPS/latência**, não por CPU de batch — porque o pesado não roda aqui (ele enfileira). Métrica de scaling: requests por segundo e p95 de latência.
- **Pool de conexão por tenant** mantido em cada réplica (cache de pools — [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md)). Cada réplica abre poucas conexões por banco; um **PgBouncer** (ou pooler equivalente) à frente das instâncias Postgres evita explosão de conexões quando N réplicas × M tenants.

```
  900 tenants × N réplicas API  ──► sem pooler = explosão de conexões no Postgres
                                ──► com PgBouncer (transaction pooling) por instância PG = contido
```

## Frota de worker — o pesado, fora do caminho interativo

A frota worker (ADR-005) consome a fila do Redis (BullMQ) e roda o assíncrono: fechamento fiscal/SPED, relatório de mês, importação, recálculo de rollup. Infra:

- **Mesma imagem da API, papel diferente** (ADR-006 — monólito modular em papéis). Sobe com `ROLE=worker`; não escuta HTTP, consome fila.
- **Escala elástica e agendada.** Sobe réplicas no pico (dia do SPED — [../01-architecture/heavy-days-thundering-herd.md](../01-architecture/heavy-days-thundering-herd.md)) e desce depois. Pode rodar em **capacidade efêmera/spot** (job é idempotente e retryável), cortando custo do burst.
- **Lê da read replica + rollups**, escreve no primário só o resultado consolidado. Concorrência limitada **por tenant** (rate-limit no BullMQ) para um cliente grande não monopolizar a frota.

## Redis — fila, cache e rate-limit

Um cluster Redis (gerenciado ou auto-hospedado) cumpre três papéis, todos **operacionais, não fonte-da-verdade**:

| Papel | Uso | Nota de durabilidade |
|---|---|---|
| **Fila BullMQ** | jobs do worker tier (SPED, import, relatório) | persistência AOF; job idempotente sobrevive a restart |
| **Cache** | tenant registry resolvido, preço vigente, dados quentes | TTL curto; perda = recomputa, não corrompe |
| **Rate-limit / locks** | concorrência por tenant, lock de job único (`jobId` determinístico) | efêmero por natureza |

> Redis **não** guarda dado de negócio. Cai o Redis: a fila pausa e o cache esfria, mas nenhum dado fiscal/financeiro se perde — isso vive no Postgres e no object storage. Replicação + AOF para não perder a fila num restart.

---

## Instâncias Postgres — empacotamento por porte

A frota de dado segue o ADR-004: **dezenas** de instâncias, não 900. O empacotamento por tier (detalhe operacional em [database-ops.md](database-ops.md)):

| Tier | Instância | Read replica | Por quê |
|---|---|---|---|
| **Pequeno** (~5 GB) | **Muitos bancos por instância** compartilhada | Não (compartilha replica do pool se houver) | Custo marginal de mais um mercadinho é baixo |
| **Médio** (dezenas–centenas GB) | Poucos por instância, ou instância própria conforme carga | Opcional | Cresce → promove para dedicada |
| **Grande** (~1 TB) | **Instância dedicada** | **Sim, dedicada** | Não disputa I/O com 50 pequenos no dia do SPED; analítico não bate no primário (ADR-005/007) |

- **Read replicas** por replicação **automática** (streaming) do Postgres, mesmo schema (ADR-007). Relatório/SPED leem da replica; o primário fica livre para o OLTP do PDV.
- **Postgres gerenciado vs auto-hospedado:** ver a [nota cloud-agnostic abaixo](#cloud-agnostic-e-postgres-gerenciado). A topologia não muda; quem opera a instância muda.
- **Migração de tenant entre tiers** (um médio que virou grande ganha instância dedicada + replica) é **operação de ops** — mover o banco, repontar o registry — **não** mudança de código ([database-ops.md](database-ops.md), [../01-architecture/deployment-topologies.md](../01-architecture/deployment-topologies.md)).

---

## CDN para o front

O front é React/Vite — um **bundle estático** que não precisa do compute para servir:

- **Build artefato → object storage → CDN.** O `vite build` gera assets com hash; sobem para um bucket e a CDN os serve da borda, perto do usuário, com cache longo (imutável por hash) e `index.html` com cache curto.
- **A CDN não vê dado de tenant.** Serve só estático; toda chamada de dado vai para `/api` (load balancer → frota API), nunca para a CDN. Isolamento de dado preservado.
- **Versão pinável.** O `index.html` aponta para o bundle da versão N; o rollout escalonado do front é troca de qual `index.html` a borda serve (casável com feature flags — [ci-cd-zero-downtime.md](ci-cd-zero-downtime.md)).
- **Electron embute o bundle.** O PDV/superfícies pesadas (Electron) **empacotam** o front; a CDN serve o uso browser. Mesma app React, duas entregas (ADR-008).

---

## Object storage — documentos fiscais e retenção legal de 5 anos

O fiscal-BR exige guarda de **XML autorizado** (NFC-e/NF-e), DANFE/cupom PDF, arquivos SPED/EFD gerados, e logs de transmissão. Object storage (S3-compatível) é o lar disso:

- **Retenção legal de 5 anos.** A legislação fiscal exige guarda mínima (tipicamente 5 anos, conferir UF/tributo). O bucket tem **lifecycle policy** que **não apaga** dentro da janela legal e arquiva (storage frio) o que passou do quente.
- **Imutabilidade (WORM / object lock).** Documento fiscal autorizado **não se altera nem se apaga** dentro do prazo legal — `object-lock` em modo compliance impede deleção, inclusive por admin. É requisito de auditoria, não conveniência.
- **Particionado por tenant.** Prefixo `tenant=<id>/ano=<aaaa>/mes=<mm>/...` (ou bucket por tenant grande). O isolamento de dado vale também para o XML: o object storage respeita a fronteira de tenant ([rede e isolamento](#rede-vpc-e-isolamento-de-tenant)).
- **Versionado + criptografado em repouso.** SSE no bucket; chave gerida pelo secrets manager.

```
  object-storage/
    tenant=xpto/
      nfce/ano=2026/mes=06/  →  35200000…-nfce.xml   (object-lock compliance, 5 anos)
      sped/ano=2026/         →  EFD_2026_05.txt
      danfe/ano=2026/mes=06/ →  cupom-… .pdf
    tenant=ze/ … (nunca se cruza com xpto — prefixo + policy por tenant)
```

> O object storage é a **fonte da verdade do documento fiscal**, não o Postgres. O banco guarda o **metadado e o índice** (chave do objeto, status de autorização, protocolo SEFAZ); o XML/PDF mora no storage com object-lock. Isso desafoga o banco e cumpre a retenção legal de forma barata e auditável.

---

## Rede, VPC e isolamento de tenant

O isolamento entre clientes é **estrutural** (ADR-003: banco físico por cliente) — a rede reforça, não substitui:

- **VPC privada.** As instâncias Postgres, Redis e o tenant registry ficam em **sub-redes privadas**, sem rota para a internet. Só o load balancer e a CDN têm face pública. O dado de tenant **nunca** trafega em rede pública sem TLS.
- **Segmentação por papel.** Sub-rede da frota API/worker ≠ sub-rede de dados; security groups permitem só o necessário (API→PgBouncer→PG; worker→Redis/PG; nada de PG↔internet).
- **Isolamento de tenant é lógico no compute, físico no dado.** A frota é compartilhada (pool); o que garante "cliente A não lê dado de B" é o **roteamento request-scoped** (resolve tenant de fonte assinada — [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md)) **somado** ao banco separado. Duas camadas: um bug de service não vaza porque a conexão simplesmente não enxerga o dado do outro.
- **Edge↔nuvem por canal autenticado.** O edge fala com a camada 1 via mTLS/credencial de máquina; o `tenantId`+`storeId` saem do token do edge, nunca de parâmetro do cliente.
- **On-prem (ADR-002):** no cliente grande on-prem, a VPC vira a rede privada do datacenter dele; a topologia (sub-redes, segmentação) é a mesma, só o dono da rede muda.

---

## Gestão de segredos

Nenhum segredo no código ou na imagem (ADR-002: config externalizada). Um **secrets manager** (Vault, AWS/GCP Secrets Manager, ou equivalente) guarda:

| Segredo | Quem usa | Nota |
|---|---|---|
| Credenciais de banco (por instância/tenant) | API/worker ao abrir pool | rotação sem redeploy; least-privilege por papel |
| **Certificados fiscais A1** (por tenant) | motor fiscal (transmissão SEFAZ) | criptografado, escopo por tenant, auditado — risco-coroa |
| Chaves de object storage / SSE | upload de XML/DANFE | escopo por bucket/prefixo de tenant |
| `KNOWLEDGE`/tokens internos, HMAC de integrações | serviços | rotacionáveis |
| TLS / chaves de assinatura JWT | LB, auth | rotação programada |

- **Injeção em runtime**, não em build: o container lê o segredo do manager (ou de um volume montado) no boot, nunca de `ENV` hardcoded na imagem.
- **Certificado fiscal A1 por tenant** é o segredo mais sensível: assina documento fiscal. Escopo estrito por tenant, acesso auditado, e renovação automatizada (A1 vence em 1 ano) entra no [provisioner](#automação-de-provisionamento-de-novo-tenant) e em alertas de observabilidade ([observability.md](observability.md)).

---

## Frota de edge servers (camada 2)

O edge é o sucessor do Horse ([../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md)): conteinerizado, versionado, **na loja**. Em escala (centenas de lojas × 900 clientes), os edges **não** se gerenciam à mão — são uma **frota gerida**:

- **Conteinerizado.** O edge é a **mesma família de imagem** (ADR-002), rodando num **k3s** (Kubernetes leve) ou Docker no hardware da loja (pode ser o próprio PC do balcão no pequeno).
- **GitOps de frota.** Um plano de controle central (**Fleet/Rancher** sobre k3s, ou **Balena** para flotas de device) declara "qual versão do edge cada loja roda" e reconcilia. O rollout de edge é **escalonado e pinável** por loja/cliente (igual ao Electron — [ci-cd-zero-downtime.md](ci-cd-zero-downtime.md)): nunca empurra todo mundo de uma vez, e o **fiscal é pinável** independente (ADR-010).
- **Resiliente a link ruim.** O agente de frota tolera WAN intermitente: aplica o desired-state quando o link volta, nunca derruba a loja para atualizar. Atualização de edge **não** acontece no meio de operação crítica.
- **Observável de longe.** Cada edge reporta saúde, versão, lag de sync e fila de contingência para o NOC ([observability.md](observability.md)). 900 clientes × N lojas é uma frota; sem visão de frota, é cego.

```
  PLANO DE CONTROLE (nuvem)            FROTA DE EDGES (lojas)
  ┌───────────────────────┐  desired  ┌────────────┐ ┌────────────┐ ┌────────────┐
  │ Fleet/Rancher (k3s)   │──state──► │ edge loja01│ │ edge loja02│ │ … loja-N   │
  │  ou Balena            │           │ (k3s/docker│ │  pinável,  │ │ rollout    │
  │  versão por loja/cli  │◄─health── │  contêiner)│ │ escalonado │ │ escalonado │
  └───────────────────────┘  report   └────────────┘ └────────────┘ └────────────┘
                                            │ LAN
                                       PDVs Electron (camada 3) — offline-first
```

---

## Automação de provisionamento de novo tenant

Esta é a peça **essencial em escala 900+**: subir um cliente novo **não** pode ser um projeto manual. Um **provisioner** (job/serviço idempotente, disparado por API/ops) executa a sequência completa, ponta a ponta:

```
  PROVISIONAR TENANT (idempotente, auditado)
  1. Alocar slot de dado:
       tier=pequeno → escolher instância compartilhada com folga
       tier=grande  → provisionar instância dedicada + read replica
  2. CREATE DATABASE db_tenant_<id>  (na instância escolhida)
  3. Rodar migrations (schema base, na versão atual N)  ──► [ci-cd-zero-downtime.md]
  4. Seed inicial:
       parâmetros fiscais por UF, plano de contas base, perfis/permissões,
       numeração/série fiscal inicial, dados de referência (NCM/CFOP/CST)
  5. Registrar no TENANT REGISTRY: tenantId → host/instância/db/tier  ──► [tenancy-and-data.md]
  6. Provisionar SEGREDOS:
       credencial de banco do tenant (least-privilege),
       slot p/ certificado fiscal A1 (upload do cliente, criptografado)
  7. Provisionar OBJECT STORAGE: prefixo/bucket + lifecycle 5 anos + object-lock
  8. Credenciar EDGE(s) da(s) loja(s): token de máquina, endpoint da camada 1
  9. Smoke test: login → roteamento resolve → /healthz por tenant → 1 venda de teste
 10. Marcar tenant ATIVO no registry (antes disso, inacessível)
```

Propriedades não-negociáveis do provisioner:

- **Idempotente.** Reexecutar (falhou no passo 7) não duplica banco nem corrompe — cada passo verifica estado antes de agir. Mesma disciplina do sync e dos jobs (idempotência é tema transversal do Apollo).
- **Auditado.** Cada provisionamento gera trilha (quem, quando, qual instância, qual versão de schema) — base para o NOC e para reconstruir a frota.
- **Versionado por schema N.** O tenant nasce na versão atual; entra no fluxo expand/contract como qualquer outro ([ci-cd-zero-downtime.md](ci-cd-zero-downtime.md), [../05-migration-engineering/migrations-expand-contract.md](../05-migration-engineering/migrations-expand-contract.md)).
- **Reversível.** Provisionou errado? Há o caminho de desfazer (drop do banco recém-criado, limpar registry/secrets/storage) — antes de o tenant ficar ativo.
- **Decisão de tier informada por dado.** Em qual instância empacotar o pequeno? O provisioner consulta capacidade real (espaço, conexões, I/O) via **MCP de Postgres** ([../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md)) — não escolhe no escuro.

```ts
// provisioner/provision-tenant.ts — esqueleto idempotente (conceitual)
export async function provisionTenant(input: ProvisionInput): Promise<void> {
  const instance = await chooseInstance(input.tier);          // 1: capacidade real (MCP PG)
  await ensureDatabase(instance, dbName(input.tenantId));      // 2: CREATE DATABASE if not exists
  await runMigrations(instance, dbName(input.tenantId), 'N');  // 3: schema na versão atual
  await seedTenant(instance, input);                          // 4: fiscal/UF, perfis, séries, refs
  await registry.upsert(input.tenantId, {                     // 5: registry central
    host: instance.host, database: dbName(input.tenantId), tier: input.tier, active: false,
  });
  await secrets.provisionDbCredential(input.tenantId, instance); // 6a: least-privilege
  await secrets.reserveFiscalCertSlot(input.tenantId);           // 6b: A1 (upload do cliente)
  await objectStore.ensureTenantPrefix(input.tenantId, { retentionYears: 5, lock: 'compliance' }); // 7
  await edge.credentialStores(input.tenantId, input.stores);     // 8: tokens de máquina + endpoint
  await smokeTest(input.tenantId);                               // 9: caminho real, não mock
  await registry.activate(input.tenantId);                       // 10: só agora visível
}
```

> O provisioner é o que diferencia "operar 5 clientes" de "operar 900". Sem ele, cada go-live é artesanal e a operação não escala. Com ele, abrir um cliente novo é um botão — e o cutover por cliente ([../10-roadmap/phases.md](../10-roadmap/phases.md)) tem uma base repetível e auditável.

---

## Cloud-agnostic e Postgres gerenciado

Princípio de portabilidade (consequência do ADR-002 — um código, vários alvos, inclusive on-prem):

- **Abstrações portáveis, não APIs proprietárias na lógica.** Containers (OCI), Kubernetes/k3s, Postgres, Redis, S3-compatível, object storage com object-lock — todos têm implementação em qualquer nuvem **e** on-prem. Evite serviço proprietário **na trilha de domínio**; se usar um gerenciado (fila, secrets), faça atrás de uma interface trocável.
- **Diferença é config, não código.** O endpoint do banco, a URL do storage, o provedor de secrets entram por env/secret. Mover de uma nuvem para outra (ou para on-prem) é trocar valores e repontar, não reescrever ([../01-architecture/deployment-topologies.md](../01-architecture/deployment-topologies.md)).

> **Nota sobre Postgres gerenciado.** Um RDS/Cloud SQL/equivalente tira de cima backup, PITR, replicação e failover — atraente em escala. Mas: (a) **não pode ser a única opção**, porque o on-prem do cliente grande roda Postgres auto-hospedado — a operação tem de saber fazer os dois ([database-ops.md](database-ops.md)); (b) gerenciado às vezes **limita extensões/superuser** (relevante para particionamento, `unaccent`, tuning); (c) o empacotamento "muitos bancos por instância" (ADR-004) tem de caber no modelo de preço do gerenciado, senão vira "uma instância por banco" pela porta dos fundos. A decisão é por ambiente, **medida com dado** (volume, conexões, custo) via [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) — nunca no escuro.

---

## Ver também

- [ci-cd-zero-downtime.md](ci-cd-zero-downtime.md) — como o código sobe nessa infra sem downtime (rolling/blue-green, migration runner, Electron/edge update).
- [database-ops.md](database-ops.md) — operar as instâncias: empacotamento, replica, backup/PITR, DR, particionamento, retenção fiscal.
- [observability.md](observability.md) — enxergar essa frota (900 tenants + edges + PDVs): logs/métricas/tracing por tenant, sync lag, transmissão fiscal, NOC.
- [README.md](README.md) — índice da seção 07.
- [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) — roteamento de tenant e empacotamento de bancos que esta infra hospeda.
- [../01-architecture/deployment-topologies.md](../01-architecture/deployment-topologies.md) — a mesma imagem em SaaS/dedicada/on-prem (ADR-002).
- [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) — decidir tier/instância/particionamento informado por dado real.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-001/002/003/004/005.
