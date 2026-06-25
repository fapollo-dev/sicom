# Dias Pesados & Thundering Herd

> Por que o mesmo prazo de SPED para todos os clientes cria um pico violento no mesmo dia — e o conjunto de estratégias para que esse dia não derrube ninguém nem custe uma fortuna.

## Pré-requisitos de leitura

- [workload-tiers.md](workload-tiers.md) — API/Worker/Read-replica, base da resposta a pico.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-005 (tiers por carga), ADR-007 (rollups + replica).
- [../00-orientation/glossary.md](../00-orientation/glossary.md) — SPED/EFD ("mesmo prazo p/ todos").

## O problema que o cliente levantou

> **O SPED fiscal tem o MESMO prazo para todos.** No mesmo punhado de dias do mês, **todos** os clientes processam carga pesada (apuração, geração de arquivo EFD) **ao mesmo tempo** — um **thundering herd**.

Não é um pico aleatório que estatística suaviza; é um pico **correlacionado por lei**. Centenas de tenants disparam o trabalho mais caro do sistema na **mesma janela**, deixando o resto do mês ocioso. Dimensionar para o pico significaria pagar capacidade parada 25 dias por mês; ignorá-lo significaria fila/timeout no dia em que o cliente mais precisa entregar ao fisco. O desenho tem de **achatar e absorver** o pico.

```
  Carga ao longo do mês (sem mitigação)        Carga com pré-cálculo + stagger
   ▲                          █                  ▲
   │                          █                  │      ▁▂▃▃▃▄▄▄▄▄▅▅▅▅▅▅▆▆
   │                          █  thundering       │   ▁▂                    ▆▅ janela
   │ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁█  herd            │ ▁▂                        ▄ do prazo
   └────────────────────────────────► dia        └──────────────────────────────► dia
   trabalho empurrado p/ o dia do prazo          trabalho diluído + pico atenuado
```

## Estratégias (combinadas, não isoladas)

Nenhuma sozinha resolve; o desenho usa o conjunto.

### 1. Pré-cálculo incremental ao longo do mês (a mais importante)

**Não deixar o trabalho para o dia.** A base do SPED — totais por dia/loja/CFOP/CST, livros de entrada/saída/apuração — é construída **continuamente** em **rollups/materialized views** (ADR-007), atualizados conforme o movimento acontece. No dia do prazo, gerar o arquivo é **ler agregado pronto e formatar**, não recalcular o mês inteiro.

```
  Movimento do dia ──> atualiza rollup incremental (diário/contínuo)
                        rollup_apuracao(tenant, store, competência, cfop, cst) já agregado
  Dia do prazo  ──────> EFD = ler rollup + formatar layout  (leve!)
```

Isso transforma um job O(mês de movimento) por tenant num job O(formatar agregado) — o pico que sobra é uma fração do original. É a estratégia que mais corta a altura do herd, e conecta direto ao tier de read/rollup ([workload-tiers.md](workload-tiers.md)).

### 2. Escalonamento / stagger dos jobs

O prazo é o mesmo, mas **a hora não precisa ser**. Distribui-se o disparo dos jobs ao longo da janela permitida (ex.: agendar tenants em horários diferentes, jitter aleatório no enfileiramento), espalhando o herd em vez de concentrá-lo num instante.

```ts
// stagger: jitter no agendamento p/ não disparar todos no mesmo segundo
const jitterMs = Math.floor(Math.random() * SLOT_WINDOW_MS);
await queue.add('sped-export', payload, { delay: baseDelay + jitterMs, priority: 10 });
```

### 3. Fila com prioridade

Na fila (BullMQ — [workload-tiers.md](workload-tiers.md)), o trabalho do dia pesado é **priorizado/segregado** sem matar o resto. Jobs interativos curtos não ficam atrás de uma exportação gigante; tenants no prazo limite ganham prioridade sobre os que ainda têm folga.

### 4. Reserva de capacidade / autoscaling antecipado

O pico é **conhecido** (calendário fiscal). Diferente de pico imprevisível, dá para **provisionar antes**: subir réplicas de worker e a read replica **na véspera** da janela e mantê-las até o prazo passar — autoscaling **agendado**, não só reativo. Reativo sozinho chega tarde (escala depois da fila já formada); o agendado chega na frente porque o calendário é sabido.

### 5. Read replica dedicada para o relatório

A geração de SPED e os relatórios de fechamento leem **da replica**, nunca do primário (ADR-005/007). Assim o pico analítico **não toca** o OLTP — o PDV e as telas seguem com latência normal enquanto o worker mói a apuração na replica. No tenant grande, a replica é dedicada ([tenancy-and-data.md](tenancy-and-data.md)).

### 6. Rate limiting por tenant

Um tenant não pode monopolizar a frota de workers no dia do herd. **Concorrência máxima por tenant** garante fatia justa: cliente B não trava a fila inteira porque disparou 40 lojas de uma vez.

```ts
// limite por tenant: no máximo N jobs pesados concorrentes por cliente
await queue.add('sped-export', payload, {
  // BullMQ rate-limit por grupo/tenant
  group: { id: tenantId },          // particiona a fila por tenant
});
// worker configurado com concurrency e limiter por grupo → fatia justa
```

### 7. Janelas de processamento

Trabalho pesado **não-urgente** (rollup pesado, recálculos, importação) é empurrado para **janelas de baixa demanda** (madrugada), liberando a janela do prazo para o que é de fato do prazo. Combina com o stagger e com o pré-cálculo.

## FinOps do pico (o custo do dia pesado)

O dia pesado é também um **evento de custo**, e o objetivo é pagar **só o pico, só no pico**:

- **Elasticidade real.** A capacidade extra (workers, replica) **sobe** para a janela e **desce** depois (scale-out/scale-in — [workload-tiers.md](workload-tiers.md)). Pagar capacidade de pico o mês inteiro é o anti-padrão "super máquina" que o ADR-005 rejeita.
- **Pré-cálculo é FinOps.** Quanto mais a base já está rollup pronto, **menos compute** o pico consome — diluir trabalho no mês (barato, contínuo) é mais barato que comprar um burst gigante num dia.
- **Spot/efêmero para batch.** Worker de SPED é tolerante a retry e idempotente ([workload-tiers.md](workload-tiers.md)) → pode rodar em capacidade efêmera/barata, derrubável, com re-tentativa. Custo do burst cai.
- **Observabilidade do pico.** Medir profundidade de fila, tempo por job e custo por tenant na janela orienta o provisionamento do mês seguinte (o calendário se repete; o aprendizado acumula).

## Como as estratégias se encaixam

```
  pré-cálculo (1) ─── achata a ALTURA do pico (menos trabalho por job)
  stagger (2) + janelas (7) ─── espalha o pico no TEMPO
  fila c/ prioridade (3) + rate limit (6) ─── ordem JUSTA dentro do pico
  autoscaling agendado (4) + replica dedicada (5) ─── CAPACIDADE no momento certo
  FinOps ─── paga só o pico, só no pico
```

Pré-cálculo encolhe; stagger/janelas espalham; prioridade/rate-limit ordenam; autoscaling/replica suprem; FinOps controla o custo. O herd vira uma corcova administrável em vez de um paredão.

## Ver também

- [workload-tiers.md](workload-tiers.md) — worker, fila, replica e rollups que sustentam estas estratégias.
- [tenancy-and-data.md](tenancy-and-data.md) — replica dedicada e isolamento por tenant no grande.
- [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md) — provisionar replica, autoscaling agendado, capacidade efêmera.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-005, ADR-007.
