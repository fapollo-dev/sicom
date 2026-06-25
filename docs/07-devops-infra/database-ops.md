# Ops de Banco (db-per-tenant em escala)

> A operação dos 900 bancos: estratégia de empacotamento (pequenos juntos, grandes dedicados), read replicas, **backup por tenant + PITR**, DR com RPO/RTO, retenção fiscal legal de 5 anos, particionamento dos grandes (por loja/período), capacidade para os dias pesados, e monitoramento por tenant. Decisões de estrutura **nunca no escuro** — medidas com o **MCP de Postgres**.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-003** (db-per-tenant), **ADR-004** (pool no compute, silo no dado), ADR-005/007 (replica + rollups).
- [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) — o empacotamento por tier e o particionamento do grande (a base que esta página opera).
- [infrastructure.md](infrastructure.md) — as instâncias Postgres, o object storage fiscal e o provisioner que esta página mantém.
- [../01-architecture/heavy-days-thundering-herd.md](../01-architecture/heavy-days-thundering-herd.md) — o pico de SPED que dimensiona a capacidade.
- [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) — o MCP de Postgres para inspecionar e decidir com dado real.

---

## O que muda quando "o banco" são 900 bancos

O db-per-tenant (ADR-003) troca um banco gigante por **900 bancos isolados**. Isso é uma dádiva operacional — backup/restore/upgrade por cliente, blast radius pequeno — **se** a operação for desenhada para a multiplicidade. O que muda de mentalidade:

- Toda rotina (backup, restore, migration, monitor) é **por tenant** e **em lote** ao mesmo tempo: "fazer backup" é fazer 900 backups; "restaurar" é restaurar **um** sem tocar os outros.
- O isolamento de falha é **a favor**: corromper/restaurar o banco do cliente A **não** toca B. O blast radius de um incidente de dado é **um** cliente, não todos.
- A escala vem do **empacotamento** (ADR-004): 900 bancos lógicos em **dezenas** de instâncias — então as rotinas operam em dois eixos: **por banco** (lógico) e **por instância** (físico).

---

## Estratégia de empacotamento (pequenos juntos, grandes dedicados)

A regra do ADR-004, vista pela lente de ops (a decisão de modelo está em [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md)):

| Tier | Empacotamento | Backup | Replica | Particionamento |
|---|---|---|---|---|
| **Pequeno** (~5 GB) | dezenas de bancos por instância compartilhada | dump lógico por banco + PITR da instância | compartilhada (do pool) | não (paga complexidade à toa) |
| **Médio** (dezenas–centenas GB) | poucos por instância, ou própria | PITR por instância + dump por banco | opcional | só se a tabela de movimento doer |
| **Grande** (~1 TB) | **instância dedicada** | **PITR dedicado** (WAL próprio) | **dedicada** | **sim** (loja/período) |

```
  INSTÂNCIA-A (compartilhada, pequenos)         INSTÂNCIA-D (dedicada, grande)
  ┌──────────────────────────────────┐         ┌──────────────────────────────────┐
  │ db_ze · db_market42 · db_emp07 …  │         │ db_rede_xpto (~1 TB, particionada)│
  │ PITR da INSTÂNCIA (WAL comum)     │         │  PITR dedicado (WAL próprio)      │
  │ + dump lógico POR BANCO (restore  │         │  + read replica dedicada          │
  │   de 1 tenant sem tocar vizinhos) │         │  + dump por período/loja          │
  └──────────────────────────────────┘         └──────────────────────────────────┘
```

### A tensão do empacotamento: restaurar UM sem tocar os vizinhos

O PITR físico (WAL) é **da instância** — restaurar a instância restaura **todos** os bancos nela. Mas o requisito é restaurar **um** tenant. Resolução em camadas:

- **Dump lógico por banco** (`pg_dump db_ze`) para restaurar **um** tenant pontualmente, sem mexer nos vizinhos da mesma instância — RPO maior (frequência do dump), mas granularidade de 1 tenant.
- **PITR físico da instância** para recuperação de desastre da instância inteira (perda de hardware) — RPO baixo (WAL contínuo), granularidade de instância.
- **Restore cirúrgico:** para "voltar um tenant a um ponto no tempo" sem PITR da instância inteira, restaura-se a instância **num servidor temporário**, extrai-se o banco daquele tenant naquele ponto, e reimporta-se só ele. Caro mas pontual — usado quando o dump lógico não tem o RPO necessário.

> Esse trade-off é a razão de **grande = instância dedicada**: nele, PITR da instância **é** PITR do tenant (um banco por instância), então recuperação pontual e DR coincidem. No pequeno, aceita-se o dump lógico como o caminho de restore de 1 tenant.

---

## Read replicas

A replica (ADR-005/007) tira a leitura pesada do primário — relatório, SPED, BI leem dela; o PDV e o OLTP ficam no primário com latência previsível.

- **Replicação automática (streaming)**, mesmo schema — não é CQRS. O roteamento decide: escrita e leitura operacional no primário; leitura analítica na replica ([../01-architecture/workload-tiers.md](../01-architecture/workload-tiers.md), `forTenantRead()`).
- **Dedicada no grande**, compartilhada/sob demanda no pool dos pequenos.
- **Lag de replicação é monitorado** (ver [monitoramento](#monitoramento-por-tenant) e [observability.md](observability.md)). Leitura que **não pode** tolerar lag (ex.: confirmar um saldo que acabou de mudar) vai ao primário — o roteamento sabe disso. Replica é para o analítico, que tolera segundos de atraso.
- **Replica como capacidade de pico:** subir réplicas extras na véspera do SPED é parte do plano de dia pesado ([../01-architecture/heavy-days-thundering-herd.md](../01-architecture/heavy-days-thundering-herd.md)).

---

## Backup por tenant + PITR

O backup segue o db-per-tenant: **por cliente**, recuperável **por cliente**.

```
  CAMADAS DE BACKUP
  1. WAL contínuo (PITR)         → archiving do WAL p/ object storage; recupera a QUALQUER segundo
  2. Base backup periódico        → snapshot físico da instância (base do PITR)
  3. Dump lógico por banco        → pg_dump por tenant; restore de 1 cliente sem tocar vizinhos
  4. Cópia off-site (DR)          → backup replicado p/ outra região/sítio (ver DR abaixo)
```

- **PITR (Point-In-Time Recovery).** WAL arquivado continuamente → recupera-se a instância (ou um tenant, via restore cirúrgico) a **qualquer ponto** dentro da janela — antes de um `DELETE` errado, antes de uma migration ruim. É a **rede de segurança do contract destrutivo** ([ci-cd-zero-downtime.md](ci-cd-zero-downtime.md)).
- **Dump lógico por tenant** dá a granularidade de "restaurar só o cliente X".
- **Backup testado, não presumido.** Backup que nunca foi restaurado é uma hipótese. **Restore drill** periódico: pega-se um tenant aleatório, restaura-se num ambiente isolado, valida-se integridade (contagens, último cupom, último SPED). Sem drill, o RPO/RTO é ficção.
- **Imutabilidade do backup.** Cópias com object-lock/retention para sobreviver a ransomware/erro humano (alguém apagar o backup junto). Casado com o object storage fiscal ([infrastructure.md](infrastructure.md)).

---

## DR + RPO/RTO

DR é "perdi um sítio/instância inteira; em quanto tempo e com quanta perda eu volto?".

- **RPO (Recovery Point Objective)** — quanto dado se aceita perder. Com PITR/WAL archiving contínuo, RPO é **segundos a poucos minutos** (o atraso do archiving). O alvo do RPO varia por tier — o grande/fiscal exige RPO apertado; um pequeno tolera mais.
- **RTO (Recovery Time Objective)** — em quanto tempo se volta a operar. Função do tamanho do banco e do método: dump lógico de 5 GB volta em minutos; restore de 1 TB + replay de WAL leva mais — por isso o grande tem replica/standby que **promove** rápido (RTO curto) em vez de restaurar do zero.

```
  RPO / RTO por tier (alvos — afinar com o cliente e com dado real)
  ┌──────────┬──────────────────────┬──────────────────────────────────────────┐
  │ tier     │ RPO (perda aceitável)│ RTO (tempo p/ voltar)                      │
  ├──────────┼──────────────────────┼──────────────────────────────────────────┤
  │ pequeno  │ minutos (PITR inst.) │ minutos (dump lógico) — blast radius=1     │
  │ grande   │ segundos (WAL)       │ curto — PROMOVER standby/replica, não      │
  │ /fiscal  │                      │ restaurar do zero                          │
  └──────────┴──────────────────────┴──────────────────────────────────────────┘
```

- **Cópia off-site/cross-region** do WAL e dos base backups — DR não vale se backup e primário morrem no mesmo incêndio.
- **Standby promovível** no grande: uma replica em outro sítio que vira primário em falha — RTO em minutos, não horas.
- **Runbook de DR ensaiado.** O passo-a-passo de "promover standby / restaurar / repontar o registry / re-credenciar edges" é escrito e **ensaiado** (game day), não improvisado no incidente. Repontar o registry de tenant ([../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md)) é parte do runbook — depois do restore, o `tenantId → host` tem de apontar para o lugar certo.

> **DR é por tenant também.** Como cada cliente é um banco, dá para ter **políticas de DR diferentes por tier** sem complicar: o grande/fiscal com standby cross-region e RPO de segundos; o pequeno com PITR + dump e RPO de minutos. Não se paga DR de banco-crítico para 900 mercadinhos — paga-se onde o risco está.

---

## Retenção fiscal legal de 5 anos

A lei fiscal-BR exige guarda mínima de documentos e escrituração (tipicamente **5 anos**, conferir tributo/UF). Onde cada coisa mora:

| Dado | Onde | Retenção |
|---|---|---|
| **XML autorizado** (NFC-e/NF-e), DANFE/cupom PDF, arquivo SPED gerado | **object storage** com object-lock (WORM) | **5 anos**, imutável ([infrastructure.md](infrastructure.md)) |
| **Metadado/índice** do documento (chave, status, protocolo SEFAZ) | Postgres do tenant | enquanto o documento exigir (≥ janela legal) |
| **Movimento que compõe a apuração** | Postgres do tenant (particionado por período no grande) | dentro da janela legal; partições antigas arquivadas/comprimidas, **não** apagadas dentro do prazo |

- **A retenção é uma policy, não um cron de `DELETE`.** Nada que está dentro da janela legal é apagado — nem por housekeeping, nem por admin. O object-lock impede; o particionamento por período permite **arquivar/comprimir** o frio sem perder.
- **O documento fiscal vive no object storage, não no banco.** O banco guarda índice; o XML pesado mora no storage barato e imutável — desafoga o Postgres e cumpre a retenção de forma auditável.
- **Expurgo só fora da janela.** Passados os 5 anos (e qualquer obrigação acessória pendente), o lifecycle do bucket pode mover para storage mais frio ou expurgar — **com trilha de auditoria**.

---

## Particionamento dos grandes (por loja/período)

No tenant grande (~1 TB), as tabelas de movimento crescem sem teto. Particionamento nativo do Postgres (modelo em [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md)); aqui o **lado operacional**:

- **Por período** (`RANGE` em data) — o analítico/SPED consulta por competência; partições antigas viram candidatas a **arquivamento/compressão**; o `VACUUM` não varre a tabela inteira; criar a partição do mês seguinte é rotina automatizada.
- **Por loja** (`LIST`/`HASH` em `store_id`) — isola I/O por filial em redes com muitas lojas; consultas filtradas por loja **podam** partição.
- **Composto** — `RANGE(período)` + subpartição `LIST(store_id)` no caso extremo.

```sql
-- rotina: criar a partição do PRÓXIMO mês antes de virar (automatizada no worker)
CREATE TABLE IF NOT EXISTS venda_2026_07 PARTITION OF venda
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- housekeeping: comprimir/destacar partição antiga (DENTRO da retenção — nunca dropar no prazo)
ALTER TABLE venda DETACH PARTITION venda_2021_01 CONCURRENTLY;  -- arquiva, não apaga
```

- **Manutenção por partição.** `VACUUM`/`ANALYZE`/reindex rodam por partição (barato) em vez da tabela monstro. Índice novo entra `CONCURRENTLY` por partição.
- **Decida a chave com dado, não no escuro.** Qual chave (loja? período? composto?) depende de **volume real, cardinalidade de `store_id` e os planos** das consultas que dominam — medidos com [MCP de Postgres](#decidir-com-o-mcp-de-postgres-nunca-no-escuro). Particionar errado é pior que não particionar.

---

## Capacidade para os dias pesados

O SPED tem o mesmo prazo para todos → pico correlacionado por lei ([../01-architecture/heavy-days-thundering-herd.md](../01-architecture/heavy-days-thundering-herd.md)). O lado de banco do plano:

- **Read replica absorve o analítico** — o SPED lê da replica, o primário segue servindo o PDV. No grande, replica dedicada.
- **Rollups pré-agregados** (ADR-007) — a base do SPED é construída **incrementalmente** ao longo do mês em materialized views; no dia do prazo, gerar é **ler agregado + formatar**, não recalcular o mês. Menos I/O no pico.
- **Autoscaling agendado** — subir réplicas de worker e a replica **na véspera** da janela (o calendário é conhecido) e descer depois (FinOps).
- **Stagger por instância** — não disparar a apuração de 50 bancos da mesma instância ao mesmo tempo; espalhar para não saturar I/O compartilhado.
- **Janela própria do grande** — db-per-tenant permite agendar o pesado do tenant grande na janela dele, fora do horário dos vizinhos.

---

## Monitoramento por tenant

Saúde de banco é **por tenant** e **por instância** (detalhe de métricas/alertas em [observability.md](observability.md)):

| O que medir | Por quê | Sinal de alerta |
|---|---|---|
| **Lag de replicação** (por replica) | leitura analítica fica velha; SPED lê dado atrasado | lag > limiar → roteia leitura crítica ao primário; investiga |
| **Conexões / saturação de pool** (por instância) | N réplicas × M tenants estoura conexões | perto do `max_connections` → PgBouncer/ajuste |
| **Tamanho por banco + crescimento** | detectar o pequeno que virou médio/grande | crescimento → **promover de tier** (mover para dedicada) |
| **Idade do backup / último PITR válido** | backup velho = RPO real pior que o prometido | sem backup recente → alerta crítico |
| **Bloat / dead tuples / VACUUM atrasado** | degrada plano e espaço | autovacuum atrás → tuning por partição |
| **Slow queries / planos ruins** | regressão de performance por tenant | EXPLAIN via MCP, índice ([../02-stack-and-standards/performance-playbook.md](../02-stack-and-standards/performance-playbook.md)) |
| **`schema_version` por tenant** | quantos dos 900 estão em N (migration runner) | divergência prolongada → tenant preso na migration |

> **Promover de tier é decisão operacional, não de código.** O monitor flagra "db_market42 cresceu de 5 GB para 200 GB e disputa I/O no SPED". A resposta é **mover o banco** para uma instância própria/dedicada + replica — operação de ops (dump/restore ou réplica lógica + repontar registry), sem tocar o app (ADR-002, [../01-architecture/deployment-topologies.md](../01-architecture/deployment-topologies.md)).

---

## Decidir com o MCP de Postgres (nunca no escuro)

Toda decisão estrutural de banco — **índice, particionamento, escolha de instância para empacotar, promoção de tier** — é **informada por dado real**, via **MCP de Postgres** ([../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md)). É a aplicação direta da disciplina do Apollo ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)).

O que o MCP inspeciona antes de a operação decidir:

- **Volume e crescimento** por tabela/banco (`pg_total_relation_size`, séries históricas) → empacotamento e promoção de tier.
- **Cardinalidade** de candidatas a chave de partição (`store_id`, período) → escolher `LIST`/`RANGE`/`HASH` com base real.
- **Índices existentes e uso** (`pg_stat_user_indexes`) → não criar índice redundante; achar índice morto que só pesa na escrita.
- **Planos (`EXPLAIN ANALYZE`)** das queries que dominam → confirmar que a SQL reconstruída ([../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md)) usa índice, não seq scan.
- **Saturação** (conexões, locks, I/O) → escolher a instância com folga para empacotar o próximo pequeno (entra no [provisioner](infrastructure.md)).

```
-- via MCP de Postgres, ANTES de particionar/indexar (exemplos)
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;

SELECT count(DISTINCT store_id) AS lojas, count(*) AS linhas FROM venda;  -- cardinalidade p/ chave

EXPLAIN (ANALYZE, BUFFERS)                       -- plano real antes de criar índice
SELECT … FROM venda WHERE store_id = 3 AND data_mov >= '2026-06-01';
```

> Particionar/indexar **no escuro** é o anti-padrão que o playbook proíbe. Mede-se primeiro (MCP), decide-se com o número, e **prova-se** com o plano. O mesmo MCP que valida a paridade da SQL valida a decisão de infra.

---

## Ver também

- [infrastructure.md](infrastructure.md) — as instâncias Postgres, object storage fiscal e provisioner que esta página opera.
- [ci-cd-zero-downtime.md](ci-cd-zero-downtime.md) — o migration runner (expand/contract) e o PITR como rede de segurança do contract.
- [observability.md](observability.md) — métricas e alertas de banco por tenant (lag, conexões, backup, schema_version).
- [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) — o modelo de empacotamento e particionamento que esta página executa.
- [../01-architecture/heavy-days-thundering-herd.md](../01-architecture/heavy-days-thundering-herd.md) — capacidade para o pico de SPED.
- [../02-stack-and-standards/performance-playbook.md](../02-stack-and-standards/performance-playbook.md) — índices e EXPLAIN (decididos via MCP).
- [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) — o MCP de Postgres para inspecionar e decidir com dado real.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-003/004/005/007.
