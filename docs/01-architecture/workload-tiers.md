# Tiers de Carga (API / Worker / Read-replica)

> Como o Apollo separa o caminho interativo do trabalho pesado para que dois clientes grandes fechando o mês ao mesmo tempo não derrubem o PDV de ninguém.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-005 (tiers por carga), ADR-006 (monólito modular em papéis), ADR-007 (read replica + rollups).
- [target-architecture.md](target-architecture.md) — os tiers vivem dentro da camada 1 (nuvem).
- [tenancy-and-data.md](tenancy-and-data.md) — isolamento por tenant que os tiers respeitam.

## O princípio (ADR-005)

> **Carga pesada NÃO roda na API interativa.** Telas, PDV e sync precisam de latência previsível. Fechamento fiscal, SPED, relatório de mês e importação são **assíncronos** — vão para um **worker tier** (fila) e leem de **read replica + rollups**.

São o **mesmo monólito modular** (ADR-006) deployado em **três papéis**. Não são três bases de código; é o mesmo container subindo com responsabilidades diferentes.

```
                         ┌──────────────────────────────────────────┐
   telas / PDV / sync ──>│  TIER API (OLTP, interativo)             │
                         │  • leve, latência previsível             │──┐ escreve
                         │  • escala por TAXA DE REQUEST            │  │
                         │  • enfileira jobs pesados, não executa   │  ▼
                         └───────────────┬──────────────────────────┘  ┌───────────────┐
                                         │ add(job)                    │  PRIMÁRIO      │
                                         ▼                             │  (escrita +    │
                         ┌──────────────────────────────────────────┐ │   OLTP)        │
                         │  FILA  (BullMQ / Redis)                  │ └───────┬────────┘
                         │  • prioridade, retry, backoff, dedupe    │         │ replicação
                         └───────────────┬──────────────────────────┘         ▼ automática
                                         │ consome                     ┌───────────────┐
                         ┌───────────────▼──────────────────────────┐ │  READ REPLICA  │
   relatório/SPED/batch ─│  TIER WORKER (assíncrono)                │─│  (leitura      │
                         │  • fechamento fiscal, SPED, rollup, import│ │   pesada +     │
                         │  • retorna job id, reporta progresso     │ │   rollups/MV)  │
                         │  • escala HORIZONTAL no pico, desce depois│ └───────────────┘
                         └──────────────────────────────────────────┘
```

## TIER API (OLTP)

O caminho **interativo**: telas de retaguarda, endpoints que o edge/PDV chamam no sync, CRUD operacional. Características:

- **Leve por request.** Cada chamada faz pouco trabalho e responde rápido. Nada de "gerar o SPED do mês" dentro de um handler HTTP.
- **Escala por taxa de request.** Mais usuários/sync → mais réplicas da API atrás do load balancer. Métrica de scaling é RPS/latência, não CPU de batch.
- **Escreve no primário; lê do primário (operacional).** O dado que o operador acabou de gravar precisa estar lá no próximo clique — leitura operacional vai no primário, com frescor garantido.
- **Não executa pesado — enfileira.** Quando uma tela pede "fecha o mês", a API **valida, cria o job, devolve o job id** e a UI passa a acompanhar progresso. O handler retorna em milissegundos.

## TIER WORKER (fila BullMQ/Redis)

O trabalho **assíncrono e pesado** (ADR-005): fechamento fiscal/SPED, geração de relatório grande, importações em lote, recálculo de rollups. Características:

- **Desacoplado por fila.** A API publica o job; o worker consome. Pico de demanda vira **profundidade de fila**, não timeout de HTTP.
- **Retorna job id, reporta progresso.** O cliente não fica preso esperando; consulta status (`queued → active → progress% → completed/failed`) e baixa o resultado quando pronto.
- **Retry, backoff e idempotência.** Job que falha re-tenta com backoff; jobs são idempotentes (re-rodar não duplica lançamento fiscal).
- **Prioridade e isolamento por tenant.** Filas/concorrência por tenant evitam que um cliente grande monopolize os workers (ver [heavy-days-thundering-herd.md](heavy-days-thundering-herd.md)).
- **Escala horizontal elástica.** Mais workers no pico de fim de mês, menos fora dele.

## TIER READ-REPLICA / ANALÍTICO

Leitura pesada **não bate no primário** (ADR-007). Dois mecanismos, sem CQRS pesado:

- **Read replica** — cópia read-only por replicação **automática** do Postgres, **mesmo schema**. Relatório/BI consulta a replica; o primário fica livre para o OLTP do PDV. (No tenant grande, a replica é dedicada — ver [tenancy-and-data.md](tenancy-and-data.md).)
- **Rollups / materialized views** — pré-agregações (venda por dia/loja/seção, base de apuração fiscal) atualizadas **incrementalmente** ao longo do mês. O relatório lê o rollup pronto (leve), não recalcula do zero (pesado). Isso conversa diretamente com a estratégia de não deixar o trabalho fiscal para o dia do prazo — ver [heavy-days-thundering-herd.md](heavy-days-thundering-herd.md).

> Nada de manter um modelo de leitura separado por eventos (CQRS pesado / event-sourcing) — é complexidade desnecessária agora (ADR-007). Só se doer muito, e aí um data warehouse analítico dedicado.

## O cenário Y + B (a prova do design)

**Cliente Y** roda o relatório do mês **ao mesmo tempo** que **cliente B** roda o fechamento fiscal. O design tem de absorver isso sem degradar o PDV de ninguém. Como **não** resolver e como resolver:

| Tentação | Por que é errada | O certo no Apollo |
|---|---|---|
| **Super máquina** (uma instância gigante que aguenta o pico) | Paga o pico o ano inteiro; eventualmente o pico cresce e estoura | **Scale-out elástico**: sobe réplicas de worker no pico de fim de mês, **desce** depois. Capacidade segue a demanda. |
| **Rodar na API** | Pesado na API trava telas e o sync do PDV — exatamente o que o ADR-005 proíbe | **Worker + replica**: o pesado sai do caminho interativo. A API só enfileira. |
| **Serial** (B espera Y terminar) | Fechamento fiscal tem prazo; serializar atrasa cliente e não usa o hardware | **Paralelo e isolado por tenant**: Y e B correm em workers distintos, cada um lendo a replica do **seu** banco (db-per-tenant). Não disputam dado nem se bloqueiam. |

Resumo: **horizontal, fora da API, paralelo, isolado por tenant.** O isolamento sai de graça do db-per-tenant (ADR-003) — Y e B nem compartilham banco; a única disputa possível é por workers/compute, resolvida com mais réplicas no pico e prioridade por tenant.

## Enfileirar um job no NestJS + BullMQ

A API valida e enfileira (retorna job id); o worker consome e reporta progresso.

```ts
// fiscal-closing.queue.ts — registro da fila
@Module({
  imports: [
    BullModule.registerQueue({ name: 'fiscal-closing' }),
  ],
})
export class FiscalClosingQueueModule {}
```

```ts
// fiscal-closing.controller.ts — API só ENFILEIRA, responde rápido
@Controller('fiscal/closing')
export class FiscalClosingController {
  constructor(
    @InjectQueue('fiscal-closing') private readonly queue: Queue,
    private readonly tenant: TenantContext, // request-scoped (ver tenancy-and-data.md)
  ) {}

  @Post()
  async start(@Body() dto: StartClosingDto) {
    const job = await this.queue.add(
      'close-period',
      { tenantId: this.tenant.tenantId, storeId: dto.storeId, period: dto.period },
      {
        // idempotência: mesmo período não enfileira em duplicidade
        jobId: `closing:${this.tenant.tenantId}:${dto.storeId}:${dto.period}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        priority: dto.urgent ? 1 : 10, // menor = mais prioritário
        removeOnComplete: { age: 86_400 },
      },
    );
    return { jobId: job.id, status: 'queued' }; // retorna em ms, não bloqueia
  }

  @Get(':jobId')
  async status(@Param('jobId') jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new NotFoundException();
    return { jobId, state: await job.getState(), progress: job.progress };
  }
}
```

```ts
// fiscal-closing.processor.ts — WORKER consome, reporta progresso, é idempotente
@Processor('fiscal-closing')
export class FiscalClosingProcessor extends WorkerHost {
  constructor(private readonly connections: TenantConnectionManager) { super(); }

  async process(job: Job<ClosingPayload>): Promise<ClosingResult> {
    const { tenantId, storeId, period } = job.data;
    const db = await this.connections.forTenant(tenantId); // banco do tenant correto

    // leitura PESADA sai da replica; rollups já pré-agregados ao longo do mês
    const base = await readClosingBaseFromReplica(db, storeId, period);
    await job.updateProgress(40);

    const result = await computeSpedAndPersist(db, base, period); // idempotente
    await job.updateProgress(100);
    return result; // disponibilizado p/ download quando completed
  }
}
```

Pontos que materializam os ADRs: a API **não computa** (só `queue.add`), o `jobId` determinístico dá **idempotência**, o worker lê o banco **do tenant certo** (isolamento — ADR-003/004), e a leitura pesada vem da **replica + rollups** (ADR-007). Escalar é subir mais instâncias do processor no pico (ver dia pesado).

## Ver também

- [heavy-days-thundering-herd.md](heavy-days-thundering-herd.md) — quando todos os tenants têm o mesmo prazo de SPED.
- [target-architecture.md](target-architecture.md) — onde os tiers vivem na camada 1.
- [tenancy-and-data.md](tenancy-and-data.md) — read replica dedicada e isolamento por tenant.
- [../02-stack-and-standards/performance-playbook.md](../02-stack-and-standards/performance-playbook.md) — rollups, índices, EXPLAIN.
- [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md) — provisionamento de replica e autoscaling.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-005, ADR-006, ADR-007.
