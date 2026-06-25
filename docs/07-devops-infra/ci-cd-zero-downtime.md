# CI/CD & Deploy sem Downtime — ADR-009

> Como o código sobe sem derrubar ninguém: pipeline de build/test, deploy **rolling/blue-green** (health check, connection draining, graceful shutdown — o stateless é o que permite), o **migration runner** que roda migrations nos 900 bancos em lote com segurança **expand/contract**, o **Electron auto-update** (rollout escalonado, nunca no meio de uma venda, pin por cliente), feature flags e rollback. A distinção que organiza tudo: **fix de código = 1 rolling deploy conserta os 900 juntos; o que exige orquestração é a migration de schema.**

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-009** (zero-downtime + expand/contract + janela de 1 versão), ADR-004 (stateless), ADR-010 (fiscal pinável), ADR-008 (Electron).
- [../05-migration-engineering/migrations-expand-contract.md](../05-migration-engineering/migrations-expand-contract.md) — o padrão expand/contract (parallel change) que o migration runner aplica nos 900 bancos.
- [infrastructure.md](infrastructure.md) — a frota stateless, o load balancer e a frota de edge que este deploy alvo.
- [../05-migration-engineering/versioning-and-compatibility.md](../05-migration-engineering/versioning-and-compatibility.md) — o contrato N/N-1 e a compatibilidade de sync.

---

## A regra que organiza esta página (ADR-009)

> Deploy de **código** = rolling/blue-green, **sem downtime** (o stateless permite). Mudança de **schema** = **expand/contract**, porque os 900 bancos migram independentemente e nós/edges no campo ficam em versões diferentes ao mesmo tempo. O código suporta uma **janela de 1 versão** (N e N-1), não todas para sempre.

A consequência prática, que vale gravar:

> **Um fix de CÓDIGO sobe uma vez e conserta os 900 clientes juntos** (a frota é compartilhada — ADR-004). **O que exige orquestração de verdade é a migration de SCHEMA**, porque ela toca 900 bancos que têm de continuar funcionando enquanto N e N-1 do código convivem.

Confundir os dois é a origem do medo de deploy. Código é fácil (rolling na frota única). Schema é o que precisa de método (expand/contract). O resto desta página separa rigorosamente os dois.

```
  FIX DE CÓDIGO                                MIGRATION DE SCHEMA
  ┌─────────────────────────┐                 ┌──────────────────────────────────┐
  │ 1 rolling deploy na      │                 │ rodar em 900 bancos, em lote,    │
  │ FROTA ÚNICA stateless    │                 │ cada um na sua janela,           │
  │ → 900 clientes corrigidos│                 │ aditivo primeiro (expand),       │
  │   de uma vez             │                 │ contract só quando TODOS migraram│
  └─────────────────────────┘                 └──────────────────────────────────┘
       fácil, frequente                              o trabalho real de orquestração
```

---

## O pipeline (CI → CD)

Estágios, do commit ao tráfego. Exemplo conceitual em YAML mais abaixo.

```
  commit/PR ─► CI ───────────────────────────► CD ──────────────────────────────►
  ┌────────┐   ┌──────────────────────────┐    ┌───────────────────────────────┐
  │ lint   │   │ build imagem (OCI)        │    │ deploy rolling/blue-green     │
  │ types  │   │ unit + integration        │    │ na frota API/worker (stateless│
  │        │   │ PARIDADE (golden legado)  │    │ health/drain/graceful)        │
  │        │   │ e2e Playwright (+teclado) │    │ ↓                              │
  │        │   │ scan segredos/imagem      │    │ migration runner (expand)     │
  │        │   └──────────────────────────┘    │ ↓ feature flag liga gradual   │
  │        │            │ tag por release       │ edge/Electron update escalonado│
  └────────┘            ▼                       └───────────────────────────────┘
                  registry de imagens                rollback a qualquer ponto
```

Pontos que materializam a canon:

- **O gate de paridade é obrigatório.** O pipeline **reprova** se o harness de paridade legado×novo não está verde **exercitando o caminho real** ([../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)). Verde que não toca a SQL/condicional/dispatch real é falsa confiança ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)) — e não passa.
- **Teclado é gate.** E2E Playwright valida taborder, Enter-avança, F-keys e mnemônicos `&` ([../06-testing-quality/playwright-e2e.md](../06-testing-quality/playwright-e2e.md)) — quebrar a memória muscular reprova (ADR-010).
- **Uma imagem, vários papéis (ADR-006/002).** A mesma imagem sobe como `ROLE=api`, `ROLE=worker` e como base do edge. Build uma vez, deploy em qualquer alvo.

---

## Deploy rolling / blue-green — sem downtime

O stateless (ADR-004) **é o que torna isto possível**: como nenhum nó guarda estado, derrubar e subir réplicas não perde nada. Dois padrões, ambos válidos:

| Padrão | Como | Quando preferir |
|---|---|---|
| **Rolling** | substitui réplicas aos poucos (sobe nova, drena a velha, repete) | default; barato; janela N/N-1 convive naturalmente |
| **Blue-green** | sobe a frota nova inteira (green) ao lado da velha (blue), vira o tráfego de uma vez, mantém blue para rollback instantâneo | release sensível; rollback em segundos |

As quatro garantias que tornam o deploy invisível ao usuário:

1. **Health check / readiness.** O load balancer só manda tráfego para o nó que responde `/readyz` (pool de tenant aberto, dependências ok). Nó subindo não recebe request até estar pronto.
2. **Connection draining.** Ao tirar um nó, o LB **para de mandar novas** conexões e **espera** as em curso terminarem (timeout). Ninguém é cortado no meio de um request.
3. **Graceful shutdown.** O processo recebe `SIGTERM`, **para de aceitar** novo trabalho, **termina** o que está em voo (request HTTP, job do worker), fecha pools e só então sai.
4. **Janela N/N-1 (ADR-009).** Durante o rolling, nós N e N-1 atendem ao mesmo tempo. Por isso o código novo é **backward-compatible** com o schema antigo e com o contrato de sync — nada que só funcione em N pode quebrar quem ainda está em N-1.

```ts
// graceful shutdown — NestJS (API e worker). O SIGTERM não derruba no meio do trabalho.
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();                 // dispara onModuleDestroy/beforeShutdown

  process.on('SIGTERM', async () => {
    app.flushLogs();
    // 1) readiness vira NOT READY → LB para de mandar request novo (drain começa)
    healthState.setReady(false);
    // 2) espera in-flight terminar (HTTP em curso, job do worker em processamento)
    await drainInFlight({ timeoutMs: 25_000 });
    // 3) fecha pools de tenant e a conexão da fila
    await closeAllTenantPools();
    await app.close();                        // fecha workers BullMQ graciosamente
    process.exit(0);
  });
}
```

```ts
// worker: não pega job novo durante o drain; termina o atual antes de sair
worker.on('SIGTERM' as any, async () => {
  await worker.pause(/* doNotWaitActive */ false); // espera o job ativo terminar
  await worker.close();
});
```

> **Worker e zero-downtime:** o job pesado (SPED, import) pode levar minutos. O graceful shutdown **não mata** o job no meio — ou ele termina dentro do timeout, ou o job é **idempotente e retryável** ([../01-architecture/workload-tiers.md](../01-architecture/workload-tiers.md)), e outro worker o reprocessa sem duplicar. Idempotência é o cinto de segurança do deploy do worker.

---

## O migration runner — schema em 900 bancos, com segurança expand/contract

Aqui mora a orquestração real. Não é "rodar uma migration"; é **rodar a mesma migration em 900 bancos**, cada um na sua janela, sem travar nenhum cliente, mantendo o código N e N-1 funcionando o tempo todo.

### Por que não dá para "migrar todos de uma vez e trocar o código junto"

No legado, trocava-se todos os `.exe` na mesma janela. **Não existe mais.** Os 900 bancos são independentes (ADR-003), os edges/PDVs ficam offline ou pinados, e a frota faz rolling (N e N-1 convivem). Uma migration destrutiva ("DROP COLUMN") aplicada antes de todo o código estar em N **quebra** o nó N-1 que ainda lê aquela coluna. Daí o **expand/contract** (parallel change).

### Expand / contract (parallel change) — o método

A mudança de schema é quebrada em fases que **nunca** deixam código e banco incompatíveis (detalhe em [../05-migration-engineering/migrations-expand-contract.md](../05-migration-engineering/migrations-expand-contract.md)):

```
  EXPAND (release N)            BACKFILL                CONTRACT (release N+1 ou depois)
  ┌───────────────────────┐    ┌──────────────────┐    ┌────────────────────────────────┐
  │ só ADITIVO:            │    │ preenche o novo   │    │ remove o velho SÓ depois que   │
  │ + coluna/tabela nova   │ →  │ a partir do velho │ →  │ TODOS os 900 migraram e todo o │
  │ nullable, índice       │    │ (em lote, no      │    │ código está em ≥N+1            │
  │ CONCURRENTLY           │    │  worker tier)     │    │ DROP COLUMN / constraint final │
  │ código N lê velho+novo │    │                   │    │ código não usa mais o velho    │
  └───────────────────────┘    └──────────────────┘    └────────────────────────────────┘
   nunca quebra N-1              idempotente, retomável   só quando seguro p/ todos
```

Regras que o runner **força**:

- **Expand é só aditivo.** Coluna nullable, tabela nova, índice `CREATE INDEX CONCURRENTLY` (não trava escrita). Nada destrutivo na fase expand.
- **Backfill no worker tier**, em lote, idempotente e retomável (watermark) — não num handler HTTP, não num transação gigante que trava a tabela ([../01-architecture/workload-tiers.md](../01-architecture/workload-tiers.md)).
- **Contract só quando seguro.** O `DROP`/constraint final só roda depois que **todos** os 900 estão migrados **e** todo o código está em ≥ versão que não usa mais o velho. O runner **verifica** isso antes de liberar o contract.

### Rodar nos 900 em lote — orquestração

```
  MIGRATION RUNNER (job no worker tier, idempotente, observável)
  registry de tenants ──► lista 900 bancos + versão de schema atual de cada um
        │
        ▼  para cada banco, em lotes paralelos limitados (não martelar a instância)
  ┌───────────────────────────────────────────────────────────────────────┐
  │ por tenant:                                                            │
  │   1. trava de migração do tenant (não roda 2x concorrente)            │
  │   2. lê schema_version atual; aplica só migrations pendentes (expand)  │
  │   3. CREATE INDEX CONCURRENTLY / ADD COLUMN nullable (sem lock longo)  │
  │   4. registra schema_version novo; reporta progresso ao NOC           │
  │   5. falhou? marca FAILED, não bloqueia os outros, alerta             │
  └───────────────────────────────────────────────────────────────────────┘
        │
        ▼ stagger por instância: não migrar 50 bancos da MESMA instância de uma vez
   (espalha I/O; respeita a janela; tenant grande pode ter janela própria)
```

- **Por tenant, independente.** Um banco que falha **não** trava os 898 que deram certo. O runner é resumível: roda de novo, pula os já migrados (idempotente), retoma os pendentes/falhos.
- **Stagger por instância de dado.** Não disparar a migration em 50 bancos empacotados na mesma instância Postgres ao mesmo tempo — espalha I/O para não degradar o OLTP de quem compartilha a instância. Mesma lógica do dia pesado ([../01-architecture/heavy-days-thundering-herd.md](../01-architecture/heavy-days-thundering-herd.md)).
- **Janela por tenant.** O tenant grande migra na **sua** janela (madrugada dele, on-prem dele) — db-per-tenant dá isso de graça (ADR-003).
- **Observável.** Cada tenant reporta `schema_version` e status (pending/running/done/failed) ao NOC ([observability.md](observability.md)). "Quantos dos 900 já estão em N?" é uma métrica de painel.
- **Decisão informada por dado.** Antes de criar índice/particionar numa migration, mede-se volume/cardinalidade/plano via **MCP de Postgres** ([../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md)) — nunca no escuro.

```ts
// migration-runner.processor.ts — job no worker tier; idempotente, por tenant, em lote
@Processor('schema-migration')
export class MigrationRunner extends WorkerHost {
  async process(job: Job<{ targetVersion: string }>): Promise<void> {
    const tenants = await this.registry.listActive();           // os 900 do registry
    await runInBatches(tenants, { concurrency: 8, groupBy: 'instance' /* stagger por instância */ },
      async (t) => {
        await this.lock.withTenantLock(t.id, async () => {       // não roda 2x concorrente
          const current = await this.schema.versionOf(t);
          const pending = this.plan.pendingExpandOnly(current, job.data.targetVersion); // só aditivo
          for (const m of pending) {
            await m.applyConcurrentSafe(t);                      // ADD COLUMN null / INDEX CONCURRENTLY
            await this.schema.record(t, m.version);
            await job.updateProgress(/* … */);
          }
        });
      },
      { onError: (t, e) => this.report.tenantFailed(t, e) });    // 1 falho não trava os outros
  }
}
```

> **O contract é um deploy separado.** Ele **não** vai junto do expand. Vai num release posterior, depois que o painel mostra "900/900 em N" e o código novo (que não usa mais a coluna velha) está 100% no ar. Essa disciplina é a diferença entre "deploy tranquilo" e "incidente às 3 da manhã".

---

## Electron auto-update — o PDV e as superfícies pesadas

O Electron (ADR-008) **não** é a frota da nuvem — é app instalado no caixa/balcão, no campo, offline boa parte do tempo. Atualizá-lo tem regras próprias, usando **electron-updater**:

- **Rollout escalonado.** Nunca empurrar a versão nova para todos os PDVs de uma vez. Liberar por anéis (canário → % crescente → geral), por cliente/loja, observando erro e transmissão fiscal antes de ampliar. Mesma filosofia do edge ([infrastructure.md](infrastructure.md)).
- **NUNCA atualizar no meio de uma venda.** O update **não** se aplica com cupom aberto, item sendo lançado, TEF em curso ou contingência pendente de transmissão. A atualização baixa em background e só se **aplica em ponto seguro** (caixa fechado/ocioso, fim de turno), com confirmação.
- **Pin de versão por cliente.** Um cliente pode ficar **pinado** numa versão (homologação, política interna, ou — crítico — **versão fiscal certificada**). O ADR-010 manda: o **módulo fiscal é versionável/pinável independente**; o update geral **não arrasta** o fiscal pinado junto.
- **Offline-tolerante.** O PDV pode passar dias sem ver a internet; o updater verifica quando há link, baixa quando dá, aplica quando é seguro — nunca depende de o caixa estar online no instante do release.
- **Compatibilidade de sync N/N-1.** Como PDVs ficam em versões diferentes, o **contrato de sync é backward-compatible** (ADR-009) — um PDV em N-1 sincroniza com um edge em N sem quebrar ([../05-migration-engineering/versioning-and-compatibility.md](../05-migration-engineering/versioning-and-compatibility.md)).

```ts
// electron/updater.ts — baixa em background, aplica só em ponto SEGURO, respeita pin
import { autoUpdater } from 'electron-updater';

autoUpdater.autoDownload = true;          // baixa em background quando há link
autoUpdater.autoInstallOnAppQuit = false; // NÃO instala sozinho no quit — nós controlamos quando

// canal/pin por cliente (inclui pin do fiscal — ADR-010)
autoUpdater.channel = config.updateRing;                  // 'canary' | 'stable' | pinned
autoUpdater.allowDowngrade = false;
if (config.fiscalPinnedVersion) lockFiscalModule(config.fiscalPinnedVersion); // fiscal não é arrastado

autoUpdater.on('update-downloaded', (info) => {
  // a venda manda: só aplica quando é SEGURO
  registerSafePointHandler(() => {
    if (!sale.isOpen() && !tef.inProgress() && fiscal.contingencyQueueEmpty()) {
      autoUpdater.quitAndInstall(/* isSilent */ true, /* forceRunAfter */ true);
    } // senão: adia, tenta de novo no próximo ponto seguro (fim de turno, caixa fechado)
  });
});
```

> O paralelo com o edge: edge e Electron são **frota no campo**, atualizados de forma **escalonada e pinável**, nunca à força, nunca no meio de operação crítica. A nuvem (API/worker) é rolling porque é nossa e stateless; o campo é escalonado porque é do cliente e offline.

---

## Feature flags

Flags desacoplam **deploy** de **ativação** — essencial com a janela N/N-1 e o strangler:

- **Liberar gradual.** Código novo sobe **desligado**; liga por % de tenant, por tenant específico, por loja. Se der ruim, **desliga sem redeploy**.
- **Casar com expand/contract.** O caminho que usa a coluna nova fica atrás de flag, ligado só onde o backfill já completou. Schema e comportamento avançam em compasso.
- **Strangler.** A flag decide "esta tela vai para o novo ou ainda para o legado" por tenant ([../10-roadmap/phases.md](../10-roadmap/phases.md)) — cutover por cliente, reversível.
- **Kill switch fiscal.** Mudança fiscal arriscada entra atrás de flag por UF; um problema numa UF se desliga sem afetar as outras (o fiscal é a trilha de risco — [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md)).

---

## Rollback

O plano de volta, por tipo de mudança (porque código e schema voltam diferente):

| Mudança | Como reverter |
|---|---|
| **Código** | rolling de volta para a imagem N-1 (blue-green: vira o tráfego para o blue) — segundos/minutos, frota única |
| **Feature flag** | **desligar a flag** — instantâneo, sem deploy; o caminho preferido de mitigação |
| **Schema (expand)** | aditivo é seguro: coluna/índice novo nullable não quebra N-1; "reverter" é só **não usar** (desligar flag) e, se preciso, dropar o aditivo |
| **Schema (contract)** | **caro** — por isso o contract só roda quando 100% seguro. Reverter um DROP exige restore/PITR ([database-ops.md](database-ops.md)). É a razão de o contract ser conservador. |
| **Electron/edge** | publicar a versão anterior no anel; pin no cliente afetado; nunca aplicar no meio de venda |

> **Regra de ouro do rollback:** a fase **expand** existe justamente para que o rollback de comportamento seja **desligar uma flag**, não desfazer um schema. Se você precisa reverter um `DROP COLUMN` em produção, o processo falhou lá atrás (contract cedo demais). O caminho seguro é: expand cedo, flag para ligar/desligar, contract tarde.

---

## Exemplo de pipeline (YAML conceitual)

```yaml
# .ci/pipeline.yml — conceitual (agnóstico de provedor)
stages: [ci, image, deploy, migrate, release]

ci:
  steps:
    - run: pnpm lint && pnpm typecheck
    - run: pnpm test:unit
    - run: pnpm test:integration        # contra Postgres real (não in-memory)
    - run: pnpm test:parity             # GATE: golden legado×novo, caminho real (ADR-009 / sec 06)
    - run: pnpm test:e2e --keyboard     # GATE: taborder/Enter/F-keys/mnemônicos (ADR-010)
    - run: scan:secrets && scan:image   # nenhum segredo na imagem; CVE scan

image:
  needs: [ci]
  steps:
    - run: docker build -t registry/apollo:${RELEASE} .   # UMA imagem (api/worker/edge base)
    - run: docker push registry/apollo:${RELEASE}

deploy:                                  # CÓDIGO: rolling/blue-green na frota stateless
  needs: [image]
  strategy: { type: rolling, maxUnavailable: 0, maxSurge: 2 }   # sobe antes de derrubar
  steps:
    - run: deploy api   --image registry/apollo:${RELEASE} --health /readyz --drain 25s
    - run: deploy worker --image registry/apollo:${RELEASE} --graceful
    - verify: smoke --tenant canary     # smoke por tenant canário, caminho real

migrate:                                 # SCHEMA: expand only, nos 900, em lote, staggered
  needs: [deploy]
  steps:
    - run: migrate --phase expand --all-tenants --concurrency 8 --stagger-by instance
    - run: backfill --queue worker --idempotent --resumable     # no worker tier
    # CONTRACT não está aqui — vai num release posterior, quando 900/900 em N (ver acima)

release:                                 # ativação gradual + campo
  needs: [migrate]
  steps:
    - run: flags enable feature.X --rollout 5%   # liga gradual; desliga sem redeploy
    - run: electron publish --ring canary --pin-fiscal respect   # PDV escalonado, fiscal pinado
    - run: edge fleet rollout --ring canary       # edge escalonado (Fleet/Balena)
```

> O que **não** está no estágio `migrate`: o `contract`. Ele é um pipeline próprio, disparado dias depois, **condicionado** a "todos os 900 em N e código sem uso do velho". Manter o contract fora do deploy de feature é a disciplina que faz o ADR-009 funcionar na prática.

---

## Ver também

- [infrastructure.md](infrastructure.md) — a frota stateless, o LB e a frota de edge que este deploy alvo.
- [database-ops.md](database-ops.md) — backup/PITR (rede de segurança do contract), restore, DR.
- [observability.md](observability.md) — ver o progresso da migration nos 900, saúde do rollout, transmissão fiscal pós-deploy.
- [../05-migration-engineering/migrations-expand-contract.md](../05-migration-engineering/migrations-expand-contract.md) — o método expand/contract em profundidade.
- [../05-migration-engineering/versioning-and-compatibility.md](../05-migration-engineering/versioning-and-compatibility.md) — o contrato N/N-1 e o sync backward-compatible.
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — o gate de paridade que reprova verde cego.
- [../01-architecture/workload-tiers.md](../01-architecture/workload-tiers.md) — o worker tier onde backfill e migration runner rodam.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-009 (e ADR-004/006/008/010).
