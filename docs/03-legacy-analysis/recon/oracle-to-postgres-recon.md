# Oracle→PostgreSQL — aterramento por dados reais (ADR-011)

> Insumo de recon para a sub-migração canônica ([../../05-migration-engineering/oracle-to-postgres.md](../../05-migration-engineering/oracle-to-postgres.md)): os tipos, sequences, views e **triggers reais** de um schema-cliente completo (`pinheirao@dbhomologacao`), para dimensionar o esforço sem chute. **Refina** a premissa anterior de que "a lógica está só no Delphi": packages/procs são leves, **mas há ~81 triggers de lógica por schema** que precisam de destino.

## Pré-requisitos de leitura

- [../../00-orientation/canonical-decisions.md](../../00-orientation/canonical-decisions.md) — **ADR-011** (Oracle→Postgres).
- [../../05-migration-engineering/oracle-to-postgres.md](../../05-migration-engineering/oracle-to-postgres.md) — o doc canônico que isto alimenta.
- [mapa-reconhecimento.md §E](mapa-reconhecimento.md) — volume e objetos por schema.

---

## 1. Tipos de coluna (1 schema = `PINHEIRAO`)

| Tipo Oracle | Qtd | → PostgreSQL | Cuidado |
|---|---|---|---|
| `NUMBER` | 11.645 | ver quebra abaixo | a maior decisão de tipo |
| `VARCHAR2` | 6.072 | `varchar`/`text` | trivial |
| `CHAR` | 2.608 | `char`/`varchar` + **enum** | muitos são flags 'S'/'N' → boolean/enum ([business-rule-extraction](../business-rule-extraction.md)) |
| `TIMESTAMP(6)` | 1.451 | `timestamp(6)` / `timestamptz` | decidir TZ (fuso de loja) |
| `DATE` | 460 | `date`/`timestamp` | Oracle `DATE` tem hora — não é só data |
| `CLOB` | 80 | `text` | ok |
| `BLOB` | 28 | `bytea` / object storage | imagens/anexos |
| `UNDEFINED` | 13 | — | **investigar** (tipo de objeto/UDT?) |
| `TIME(0)` | 6 | `time` | raro |
| `ROWID` | 4 | **remover** | sem equivalente PG — refatorar uso |
| `INTERVAL DAY TO SECOND` | 3 | `interval` | raro |

### `NUMBER` — a quebra que define int vs decimal
| Subtipo | Qtd | → PG |
|---|---|---|
| `NUMBER` escala=0 (**inteiro**) | 6.462 | `integer`/`bigint` |
| `NUMBER` escala>0 (**decimal**) | 4.510 | `numeric` — **dinheiro/percentual** (nunca float, [business-rule-extraction](../business-rule-extraction.md)) |
| `NUMBER` **sem escala** (ambíguo) | 673 | `numeric` (seguro) — revisar caso a caso |

> O legado usa `NUMBER(22)` como "número genérico" (visto em BANCOS, PARCEIROS). A migração precisa **classificar** cada um: chave/contador → `integer/bigint`; dinheiro/alíquota → `numeric(p,s)`. Os 673 sem escala são o grupo de risco (decidir por uso).

---

## 2. Objetos de schema (a converter, por schema)

| Objeto | Qtd | Destino no alvo |
|---|---|---|
| **Sequences** | 522 | `GENERATED … AS IDENTITY` / `sequence` PG — 1:1, mas em massa (×N tenants) |
| **Views** | 436 (**397 são `GET_*`**) | as `GET_<TABELA>` viram as **queries de listagem** dos recursos ([form-base-cadmaster](form-base-cadmaster.md)); as demais (39) são views de relatório/join — reescrever em SQL PG |
| **Triggers** | 116 | **ver §3 — não é trivial** |
| **Procedures** | 24 | portar PL/SQL → SQL/PLpgSQL ou service |
| **Functions** | 12 | idem |
| **Packages** | 0 | nada (alívio real) |
| Colunas com `DEFAULT` | 90 | mapear `SYSDATE`→`now()`, sequence→`nextval`/identity |

---

## 3. Triggers — o ponto que **refina** "lógica só no Delphi"

116 triggers por schema, em **três famílias** com destinos diferentes:

| Família | ~Qtd | O que faz | Destino no alvo |
|---|---|---|---|
| **`REM_*`** (replicação) | 35 | CDC → outbox `REMESSA_SERVER` | **outbox/event explícito no service** (não trigger), por terminal, idempotente ([mapa §D](mapa-reconhecimento.md)) |
| **`AUDIT_*`** (auditoria) | dezenas | grava trilha em I/U/D (ex.: `AUDIT_APAGAR`, `AUDIT_ARECEBER`, `AUDIT_AGENDAPROMOCAOITENS`) | **audit log/interceptor** no app (ou trigger PG genérica) |
| **`ATUALIZA_*`** (lógica/denormalização) | vários | mantêm dados derivados/denormalizados (ex.: `ATUALIZAPROD`, `ATUALIZATRIBUTOS`, `ATUALIZA_VENDAS`, `ATUALIZA_PEDIDOS`, `ATUALIZA_CUSTO_COTACAO`, `ATUALIZA_HISTORICO_DINAMICO`) | **regra → service** ([business-rule-extraction](../business-rule-extraction.md)); caso a caso pode virar trigger PG, mas a tese é regra no service |

> **Correção a registrar:** packages/procs são leves (0 packages, 24 procs, 12 funcs), **mas os ~81 triggers não-replicação carregam regra de negócio e auditoria**. A afirmação "a lógica está toda no Delphi" vale para o grosso, **não** para esses triggers — eles são uma **fonte adicional de regra** a extrair (como o `.pas`), e cada `ATUALIZA_*` deve ser lido e portado para o service com teste de paridade. Subestimá-los quebra paridade silenciosamente (efeito-fantasma, igual ao `REM_BANCOS`).

---

## 4. Dimensionamento (multiplicar por tenant)

Por schema-cliente: ~830 tabelas, ~11,6k colunas, **522 sequences**, **436 views**, **116 triggers**, ~36 procs/funcs. Como a migração é **db-per-tenant** ([ADR-003](../../00-orientation/canonical-decisions.md)) sobre **~25–35 tenants ativos** ([mapa §E](mapa-reconhecimento.md)), o trabalho **estrutural** (DDL+sequences+views+triggers) é **automatizável uma vez** (o schema-modelo `METADADOSSICOM`) e **replicado por tenant**; o trabalho **de regra** (triggers `ATUALIZA_*`, procs/funcs) é **único** (feito uma vez, vale para todos). Os **dados** é que escalam por tenant (volume — [mapa §E](mapa-reconhecimento.md)).

> Estratégia: (1) converter o **schema-modelo** uma vez (estrutura), (2) extrair a regra dos **triggers `ATUALIZA_*` + procs/funcs** uma vez (para services, com paridade), (3) migrar **dados por tenant** (expand/contract, [ADR-009](../../00-orientation/canonical-decisions.md)).

## Pendências

- Investigar os 13 `UNDEFINED` (tipos de objeto/UDT?) e os 4 `ROWID` (onde são usados).
- Ler o corpo de cada `ATUALIZA_*` (regra) — tratar como `.pas`: extrair condicional, porquê, paridade.
- Survey multi-tenant dos tipos (a quebra acima é de 1 schema; confirmar consistência).

## Ver também

- [../../05-migration-engineering/oracle-to-postgres.md](../../05-migration-engineering/oracle-to-postgres.md) — o doc canônico (ADR-011).
- [mapa-reconhecimento.md](mapa-reconhecimento.md) §D/§E · [form-base-cadmaster.md](form-base-cadmaster.md) (views `GET_*`) · [../business-rule-extraction.md](../business-rule-extraction.md) (triggers de regra).
