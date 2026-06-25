# Performance Playbook — ADR-007

> Como o Apollo escala a leitura e o processamento pesado **sem** CQRS pesado: keyset/cursor, índices decididos com EXPLAIN (não no escuro), zero N+1, rollups/materialized views incrementais, streaming de export, particionamento no tenant grande, pooling, e roteamento de leitura pesada para a read replica.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-007** (read replica + rollups, não CQRS), ADR-005 (worker tier), ADR-004 (instâncias por porte).
- [backend-nestjs-standards.md](backend-nestjs-standards.md) — `DatabaseProvider.forTenantRead()` e o query builder.
- [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) — **MCP de Postgres** para `EXPLAIN`/schema/cardinalidade.

---

## ADR-007 em uma frase

Leitura escala com **read replica** (mesmo schema, replicação automática) + **rollups/materialized views** para relatório. **Nada** de CQRS com modelo de leitura mantido por eventos. O cenário Y+B (dois clientes grandes processando pesado ao mesmo tempo) **não pode degradar PDV/telas** — por isso o pesado vai para worker tier (ADR-005) e read replica.

---

## Regra-mãe: nunca decida estrutura de banco no escuro

Índice, particionamento e plano de query se decidem **com dados reais**, via o **MCP de Postgres** ([../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md)): `EXPLAIN (ANALYZE, BUFFERS)`, cardinalidade, tamanho da tabela, índices existentes. Chutar índice é como migrar olhando a tela — superfície, não substância (a tese central, [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md)).

```sql
-- Antes de criar QUALQUER índice: meça. (rodar via MCP de Postgres na réplica/staging do tenant)
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT v.id, v.data_venda, v.valor_total
FROM venda v
WHERE v.id_empresa = 42
  AND v.data_venda >= DATE '2026-01-01'
ORDER BY v.data_venda DESC, v.id DESC
LIMIT 50;
-- Procure: Seq Scan em tabela grande, Sort caro, Rows Removed by Filter alto,
-- estimativa vs real divergente (estatística desatualizada).
```

```sql
-- Só DEPOIS de ver o plano, o índice que casa o filtro + a ordenação do keyset:
CREATE INDEX CONCURRENTLY idx_venda_emp_data_id
  ON venda (id_empresa, data_venda DESC, id DESC);
-- CONCURRENTLY: não trava a tabela em produção (deploy zero-downtime, ADR-009).
```

> Critério de aceite de um índice: o `EXPLAIN` **depois** mostra Index Scan no lugar do Seq Scan e o custo cai. Registre o plano antes/depois no dossiê.

---

## Paginação: keyset/cursor, nunca OFFSET

`OFFSET N` faz o Postgres **varrer e descartar** N linhas — custo cresce com a página. Em tabela grande (venda, item de venda, movimento de estoque) isso degrada do nada. Use **keyset** (seek pelo último registro visto), que usa o índice e tem custo constante.

### Errado (offset) vs certo (keyset)

```sql
-- ❌ OFFSET: página 10.000 varre 500.000 linhas pra jogar fora
SELECT * FROM venda WHERE id_empresa = 42
ORDER BY data_venda DESC, id DESC
LIMIT 50 OFFSET 500000;

-- ✅ KEYSET: continua DEPOIS do último (data,id) visto — usa o índice, custo constante
SELECT id, data_venda, valor_total FROM venda
WHERE id_empresa = 42
  AND (data_venda, id) < (DATE '2026-03-10', 988123)  -- cursor da página anterior
ORDER BY data_venda DESC, id DESC
LIMIT 50;
```

### No NestJS + Kysely (o contrato de cursor que o frontend consome)

```ts
// repository — cursor opaco (base64 de {data,id}); o frontend só repassa
async listarVendas(empresaId: number, limit = 50, cursor?: VendaCursor) {
  let q = this.dbp.forTenantRead()                 // read replica (ADR-007)
    .selectFrom('venda')
    .select(['id', 'data_venda', 'valor_total'])
    .where('id_empresa', '=', empresaId)
    .orderBy('data_venda', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1);                             // +1 p/ saber se há próxima página

  if (cursor) {
    // (data_venda, id) < (cursor.data, cursor.id) — tupla, casa o índice composto
    q = q.where(({ eb, refTuple, tuple }) =>
      eb(refTuple('data_venda', 'id'), '<', tuple(cursor.data, cursor.id)),
    );
  }

  const rows = await q.execute();
  const hasNext = rows.length > limit;
  const page = hasNext ? rows.slice(0, limit) : rows;
  const next = hasNext ? encodeCursor(page.at(-1)!) : null;
  return { rows: page, nextCursor: next };
}
```

O frontend (React Query) repassa `nextCursor` no `queryKey` — ver [frontend-react-standards.md](frontend-react-standards.md).

---

## Evitar N+1

O Delphi disparava query por linha no `OnScroll`/`AfterScroll` do grid — N+1 nativo. No alvo, **uma** query com `JOIN`/agregação, ou batch por chave. Nunca um loop de `await query` por item.

```ts
// ❌ N+1: uma query por venda para pegar a quantidade de itens
for (const v of vendas) {
  v.qtdItens = await repo.contarItens(v.id);      // N round-trips
}

// ✅ uma query agrega tudo
const counts = await db.selectFrom('item_venda')
  .select(['id_venda', db.fn.count('id').as('qtd')])
  .where('id_venda', 'in', vendas.map(v => v.id))
  .groupBy('id_venda')
  .execute();
// ... ou já no JOIN da query original (LEFT JOIN LATERAL / subquery agregada)
```

> Sintoma típico no `EXPLAIN`/logs: o mesmo `SELECT` repetido centenas de vezes com parâmetro diferente. Cace isso no MCP de Postgres (log de queries) durante a captura de runtime — ver [../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md).

---

## Rollups / materialized views incrementais para relatório

Relatório **não** lê a tabela transacional crua. Lê **rollups** pré-agregados (ADR-007). Em vez de `REFRESH MATERIALIZED VIEW` (recomputa tudo — caro), use **rollup incremental**: o worker tier ([backend-nestjs-standards.md](backend-nestjs-standards.md)) acumula deltas por período/loja.

```sql
-- tabela de rollup: venda agregada por loja/dia (lida pelos relatórios)
CREATE TABLE rollup_venda_dia (
  id_empresa  int  NOT NULL,
  id_loja     int  NOT NULL,
  dia         date NOT NULL,
  qtd_vendas  int  NOT NULL,
  valor_total numeric(14,2) NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id_empresa, id_loja, dia)
);

-- upsert incremental do delta de UM dia (job BullMQ, não recomputa o histórico)
INSERT INTO rollup_venda_dia (id_empresa, id_loja, dia, qtd_vendas, valor_total)
SELECT id_empresa, id_loja, data_venda::date, count(*), sum(valor_total)
FROM venda
WHERE id_empresa = $1 AND data_venda::date = $2
GROUP BY id_empresa, id_loja, data_venda::date
ON CONFLICT (id_empresa, id_loja, dia)
DO UPDATE SET qtd_vendas = EXCLUDED.qtd_vendas,
              valor_total = EXCLUDED.valor_total,
              atualizado_em = now();
```

```ts
// jobs/rollup.processor.ts — recalcula só o dia tocado, agendado pela fila
@Process('rollup-venda-dia')
async handle(job: Job<{ tenantId: string; loja: number; dia: string }>) {
  return tenantStore.run({ tenantId: job.data.tenantId }, () =>
    this.repo.upsertRollupVendaDia(job.data.loja, job.data.dia), // o SQL acima
  );
}
```

> Materialized view "clássica" só onde o recompute é barato e a latência tolerável. Para volume alto, **rollup incremental por evento de fechamento** é a regra. Detalhe operacional (agendamento, reprocesso) em [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md).

---

## Streaming para export grande

Export de relatório/SPED grande **não** materializa um array gigante na memória do Node. Faz **streaming** do cursor do Postgres direto para a resposta/arquivo, em lotes — roda no worker tier, lê da réplica.

```ts
// export CSV em streaming (cursor server-side; memória constante)
import { from as copyFrom } from 'pg-copy-streams';

async exportarVendasCsv(empresaId: number, res: Writable) {
  const conn = await this.pool.connect();
  try {
    const cursor = conn.query(new Cursor(
      `SELECT id, data_venda, valor_total FROM venda WHERE id_empresa = $1
       ORDER BY data_venda, id`, [empresaId]));
    res.write('id,data_venda,valor_total\n');
    let batch;
    while ((batch = await cursor.read(1000)).length) {     // lotes de 1000 linhas
      for (const r of batch) res.write(`${r.id},${r.data_venda.toISOString()},${r.valor_total}\n`);
    }
  } finally { conn.release(); }
}
```

> Ou `COPY (…) TO STDOUT WITH CSV` via `pg-copy-streams` para o caminho mais rápido. O ponto: **memória constante**, não O(linhas).

---

## Particionamento por loja/período no tenant grande

No tenant grande (1TB, instância dedicada — ADR-004), tabelas transacionais quentes (venda, item_venda, movimento_estoque) particionam por **período** (e por **loja** quando a cardinalidade justifica). Decida com o MCP de Postgres (tamanho/distribuição) — não particione tabela pequena, é overhead à toa.

```sql
-- particionamento por RANGE de data (mensal) — poda partições antigas do plano
CREATE TABLE venda (
  id bigserial, id_empresa int, id_loja int,
  data_venda timestamptz NOT NULL, valor_total numeric(14,2)
) PARTITION BY RANGE (data_venda);

CREATE TABLE venda_2026_06 PARTITION OF venda
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
-- consulta com filtro de data faz partition pruning -> varre só o mês relevante

-- sub-partição por LISTA de loja dentro do mês, no tenant multi-loja gigante:
CREATE TABLE venda_2026_06 PARTITION OF venda
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01')
  PARTITION BY LIST (id_loja);
```

> Pré-requisito do pruning: o filtro tem que bater na **chave de partição** (`data_venda`/`id_loja`). Sem isso, o particionamento não ajuda — confirme no `EXPLAIN` que partições foram podadas.

---

## Connection pooling

ADR-004: **uma frota stateless**, **pool por tenant/banco** ([backend-nestjs-standards.md](backend-nestjs-standards.md)). Pool por instância tem teto (`max` conexões); com muitos tenants, um **pooler externo (PgBouncer em transaction mode)** fica entre app e Postgres para não estourar `max_connections` do servidor.

```ts
// pool com limites sãos; em prod, atrás de PgBouncer (transaction pooling)
new Pool({
  host, database: tenantDb, max: 10,        // por instância; some entre as instâncias!
  idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000,
  // statement_timeout p/ não segurar conexão em query travada
  options: '-c statement_timeout=30000',
});
```

> Conta de capacidade: `instâncias × pool.max ≤ max_connections` (ou o limite do PgBouncer). Detalhe em [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md).

---

## Evitar SELECT \*

`SELECT *` traz colunas que você não usa (incluindo `TEXT`/`JSONB` gordos), quebra **index-only scan** e infla I/O e payload. Liste as colunas — o query builder já força isso ([backend-nestjs-standards.md](backend-nestjs-standards.md)).

```ts
// ❌ .selectAll()  →  ✅ só o necessário (habilita index-only scan)
db.selectFrom('produto').select(['id', 'codigo', 'descricao', 'preco_venda']);
```

---

## Operações em lote

Insert/update de muitas linhas (importação, consolidação do PDV offline) em **uma** instrução, não em loop. E DML pesado em **chunks** para não segurar transação longa/lock gigante.

```ts
// ✅ insert em lote (multi-row) — 1 round-trip por chunk
const chunks = chunk(itens, 1000);
for (const c of chunks) {
  await db.insertInto('item_venda').values(c).execute();     // 1000 linhas por instrução
}
```

```sql
-- update em massa em chunks, evitando lock e bloat de transação longa
UPDATE produto SET preco_venda = preco_venda * 1.05
WHERE id_empresa = 42 AND id IN (SELECT id FROM produto WHERE id_empresa = 42
  AND id > $ultimo ORDER BY id LIMIT 5000);   -- itera por keyset até esgotar
```

---

## Roteamento de leitura pesada para read replica

ADR-007: leitura operacional crítica → primário; **leitura pesada (relatório, consulta ampla, export) → read replica**. O `DatabaseProvider` expõe os dois caminhos; o repositório escolhe conscientemente.

```ts
// caminho consciente: forTenant() = primário | forTenantRead() = réplica
class RelatorioRepository {
  constructor(private dbp: DatabaseProvider) {}
  // relatório/export: réplica, tolera o lag de replicação
  curvaAbc(empresaId: number) { return this.dbp.forTenantRead().selectFrom('rollup_venda_dia')/* … */; }
}
class VendasRepository {
  // registrar venda lê-e-escreve no MESMO request: primário (consistência forte)
  saldoParaVenda(produtoId: number) { return this.dbp.forTenant().selectFrom('estoque')/* … */; }
}
```

> Cuidado com **read-after-write**: se um fluxo escreve e logo lê o que escreveu, leia do **primário** (a réplica tem lag). Roteie para a réplica só o que tolera dados levemente atrasados (relatório, listas amplas). Errar isso vira bug de "sumiu o que acabei de salvar".

---

## Tabela resumo (decisões de performance)

| Problema | Solução travada (ADR-007) | Anti-solução |
|----------|---------------------------|--------------|
| Página de tabela grande | Keyset/cursor (tupla + índice composto) | `OFFSET N` |
| "Será que precisa de índice?" | `EXPLAIN (ANALYZE, BUFFERS)` via MCP de Postgres | Criar índice no chute |
| Query por linha do grid | JOIN/agregação/batch | N+1 no `OnScroll` |
| Relatório lento | Rollup/MV **incremental** no worker tier | Agregar a tabela crua a cada request |
| Export gigante | Streaming (cursor/COPY) em lotes | Carregar tudo na memória do Node |
| Tabela transacional gigante | Particionar por período/loja (com pruning) | Tabela única de 1TB sem partição |
| Muitos tenants/conexões | Pool por tenant + PgBouncer | Conexão por request sem limite |
| Payload/I/O inflado | Selecionar colunas (sem `SELECT *`) | `selectAll()` por preguiça |
| Carga pesada na hora de pico | Worker tier + read replica (ADR-005) | Job pesado na API interativa |

---

## Ver também

- [backend-nestjs-standards.md](backend-nestjs-standards.md) — `DatabaseProvider`, worker role, query builder.
- [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) — **MCP de Postgres** para EXPLAIN/schema/cardinalidade.
- [../01-architecture/workload-tiers.md](../01-architecture/workload-tiers.md) — API/worker/replica (ADR-005) e o cenário Y+B.
- [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md) — pooling, réplica, particionamento na operação.
- [frontend-react-standards.md](frontend-react-standards.md) — consumo do cursor no React Query.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-007 e correlatos.
