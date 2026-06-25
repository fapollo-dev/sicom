# Tenancy & Dados (db-per-tenant)

> Como o Apollo isola 900 clientes em bancos separados sem virar 900 servidores: cliente = tenant, pool no compute, silo no dado, e o roteamento de tenant que faz isso funcionar sem vazar dado entre empresas.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-003 (db-per-tenant), ADR-004 (pool no compute, silo no dado).
- [target-architecture.md](target-architecture.md) — onde a camada 1 (nuvem) se encaixa.
- [../00-orientation/glossary.md](../00-orientation/glossary.md) — Retaguarda, filial vs cliente.

## A regra de isolamento (ADR-003)

> **Cliente = tenant. Filiais do mesmo cliente ficam no MESMO banco. Clientes diferentes NUNCA se juntam.**

Essa frase carrega duas decisões que são frequentemente confundidas — e confundi-las custa caro.

### Filial ≠ tenant (a armadilha)

Um supermercado "cliente" pode ter 1 ou 40 lojas. Todas as lojas (filiais) de **um mesmo cliente** vivem **no mesmo banco**, porque o cliente quer **multi-loja integrado**: transferência entre lojas, preço de rede, estoque consolidado, compra centralizada, visão única do dono. Separar filiais em bancos diferentes quebraria justamente o valor de ser uma rede.

```
  Cliente "Rede Atacarejo XPTO"  ──>  1 banco (db_tenant_xpto)
      ├── Loja 01 (matriz)        ┐
      ├── Loja 02                 │  todas no MESMO banco
      ├── Loja 03                 │  (coluna store_id discrimina)
      └── Loja 04                 ┘

  Cliente "Mercadinho do Zé"     ──>  1 banco (db_tenant_ze)
      └── Loja única

  db_tenant_xpto  ╳  db_tenant_ze   →  NUNCA compartilham nada.
```

Dentro do banco do tenant, a **filial** é discriminada por uma coluna (`store_id` / `id_loja`), **não** por banco. O `store_id` aparece em movimento, estoque, caixa, sequência fiscal. O isolamento **entre clientes** é físico (bancos distintos); o isolamento **entre filiais** é lógico (coluna) — porque dentro do mesmo cliente queremos cruzar dados, não isolá-los.

### Por que banco por cliente (e não schema, e não coluna)

| Modelo | Isolamento entre clientes | Custo p/ 900 | Por que (não) no Apollo |
|---|---|---|---|
| Coluna `tenant_id` (shared) | Lógico, frágil (um WHERE esquecido vaza) | Barato | ❌ Vazamento cross-cliente é catastrófico no fiscal/financeiro |
| Schema por cliente | Médio | Médio | ❌ Backup/restore e migration por cliente ficam confusos em escala |
| **Banco por cliente** | **Físico** | Gerenciável com pooling (ADR-004) | ✅ **Escolhido** |

Banco por cliente (ADR-003) dá:

- **Isolamento físico** — não existe `WHERE tenant_id` para esquecer; o vazamento cross-cliente é estruturalmente impossível na camada de dados.
- **Backup/restore por cliente** — restaurar um tenant não toca os outros.
- **Janela de upgrade independente** — cada banco migra no seu tempo (essencial p/ os 900 migrarem sem travar — ADR-009).
- **Mobilidade de tenant** — um banco pode ser levantado **on-prem** no datacenter do cliente grande sem desmontar nada (ver [deployment-topologies.md](deployment-topologies.md)).

## Pool no compute, silo no dado (ADR-004)

A leitura ingênua de "900 bancos" é "900 servidores". Errado e insustentável — seria o modelo on-prem disfarçado, caro, e mataria o deploy único. A decisão:

> **Uma frota de aplicação stateless serve TODOS os tenants, roteando por tenant. Os 900 bancos lógicos vivem numa frota de DEZENAS de instâncias.**

Duas dimensões independentes:

- **Compute (pool):** N réplicas stateless do NestJS atrás de um load balancer. Qualquer réplica atende qualquer tenant — ela resolve o tenant do request e abre a conexão certa. Stateless é o que permite escalar horizontal e fazer deploy zero-downtime (ADR-009).
- **Dado (silo):** cada cliente tem seu banco, mas **muitos bancos compartilham uma instância de Postgres**. Os 900 bancos lógicos não viram 900 instâncias — viram **dezenas** de instâncias, empacotando por tier.

### Tiers de dado (empacotamento por porte)

| Tier | Tamanho típico | Compute | Banco (silo) |
|---|---|---|---|
| **Pequeno** (mercadinho, 1 loja) | ~5 GB | Pool compartilhado (sem dedicação) | **Muitos por instância** — dezenas de bancos de 5GB numa instância média |
| **Médio** (rede 3-10 lojas) | dezenas a centenas de GB | Pool compartilhado | Poucos por instância, ou instância própria conforme carga |
| **Grande** (rede de alto volume) | ~1 TB | Pool compartilhado **ou** workers dedicados no pico | **Instância dedicada** + **read replica** (leitura analítica fora do primário) |

A intuição: **muitos pequenos cabem juntos** numa instância (o custo marginal de mais um mercadinho de 5GB é baixo); **um grande de 1TB merece instância dedicada** (não quer disputar I/O com 50 mercadinhos no dia do SPED) e **read replica** para o analítico não bater no primário (ADR-005/007). O particionamento por **loja/período** entra nos grandes (ver mais abaixo).

```
  INSTÂNCIA A (compartilhada — pequenos)        INSTÂNCIA D (dedicada — grande)
  ┌──────────────────────────────────┐         ┌──────────────────────────────┐
  │ db_ze · db_padaria · db_market42 │         │ db_rede_xpto (1 TB)          │
  │ db_emp07 · ...  (dezenas, 5GB)   │         │  + read replica (analítico)  │
  └──────────────────────────────────┘         └──────────────────────────────┘
       ▲   ▲   ▲                                       ▲
       └───┴───┴──────────  POOL DE APP STATELESS  ────┘
                    (mesmas réplicas atendem A e D, roteando por tenant)
```

A migração de tenant entre tiers (um médio que cresceu vira grande → ganha instância dedicada + replica) é uma **operação de ops** (mover o banco), não uma mudança de código — porque o app é o mesmo (ADR-002). Detalhe operacional em [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md).

## Roteamento de tenant no NestJS

Este é o **componente crítico de segurança** (ADR-004): resolver o tenant do request e abrir **a conexão certa**, sem nunca atender um cliente com o banco de outro. Erro aqui = vazamento cross-cliente. Por isso o roteamento é centralizado, request-scoped e auditável — não espalhado em cada service.

### 1. Resolução do tenant (de onde vem a identidade)

A origem do tenant depende da superfície:

- **JWT** (telas de retaguarda/BI autenticadas): o claim `tenantId` vem assinado no token, emitido no login contra o diretório central de tenants. Fonte de verdade para usuário logado.
- **Subdomínio** (`xpto.apollo.app`): mapeia host → tenant; útil para login e para isolar cookies/CORS por cliente. Resolvido contra o registry de tenants.
- **Header de sync** (edge↔nuvem): o edge se autentica com credencial de loja; o `tenantId` + `storeId` saem do token de máquina do edge.

Regra dura: **o tenant nunca vem de um parâmetro de query/body controlável pelo cliente.** Vem do token assinado ou do host resolvido server-side. Aceitar `?tenant=` seria entregar a chave do isolamento ao atacante.

### 2. Registry de tenants → string de conexão

Um catálogo central (banco de metadados, **não** um dos bancos de tenant) mapeia `tenantId` → host/instância/database + tier. É o que diz "o tenant `xpto` está na instância D, banco `db_rede_xpto`".

```ts
// tenant-registry.service.ts — catálogo central (não é banco de tenant)
@Injectable()
export class TenantRegistryService {
  // cache em memória + TTL; fonte é o banco de metadados central
  async resolve(tenantId: string): Promise<TenantConnectionConfig> {
    const row = await this.metaDb
      .selectFrom('tenant')
      .select(['host', 'port', 'database', 'tier', 'active'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    if (!row || !row.active) {
      throw new NotFoundException(`tenant inválido ou inativo: ${tenantId}`);
    }
    return {
      host: row.host, port: row.port, database: row.database, tier: row.tier,
    };
  }
}
```

### 3. Seleção de connection/pool por tenant

Não abrimos uma conexão nova por request — mantemos **um pool por banco de tenant**, criado sob demanda e cacheado. O request pega o pool do seu tenant.

```ts
// tenant-connection.manager.ts — cache de pools por tenant
@Injectable()
export class TenantConnectionManager {
  private readonly pools = new Map<string, Kysely<DB>>();

  constructor(private readonly registry: TenantRegistryService) {}

  async forTenant(tenantId: string): Promise<Kysely<DB>> {
    const cached = this.pools.get(tenantId);
    if (cached) return cached;

    const cfg = await this.registry.resolve(tenantId);
    const db = new Kysely<DB>({
      dialect: new PostgresDialect({
        pool: new Pool({
          host: cfg.host, port: cfg.port, database: cfg.database,
          user: process.env.DB_USER, password: process.env.DB_PASSWORD,
          max: cfg.tier === 'large' ? 20 : 5, // pequenos compartilham, não estouram conexões
          idleTimeoutMillis: 30_000,
        }),
      }),
    });
    this.pools.set(tenantId, db);
    return db;
  }
}
```

### 4. Contexto de tenant request-scoped (isolamento sem vazar)

Um módulo **request-scoped** captura o tenant no início do request e o expõe ao resto da cadeia. Nenhum service escolhe banco "na mão" — todos pedem ao `TenantContext`, que só conhece **um** tenant: o do request atual.

```ts
// tenant-context.module.ts
@Module({
  providers: [TenantContext, TenantConnectionManager, TenantRegistryService],
  exports: [TenantContext],
})
export class TenantContextModule {}

// tenant-context.ts — REQUEST scope: uma instância por request, isolada
@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  private _db?: Kysely<DB>;
  constructor(
    @Inject(REQUEST) private readonly req: Request,
    private readonly connections: TenantConnectionManager,
  ) {}

  get tenantId(): string {
    const id = (this.req as any).tenantId; // setado pelo guard a partir do JWT/host
    if (!id) throw new UnauthorizedException('tenant não resolvido');
    return id;
  }

  /** A ÚNICA porta de acesso a dados. Sempre o banco DESTE request. */
  async db(): Promise<Kysely<DB>> {
    if (!this._db) this._db = await this.connections.forTenant(this.tenantId);
    return this._db;
  }
}
```

```ts
// tenant.guard.ts — popula req.tenantId a partir de fonte CONFIÁVEL
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = extractBearer(req);
    const claims = this.jwt.verify(token);          // assinatura validada
    (req as any).tenantId = claims.tenantId;          // NUNCA de query/body
    (req as any).storeId = claims.storeId ?? null;    // filial dentro do tenant
    return Boolean(claims.tenantId);
  }
}
```

```ts
// products.service.ts — o service NÃO sabe escolher banco; pede ao contexto
@Injectable()
export class ProductsService {
  constructor(private readonly tenant: TenantContext) {}

  async list(): Promise<Product[]> {
    const db = await this.tenant.db();      // já é o banco do tenant do request
    return db.selectFrom('product').selectAll().execute();
  }
}
```

**Por que isso não vaza:** o `TenantContext` é `Scope.REQUEST` — cada request tem sua própria instância, amarrada a **um** `tenantId` resolvido de fonte assinada. Um service não tem como pedir "o banco do tenant X" arbitrário; só existe `db()`, que devolve o banco do request. E como cada cliente tem **banco físico próprio** (ADR-003), mesmo um bug de service não consegue ler a tabela de outro cliente — a conexão simplesmente não enxerga aquele dado. Isolamento defendido em **duas camadas**: roteamento (lógico) + banco separado (físico).

### Filial dentro do tenant (sem confundir de novo)

Resolvido o tenant (banco), a **filial** é um filtro **dentro** do banco. O `storeId` (também do token, para usuários de loja) discrimina movimento/estoque/caixa. Usuários de rede (matriz) enxergam todas as filiais do tenant; usuários de loja são limitados ao seu `storeId` — mas isso é **autorização**, não tenancy. Tenancy é o banco; filial é a coluna.

## Particionamento no grande (loja/período)

No tenant grande (~1TB), tabelas de movimento (vendas, itens de cupom, lançamentos fiscais) crescem sem teto. Estratégia de particionamento nativo do Postgres:

- **Por período** (mês/ano) — `RANGE` em `data_movimento`. O analítico e o SPED consultam por competência; partições antigas viram candidatas a arquivamento/compressão; o vacuum não varre a tabela inteira.
- **Por loja** (`store_id`) — `LIST`/`HASH` por filial em redes com muitas lojas, para isolar I/O por loja e podar partição em consultas filtradas por filial.
- **Composto** — `RANGE (período)` + subpartição `LIST (store_id)` no caso extremo.

```sql
-- vendas particionada por mês (tenant grande)
CREATE TABLE venda (
  id           bigint generated always as identity,
  store_id     int  not null,
  data_mov     date not null,
  -- ...
) PARTITION BY RANGE (data_mov);

CREATE TABLE venda_2026_06 PARTITION OF venda
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
```

> **Decida o particionamento com dados reais, não no escuro.** Use o MCP de Postgres para medir volume, cardinalidade de `store_id` e planos (`EXPLAIN`) antes de escolher a chave — ver [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) e [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md). Particionamento é só para o grande; o pequeno de 5GB não precisa e pagaria complexidade à toa.

## Ver também

- [target-architecture.md](target-architecture.md) — a camada 1 onde o roteamento vive.
- [deployment-topologies.md](deployment-topologies.md) — db-per-tenant viabiliza mover tenant para on-prem.
- [workload-tiers.md](workload-tiers.md) — read replica e worker por tenant.
- [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md) — empacotamento de bancos, replica, partição.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-003, ADR-004.
