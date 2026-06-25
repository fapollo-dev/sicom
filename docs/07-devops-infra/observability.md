# Observabilidade (por tenant, edge e PDV)

> Como enxergar uma frota de **900 tenants + edges + PDVs**: logs/métricas/tracing **por tenant**, **monitoramento de sync lag** (edge/PDV), **monitoramento de transmissão fiscal** (NFC-e/contingência), alertas acionáveis, uma visão **NOC de saúde de frota**, e SLOs que dizem o que "saudável" significa. Com exemplos concretos de métrica e alerta.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-003/004 (tenant é a dimensão de tudo), ADR-001/008 (edge+PDV offline), ADR-010 (fiscal é o risco-coroa).
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — o **risco-coroa fiscal** e a contingência (o que a observabilidade fiscal vigia).
- [infrastructure.md](infrastructure.md) — a frota (API/worker/edge/PDV) que esta página observa.
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — sync, watermark e contingência (a base do sync lag e da transmissão fiscal).

---

## O princípio: a dimensão é o tenant (e a loja, e o caixa)

Num sistema multi-tenant, "o sistema está lento" é uma frase inútil. A pergunta certa é **"para qual tenant?"** — e muitas vezes **"para qual loja / qual PDV?"**. Toda telemetria do Apollo carrega, como **rótulo de primeira classe**, o `tenantId`, e quando aplicável `storeId` e `pdvId`. Sem isso, um incidente num cliente se dilui na média de 900 e some.

> **Regra:** todo log estruturado, toda métrica e todo span carrega `tenant`, e — no caminho de loja — `store` e `pdv`. Cardinalidade é cuidada (rótulo de tenant é alta cardinalidade; PDV é altíssima) — métrica fina agrega por tenant, e o detalhe por PDV vai em log/trace amostrado, não em série temporal por caixa.

```
   OBSERVABILIDADE — três pilares, sempre rotulados por tenant
   ┌────────────┐   ┌────────────┐   ┌────────────┐
   │   LOGS     │   │  MÉTRICAS  │   │  TRACING   │
   │ estruturado│   │ séries     │   │ spans      │
   │ {tenant,   │   │ por tenant │   │ tenant no  │
   │  store,pdv}│   │ /store     │   │ baggage    │
   └─────┬──────┘   └─────┬──────┘   └─────┬──────┘
         └───────── correlation id (request/sync/job) ───────┘
                              │
                    ┌─────────▼─────────┐
                    │   NOC / saúde de   │  900 tenants + edges + PDVs
                    │   frota + alertas  │  + transmissão fiscal + sync lag
                    └────────────────────┘
```

---

## Logs por tenant

- **Estruturados (JSON), com `tenant`/`store`/`pdv` e `correlationId`.** O mesmo id atravessa request HTTP → job na fila → sync do edge, para reconstruir uma operação ponta a ponta. O `tenant` vem do contexto request-scoped ([../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md)), nunca do log à mão.
- **Sem vazar PII/segredo no log.** Documento fiscal e dado de cliente não vão crus para o log; logam-se chaves/ids, não conteúdo sensível. (Higiene que também protege o isolamento de tenant.)
- **Retenção por relevância:** log operacional dias/semanas; evento fiscal relevante (transmissão, contingência) tem trilha mais longa, casada com a retenção legal ([database-ops.md](database-ops.md)).
- **Filtrável por tenant.** "Mostre tudo do tenant xpto na última hora" é uma query — é o que torna o suporte a um cliente específico tratável em escala 900.

```ts
// logger com tenant injetado pelo contexto request-scoped (nunca à mão)
this.logger.info({
  event: 'venda.persistida',
  tenant: ctx.tenantId, store: ctx.storeId, pdv: ctx.pdvId,
  correlationId: ctx.correlationId,
  cupomUid: cupom.uid, total: cupom.total,    // id e número — NÃO o XML inteiro
}, 'cupom persistido no edge');
```

---

## Métricas por tenant

Séries temporais rotuladas por `tenant` (e `store` onde faz sentido). Dois grupos: **infra** (a frota) e **negócio/fiscal** (o que o cliente sente).

| Métrica | Tipo | Rótulos | Para quê |
|---|---|---|---|
| `apollo_http_request_duration_seconds` | histogram | tenant, route, method | latência da API por tenant (p95/p99) |
| `apollo_http_requests_total{status}` | counter | tenant, status | taxa de erro 5xx por tenant |
| `apollo_queue_depth` | gauge | queue, tenant | profundidade de fila (dia pesado) |
| `apollo_job_duration_seconds` | histogram | job, tenant | tempo de SPED/import/relatório por tenant |
| `apollo_db_replica_lag_seconds` | gauge | instance, tenant | atraso da replica (leitura velha) |
| `apollo_db_connections_used` | gauge | instance | saturação de pool por instância |
| `apollo_sync_lag_seconds` | gauge | tenant, store, pdv | atraso do sync edge/PDV (ver abaixo) |
| `apollo_fiscal_transmit_total{result}` | counter | tenant, store, uf | NFC-e autorizada/rejeitada/contingência (ver abaixo) |
| `apollo_fiscal_pending_age_seconds` | gauge | tenant, store | idade do doc fiscal mais antigo não transmitido |
| `apollo_tenant_schema_version` | gauge | tenant | quantos dos 900 estão em N (migration runner) |

> **Negócio é sinal de saúde.** Uma queda brusca em `vendas/min` de um tenant em horário comercial é alarme mesmo com a infra "verde" — pode ser PDV travado, edge isolado ou um bug que o eval não pegou. Métrica de negócio por tenant detecta o que a métrica de infra não vê.

---

## Tracing por tenant

- **Span com `tenant` no baggage**, propagado por todo o caminho (API → fila → worker → banco; e API → edge no sync). Um trace mostra "a venda do tenant X levou 800 ms: 200 no edge, 500 na fila, 100 no banco".
- **Amostragem com viés para erro e para tenant sob investigação:** amostra-se baixo no caminho feliz, **100%** quando há erro ou quando um tenant está sendo investigado. Mantém custo baixo sem perder o que importa.
- **Atravessa a fronteira de sync.** O trace não para na nuvem; o `correlationId` segue para o edge e volta, ligando "o cupom que o PDV emitiu" a "o consolidado que chegou à nuvem" — essencial para depurar reconciliação ([../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md)).

---

## Monitoramento de sync lag (edge / PDV)

O offline-first (ADR-008) significa que **estar atrasado é normal** — o PDV vende offline e reconcilia depois. A observabilidade tem de distinguir **"atrasado e saudável"** de **"atrasado e quebrado"**. A métrica-chave é o **sync lag**: há quanto tempo um edge/PDV não reconcilia e quanto há na fila local.

```
   SYNC LAG — o que vigiar em cada salto
   PDV ──LAN──► EDGE ──WAN──► NUVEM
    │            │             │
    │            │             └─ lag edge→nuvem: consolidado parado na borda?
    │            └─ lag PDV→edge: cupons offline acumulando no caixa?
    └─ fila local do PDV: profundidade da fila de venda não-sincronizada
```

| Sinal | Saudável | Alerta |
|---|---|---|
| `sync_lag` PDV→edge | minutos (sync incremental normal) | horas em horário comercial com WAN ok → PDV/edge travado |
| `sync_lag` edge→nuvem | minutos/horas em queda de WAN | dias, ou crescendo sem parar → edge isolado de verdade |
| profundidade da **fila local** do PDV | baixa, drena ao reconectar | cresce sem drenar mesmo com link → reconciliação falhando |
| **watermark** avançando | avança a cada sync | parado com link ativo → sync emperrado (não retoma) |

- **Contexto importa.** Lag alto **com WAN comprovadamente caída** é esperado (loja num apagão) — alerta de **severidade menor**, informativo. Lag alto **com link ativo** é incidente — algo no caminho de sync quebrou.
- **Por loja e por caixa.** O alerta aponta *qual* PDV/edge — "PDV 3 da loja 02 do tenant xpto não sincroniza há 4h com WAN ok". Acionável, não "o sync está ruim".
- **Edge reporta saúde ativamente** ([infrastructure.md](infrastructure.md)): versão, lag, fila de contingência, último sync. Edge **silencioso** (não reporta) é, ele próprio, um alerta — pode estar morto.

---

## Monitoramento de transmissão fiscal (NFC-e / contingência)

Este é o painel mais crítico — o fiscal é o **risco-coroa** ([../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md)). A venda **não para** quando a SEFAZ cai (contingência — [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md)), mas o documento **tem** de ser autorizado **depois**. A observabilidade fiscal vigia exatamente esse "depois".

O que se mede:

| Métrica fiscal | O que diz | Severidade |
|---|---|---|
| `fiscal_transmit_total{result=authorized}` | NFC-e autorizadas — o caminho feliz | baseline |
| `fiscal_transmit_total{result=rejected}` | rejeições da SEFAZ | **alta** — rejeição é erro de regra/dado, não cai sozinho |
| `fiscal_transmit_total{result=contingency}` | emissões em contingência (SEFAZ/WAN fora) | sobe num apagão; vigiar a **retomada** |
| `fiscal_pending_age_seconds` | idade do doc mais antigo **não transmitido** | **crítica** se cresce — backlog não está sendo enviado |
| `fiscal_contingency_backlog` | quantos docs aguardam transmissão diferida | tem de **drenar** quando a SEFAZ volta |
| `fiscal_cert_expiry_days` | dias até o **certificado A1** vencer (por tenant) | **alta** ao se aproximar — A1 vencido = não emite |

Padrões de alerta fiscal:

- **Backlog de contingência que não drena.** SEFAZ voltou (autorizações fluindo de novo) **mas** `fiscal_pending_age` continua subindo → a transmissão diferida emperrou. Risco legal direto: documento emitido em contingência precisa ser autorizado dentro do prazo. Alerta **crítico**, por tenant/loja.
- **Pico de rejeição.** `result=rejected` sobe → mudança de regra fiscal (a legislação muda várias vezes por ano), dado errado, ou bug. Casado com a UF (`uf`), aponta se é uma SEFAZ específica.
- **Certificado A1 vencendo.** Alerta com antecedência (30/15/7 dias) por tenant — A1 vence em 1 ano; vencer em silêncio para a emissão do cliente. Liga no provisioner/secrets ([infrastructure.md](infrastructure.md)).
- **Distinção contingência-normal vs anomalia.** Contingência num apagão de SEFAZ é **esperada** (até saudável — a venda continuou). O alarme é a **não-retomada**, não a entrada em contingência.

```yaml
# alerta: backlog de contingência não drena (risco LEGAL) — exemplo conceitual
- alert: FiscalContingencyBacklogStuck
  expr: |
    apollo_fiscal_pending_age_seconds > 1800            # doc não transmitido há >30min
    and rate(apollo_fiscal_transmit_total{result="authorized"}[10m]) > 0  # SEFAZ JÁ voltou
  for: 10m
  labels: { severity: critical, domain: fiscal }
  annotations:
    summary: "Backlog fiscal não drena no tenant {{ $labels.tenant }} loja {{ $labels.store }}"
    runbook: "verificar fila de transmissão diferida; SEFAZ ok mas docs parados — risco de prazo legal"
```

---

## Alertas (acionáveis, roteados, sem fadiga)

- **Acionável ou não existe.** Todo alerta tem **runbook** e dono. Alerta sem ação vira ruído e treina a equipe a ignorar — incluindo o que importa.
- **Severidade por impacto, não por componente.** `critical` acorda alguém (transmissão fiscal travada, banco de tenant grande caído, backup ausente); `warning` é horário comercial (lag de replica alto, fila crescendo); `info` é registro (entrada em contingência num apagão).
- **Rotulado por tenant/loja.** O alerta diz **quem** e **onde** — "tenant X, loja 02" — não "erro genérico". Reduz tempo de resposta drasticamente em escala 900.
- **Anti-tempestade.** Queda de WAN regional dispara N edges; agrupa-se por causa (uma região fora) em vez de 200 alertas idênticos. Inibição: o alerta de causa raiz suprime os sintomas.
- **Canal certo.** Crítico fiscal/dado → on-call imediato; degradação → painel + notificação de equipe. (O playbook já usa alerta de validador/monitor por canal — mesma disciplina aqui.)

---

## A visão NOC / saúde de frota

Um painel único que responde, em escala 900, "está tudo bem?" — e quando não está, **onde**:

```
  ┌──────────────────────────── NOC — SAÚDE DE FROTA ───────────────────────────────┐
  │ TENANTS        900 ativos · 4 degradados · 1 incidente   [xpto: replica lag 40s] │
  │ FROTA API      p95 180ms · err 0.2% · 12 réplicas        ███████░ autoscale ok   │
  │ FROTA WORKER   fila SPED: 320 jobs · 8 workers · ETA 14m  [dia pesado: stagger]  │
  │ EDGES          1.420 online · 6 offline >1h · 2 versão N-2 [loja 7 sem reportar] │
  │ PDVs           8.900 online · sync lag p95 3m · 11 lag>2h  [caixas a investigar] │
  │ FISCAL         autorizadas 99.4% · contingência 0.5% · backlog idade máx 4m  ✅  │
  │                cert A1 vencendo <30d: 3 tenants                ⚠                  │
  │ MIGRATION      schema N: 884/900 · running 12 · failed 4     [4 presos: revisar] │
  │ BACKUP/DR      último PITR ok · restore drill 2026-06-21 ✅ · off-site sync ok    │
  └──────────────────────────────────────────────────────────────────────────────────┘
```

A frota tem **três populações** que o NOC cobre juntas, cada uma com sua natureza:

- **Tenants (nuvem)** — sempre online, vigiados por latência/erro/recursos por tenant.
- **Edges (loja)** — frota gerida ([infrastructure.md](infrastructure.md)); vigiados por online/offline, versão, sync lag, contingência. Offline pode ser normal (apagão) ou não.
- **PDVs (caixa)** — offline-first; "offline" é estado normal — vigia-se **sync lag** e **fila local**, não "está conectado?".

> O NOC não é um luxo — com 900 clientes, **N** lojas cada e **M** caixas por loja, é a única forma de a operação saber onde olhar. Sem ele, descobre-se o problema quando o cliente liga.

---

## SLOs

SLOs definem "saudável" em número, por superfície (são alvos a afinar com o negócio):

| Superfície | SLI | SLO (alvo) |
|---|---|---|
| API interativa (telas/sync) | disponibilidade · p95 latência | 99.9% · p95 < 300ms |
| **Transmissão fiscal** | % docs autorizados em ≤ X min após emissão | ≥ 99.5% dentro do prazo |
| **Sync PDV→nuvem** | % cupons reconciliados em ≤ Y min após reconexão | ≥ 99% (descontada janela offline legítima) |
| Worker (dia pesado) | % de SPED concluídos dentro da janela do prazo | 100% (é prazo legal) |
| Backup/DR | RPO efetivo · sucesso de restore drill | RPO ≤ alvo do tier · drill mensal verde ([database-ops.md](database-ops.md)) |

- **Error budget orienta o ritmo.** Gastou o budget de disponibilidade? Segura release arriscado, prioriza estabilidade. Sobrou? Pode arriscar mais (rollout mais rápido).
- **SLO fiscal e de dia pesado são quase rígidos** — são **prazos legais**, não conforto de UX. O budget ali é mínimo: a operação se organiza para **não** falhar a janela do SPED nem o prazo de autorização fiscal.
- **SLO desconta o offline legítimo.** O sync SLO não pune a loja que ficou num apagão de 6h — distingue "atraso por WAN caída" (legítimo) de "atraso por sync quebrado" (viola SLO).

---

## Como isto fecha o loop com o resto da seção 07

- **Infra** ([infrastructure.md](infrastructure.md)) emite a telemetria (frota, edges, fiscal, object storage); a observabilidade a **lê e alerta**.
- **CI/CD** ([ci-cd-zero-downtime.md](ci-cd-zero-downtime.md)) consome o NOC: o progresso da migration (884/900 em N), a saúde do rollout escalonado de Electron/edge, o erro pós-deploy que dispara rollback/desliga flag.
- **Ops de banco** ([database-ops.md](database-ops.md)) usa as métricas por tenant (lag, conexões, tamanho, backup, schema_version) para promover tier, ajustar capacidade e validar DR.

---

## Ver também

- [infrastructure.md](infrastructure.md) — a frota (API/worker/edge/PDV) e o object storage que esta página observa.
- [ci-cd-zero-downtime.md](ci-cd-zero-downtime.md) — progresso de migration, saúde de rollout, gatilho de rollback.
- [database-ops.md](database-ops.md) — métricas de banco por tenant; RPO/RTO e restore drill nos SLOs.
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — sync, watermark e contingência (base do sync lag e da transmissão fiscal).
- [../01-architecture/heavy-days-thundering-herd.md](../01-architecture/heavy-days-thundering-herd.md) — o pico de SPED que o NOC e os SLOs cobrem.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — o risco-coroa fiscal que a observabilidade fiscal vigia.
- [README.md](README.md) — índice da seção 07.
