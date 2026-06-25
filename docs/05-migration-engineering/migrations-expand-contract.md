# Migrations: Expand/Contract por Tenant

> O arquivo-coroa da engenharia de migração. Como evoluir o schema de **900 bancos** que migram cada um no seu tempo, com PDVs no campo pinados em versões antigas, **sem downtime e sem quebrar ninguém** — via expand/contract (parallel change), DDL online, um migration runner em lote, e a regra cultural mais difícil: o código suporta só **uma janela de versão (N e N-1)**, e aposentar o suporte velho é um passo **ativo**.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-009** (zero-downtime, expand/contract, janela de 1 versão), ADR-003 (db-per-tenant), ADR-004 (pool no compute), ADR-008 (PDV offline pinado).
- [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) — cada cliente é um banco; a tabela de migrations vive em **cada** banco.
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — por que o PDV fica em versão antiga por dias/semanas.
- [versioning-and-compatibility.md](versioning-and-compatibility.md) — o contrato de API/sync que esta mecânica de schema espelha.

## O fato de vida: versão de schema POR TENANT

> **Cada cliente tem seu banco (ADR-003), e cada banco tem sua própria tabela de migrations.** Não existe "a versão do schema". Existe a versão do schema **daquele** tenant.

Durante um rollout, isso significa — inevitavelmente — que **uns tenants estão na vN e outros na vN+1 ao mesmo tempo**. Não é um estado transitório de segundos; com 900 bancos, o rollout leva horas ou dias (em lote, monitorado, com pausa se algo falhar). E essa é a vida **normal**, não um acidente.

```
  Em qualquer instante durante um rollout:

  db_ze          schema v37   ┐
  db_padaria     schema v37   │  já migraram (lote 1)
  db_market42    schema v37   ┘
  db_rede_abc    schema v36   ┐
  db_emp07       schema v36   │  ainda não (lote 3, amanhã)
  db_rede_xpto   schema v36   ┘  (1TB — janela de baixa própria)

  E A MESMA frota stateless de app (ADR-004) atende TODOS eles.
```

Duas consequências que comandam tudo nesta página:

1. **A mesma build de aplicação tem de funcionar contra v36 E v37.** A app não pode assumir "a coluna nova existe" — alguns bancos ainda não têm. Daí o **expand/contract**.
2. **Não existe mais "trocar todos os exes na mesma janela".** No Delphi client-server, mudava-se o schema e trocavam-se todos os executáveis numa madrugada. Acabou. Esta é a maior mudança cultural do projeto (ADR-009).

A tabela de migrations em cada banco:

```sql
-- existe DENTRO de cada banco de tenant
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     bigint      PRIMARY KEY,        -- ex.: 20260623_1430
  name        text        NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text        NOT NULL,           -- runner/host que aplicou
  checksum    text        NOT NULL,           -- hash do script (detecta drift)
  phase       text        NOT NULL            -- 'expand' | 'contract'
);
```

## Expand/Contract (parallel change) — o padrão

A regra de ouro: **uma mudança de schema nunca é destrutiva no lugar.** Toda evolução vira uma sequência onde, a cada passo, o schema é compatível com a versão de código anterior **e** a próxima. O padrão clássico (Parallel Change, de Martin Fowler) tem quatro passos, espalhados por **releases distintos**:

```
  (1) EXPAND        muda ADITIVO e compatível
                    coluna nova nullable / tabela nova / índice CONCURRENTLY.
                    NUNCA renomear ou dropar no lugar. v36 ainda funciona.

  (2) DEPLOY CÓDIGO escreve no novo MANTENDO o velho (dual-write),
                    ou lê o novo COM FALLBACK pro velho. Roda em N e N-1.

  (3) BACKFILL      em background, em lote, copia/preenche o histórico
                    pro formato novo. Idempotente, retomável, fora de pico.

  (4) CONTRACT      release POSTERIOR: remove o velho (drop coluna/tabela),
                    DEPOIS que TODOS migraram e ninguém mais lê o velho.
```

O que torna isto não-óbvio:

- **Expand e contract são releases diferentes**, separados por dias/semanas — o tempo de **todos** os tenants migrarem e de **todos** os edges/PDVs no campo subirem de versão.
- **O passo 4 (contract) é ATIVO e tem de ser agendado.** Se você só faz expand e nunca contrata, o schema vira um cemitério de colunas velhas e o código carrega fallbacks para sempre. ADR-009 é explícito: há um passo de **aposentar** o suporte velho.
- **O código suporta uma janela de 1 versão (N e N-1), não todas para sempre.** Você garante que N-1 funcione enquanto o rollout corre. Não garante que v12 funcione em v37 — isso seria insustentável. A janela é curta e **deliberadamente fechada** no contract.

### Por que não pode "só renomear"

Um `ALTER TABLE ... RENAME COLUMN` parece inocente. Mas:

- A app **antiga** (N-1), ainda atendendo tenants não-migrados e edges no campo, faz `SELECT preco_venda` — e a coluna agora se chama `preco_unitario`. **Erro em produção** para todos os que ainda não subiram.
- Em tabela de 1TB, um rename é metadata-only (rápido), mas um `ADD COLUMN ... NOT NULL DEFAULT` ou um `ALTER TYPE` **reescreve a tabela inteira** e **trava** — derruba o tenant grande no horário errado.

Renomear, dropar e mudar tipo **no lugar** são proibidos como passo único. Sempre viram uma sequência expand→backfill→contract.

## DDL online / não-bloqueante (o risco do ALTER em 1TB)

`ALTER TABLE` em tabela enorme pode adquirir lock pesado e **parar a operação**. Regras de DDL seguro no Postgres:

- **`ADD COLUMN` nullable, sem default volátil** — metadata-only, instantâneo. ✅ É a base do expand.
- **`ADD COLUMN ... DEFAULT <constante>`** — no Postgres 11+ é metadata-only para constante (não reescreve). Mas `DEFAULT` **volátil** (ex.: `now()`, `gen_random_uuid()`) **reescreve a tabela**. ❌ Evite; preencha por backfill.
- **`ADD COLUMN ... NOT NULL`** sem default em tabela cheia **falha** (linhas existentes seriam NULL). Faça em três tempos: add nullable → backfill → `SET NOT NULL` validado.
- **`CREATE INDEX CONCURRENTLY`** — constrói o índice **sem** travar escrita. ✅ Sempre `CONCURRENTLY` em tabela grande (não roda em transação; o runner trata isso).
- **Constraint em dois tempos:** `ADD CONSTRAINT ... NOT VALID` (rápido, não checa o histórico) → depois `VALIDATE CONSTRAINT` (varre sem lock pesado de escrita). Vale para FK e CHECK.
- **`SET NOT NULL` barato:** primeiro um `CHECK (col IS NOT NULL) NOT VALID` + `VALIDATE`, depois `SET NOT NULL` aproveita a validação — evita o scan bloqueante do `SET NOT NULL` direto (Postgres 12+).
- **`lock_timeout`** sempre setado: se o ALTER não pegar o lock rápido, **aborta** em vez de enfileirar e travar a fila de queries atrás dele.

```sql
-- DDL seguro: nunca espere o lock para sempre; aborte e tente de novo
SET lock_timeout = '3s';
SET statement_timeout = '0';   -- mas o índice pode demorar; só o LOCK tem timeout

-- add coluna nova: metadata-only, instantâneo, não trava
ALTER TABLE produto ADD COLUMN preco_unitario numeric(14,4);   -- nullable

-- índice sem travar escrita (fora de transação; o runner cuida)
CREATE INDEX CONCURRENTLY idx_produto_preco_unit ON produto (preco_unitario);

-- constraint sem varrer 1TB de uma vez
ALTER TABLE produto ADD CONSTRAINT chk_preco_pos CHECK (preco_unitario >= 0) NOT VALID;
ALTER TABLE produto VALIDATE CONSTRAINT chk_preco_pos;   -- scan sem lock de escrita
```

Para o **backfill** em tabela enorme: em **lotes** (ex.: 10k linhas por commit), com pausa entre lotes, **em horário de baixa**, retomável por watermark (a última PK preenchida). Nunca um `UPDATE` sem `WHERE` numa tabela de 1TB — isso é um lock e um inchaço de WAL que derruba o tenant.

```sql
-- backfill em lote (loop no runner): preenche o novo a partir do velho
UPDATE produto
SET    preco_unitario = preco_venda          -- copia velho -> novo
WHERE  preco_unitario IS NULL                 -- só o que falta (idempotente)
  AND  id BETWEEN :lo AND :hi;                -- janela; avança :lo/:hi por lote
```

## O Migration Runner (orquestrar 900 bancos)

Não dá para `migrate` 900 bancos na mão. O **runner** é um worker dedicado que aplica migrations **em lote, monitorado, com retomada**. Princípios:

- **Idempotente por banco:** consulta `schema_migrations` de cada tenant e aplica só o que falta. Re-rodar não re-aplica.
- **Em lote (canário primeiro):** aplica num lote pequeno de tenants de baixo risco, observa, depois expande. Os grandes (1TB) têm lote próprio em janela de baixa.
- **Resiliente / retomável:** se cair no banco 412 de 900, retoma do 413; os 412 já feitos não são tocados.
- **Por fase:** roda os scripts de **expand** num release; os de **contract** noutro, depois que a frota de app inteira subiu e o rollout terminou.
- **Observado:** registra sucesso/falha por tenant, tempo, lock timeouts; um tenant que falha **não bloqueia** os outros — é isolado e investigado.
- **Respeita o tier:** grande = janela de baixa + DDL online + lock_timeout curto; pequenos podem ir em paralelo.

```ts
// migration-runner.ts (worker BullMQ) — esqueleto do orquestrador
@Injectable()
export class MigrationRunner {
  constructor(
    private readonly registry: TenantRegistryService,   // lista os 900
    private readonly connections: TenantConnectionManager,
  ) {}

  /** Aplica até a versão alvo na FASE dada, em lote, retomável. */
  async run(targetVersion: bigint, phase: 'expand' | 'contract', batch: Batch) {
    const tenants = await this.registry.listByTier(batch.tier); // canário -> resto
    for (const t of tenants) {
      try {
        const db = await this.connections.forTenant(t.id);
        const applied = await this.appliedVersions(db);            // lê schema_migrations
        const pending = MIGRATIONS
          .filter(m => m.phase === phase && m.version <= targetVersion)
          .filter(m => !applied.has(m.version));

        for (const m of pending) {
          await this.applyOne(db, m);   // SET lock_timeout; CONCURRENTLY fora de tx; registra
          this.metrics.ok(t.id, m.version);
        }
      } catch (err) {
        this.metrics.fail(t.id, err);   // ISOLA: este tenant falhou, segue pros outros
        if (batch.stopOnFailureRate && this.metrics.failureRate() > batch.threshold) {
          throw new Error('rollout pausado: taxa de falha acima do limite');
        }
      }
    }
  }
}
```

> Este runner é o braço de schema do CI/CD zero-downtime. O deploy de **código** (rolling/blue-green) é tratado em [../07-devops-infra/ci-cd-zero-downtime.md](../07-devops-infra/ci-cd-zero-downtime.md); aqui cuidamos de **como o schema evolui** sob esse código que roda em N e N-1.

## EXEMPLO COMPLETO: renomear uma coluna que o PDV offline ainda usa

O caso mais difícil e mais ilustrativo. Queremos renomear `produto.preco_venda` → `produto.preco_unitario` (decisão de domínio: o nome velho era ambíguo). E **não podemos quebrar**:

- os **900 bancos** (uns na vN, outros na vN+1 durante semanas);
- as **apps N-1** ainda no ar atendendo tenants não migrados;
- os **PDVs no campo** (Electron, ADR-008) que estão **offline ou pinados** numa versão antiga há dias e fazem `SELECT preco_venda` no seu cache local e no payload de sync.

Um `RENAME COLUMN` direto detonaria todos os três. Veja a sequência expand/contract, release a release.

### Release R1 — EXPAND (aditivo)

Migration de schema (roda no runner, fase `expand`, em todos os 900 quando chegar a vez de cada um):

```sql
-- R1: adiciona a coluna nova, nullable. Metadata-only, não trava 1TB.
ALTER TABLE produto ADD COLUMN preco_unitario numeric(14,4);   -- NULL por ora

-- trigger de transição: enquanto código velho escreve preco_venda,
-- o banco mantém preco_unitario em sincronia (e vice-versa) durante a janela.
CREATE OR REPLACE FUNCTION fn_sync_preco() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.preco_unitario IS NULL AND NEW.preco_venda IS NOT NULL THEN
    NEW.preco_unitario := NEW.preco_venda;     -- velho -> novo
  ELSIF NEW.preco_venda IS NULL AND NEW.preco_unitario IS NOT NULL THEN
    NEW.preco_venda := NEW.preco_unitario;     -- novo -> velho (apps N-1 leem)
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sync_preco BEFORE INSERT OR UPDATE ON produto
FOR EACH ROW EXECUTE FUNCTION fn_sync_preco();
```

A trigger de sincronização é o truque que mantém **as duas colunas coerentes** durante toda a janela — assim a app N-1 (lê `preco_venda`) e a app N (lê `preco_unitario`) veem o mesmo valor, qualquer que escreva.

### Release R1 — BACKFILL

```sql
-- copia o histórico em lote, idempotente, fora de pico (runner em loop)
UPDATE produto SET preco_unitario = preco_venda
WHERE preco_unitario IS NULL AND id BETWEEN :lo AND :hi;
```

### Release R2 — código que escreve no novo, mantendo compat

A nova build da app passa a usar `preco_unitario`, mas o **contrato de sync e a API continuam expondo `preco_venda`** porque o PDV no campo ainda só conhece esse nome (ADR-009: contrato backward-compatible — ver [versioning-and-compatibility.md](versioning-and-compatibility.md)).

```ts
// repositório: lê o novo, com fallback pro velho (janela N/N-1)
async function getProduto(db: Kysely<DB>, id: number) {
  const row = await db.selectFrom('produto')
    .select(['id', 'preco_unitario', 'preco_venda'])
    .where('id', '=', id).executeTakeFirstOrThrow();
  // a coluna nova é a verdade; se algum banco ainda não backfillou, cai no velho
  return { id: row.id, preco: row.preco_unitario ?? row.preco_venda };
}

// payload de SYNC pro PDV: AINDA manda preco_venda (campo antigo) -> não quebra PDV pinado
function toSyncPayload(p: Produto) {
  return { id: p.id, preco_venda: p.preco /* nome antigo no fio */ };
}
```

> Ponto-chave: **mudar o nome da coluna no banco NÃO é mudar o nome no contrato de sync.** O fio que fala com o PDV é versionado à parte e só muda quando **todos** os PDVs subirem — semanas depois, e por negociação de versão ([versioning-and-compatibility.md](versioning-and-compatibility.md)). Schema interno e contrato externo evoluem em ritmos diferentes.

### Espera — o rollout dos 900 + dos PDVs no campo

Aqui não se tem pressa. Espera-se até que:

1. **todos os 900 bancos** rodaram o expand R1 e o backfill (runner confirma `schema_migrations`);
2. **toda a frota de app** subiu para a build R2 (não há mais app N-1 lendo só `preco_venda`);
3. **todos os edges/PDVs** no campo subiram para a versão que aceita o novo contrato — **ou** o contrato de sync introduziu o campo novo de forma aditiva e o velho já foi depreciado e aposentado (ver janela de versão em [versioning-and-compatibility.md](versioning-and-compatibility.md)).

Só quando os três estão verdes é que o suporte ao velho pode ser **aposentado**. Esse "esperar todos" é exatamente a razão de expand e contract serem releases distintos.

### Release R3 — CONTRACT (remove o velho)

Agora, e só agora:

```sql
-- R3 (fase contract, runner): ninguém mais lê/escreve preco_venda
DROP TRIGGER trg_sync_preco ON produto;
DROP FUNCTION fn_sync_preco();
ALTER TABLE produto DROP COLUMN preco_venda;          -- adeus coluna velha
ALTER TABLE produto ALTER COLUMN preco_unitario SET NOT NULL;  -- via CHECK NOT VALID->VALIDATE
```

E no código, remove-se o fallback `?? row.preco_venda` e o campo velho do payload (depois que o contrato de sync velho foi aposentado). **O passo ativo de aposentar aconteceu** — o cemitério de colunas não se formou.

### Linha do tempo do exemplo

```
  R1  expand: + preco_unitario (nullable) + trigger sync   [runner, 900 bancos, em lote]
  R1  backfill: preenche histórico em lote                 [worker, fora de pico]
  R2  código: lê novo c/ fallback; sync ainda usa nome antigo
   …  ESPERA: 900 bancos migrados + frota N + PDVs no campo atualizados/contrato aposentado …
  R3  contract: drop trigger + drop preco_venda + SET NOT NULL   [runner, fase contract]
```

Em nenhum instante houve downtime, app N-1 quebrada, ou PDV pinado recebendo um payload que não entende. Esse é o padrão para **qualquer** mudança destrutiva (rename, drop, mudança de tipo, split de tabela): nunca no lugar, sempre expand→backfill→[esperar todos]→contract.

## Checklist de toda migration

- [ ] É **aditiva** (expand) ou é o **contract** agendado de um expand já propagado?
- [ ] DDL é **online** (nullable add / `CONCURRENTLY` / `NOT VALID`+`VALIDATE`) e tem `lock_timeout`?
- [ ] A app **N-1** continua funcionando contra este schema? (se não, não é expand)
- [ ] O **contrato de sync/API** com o PDV continua compatível? (schema ≠ contrato)
- [ ] O **backfill** é em lote, idempotente, retomável, fora de pico?
- [ ] O **contract** está **agendado** para um release futuro (não esquecido)?
- [ ] O runner trata o tenant **grande** em janela própria?
- [ ] Falha num tenant **isola** e não bloqueia o rollout dos outros?

## Ver também

- [versioning-and-compatibility.md](versioning-and-compatibility.md) — o contrato de API/sync backward-compatible e a janela de versão (a face "externa" desta mecânica).
- [sync-protocol.md](sync-protocol.md) — o payload versionado que o PDV pinado recebe.
- [oracle-to-postgres.md](oracle-to-postgres.md) — como o schema chegou ao Postgres antes de evoluir.
- [../07-devops-infra/ci-cd-zero-downtime.md](../07-devops-infra/ci-cd-zero-downtime.md) — o deploy rolling/blue-green do **código** que roda em N e N-1.
- [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) — os 900 bancos, o registry, o particionamento do grande.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-009 (a decisão que esta página implementa).
