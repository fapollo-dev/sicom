# Padrões de Backend (NestJS) — ADR-006

> Como estruturar o backend NestJS como **monólito modular**: um módulo por domínio, fronteira via módulo (não rede), camadas claras, tenant context isolado, e o mapeamento canônico de **SQL dinâmica do Delphi → query builder**.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-006** (monólito modular), ADR-003/004 (db-per-tenant, pool no compute), ADR-005 (web/worker/replica).
- [tech-stack.md](tech-stack.md) — por que Kysely é a preferência de acesso a dados.
- [../00-orientation/glossary.md](../00-orientation/glossary.md) — `TQuery`/`TDataModule`/`TForm` → service/repository/rota.

---

## ADR-006 em uma frase

NestJS como **monólito modular**: **um módulo por domínio**, com fronteiras claras **via módulo, não via rede**. Cada módulo **poderia** virar um serviço depois — mas hoje roda tudo no mesmo processo. Microserviço só quando um módulo **provar** necessidade de escala/deploy independente. Fronteira prematura por rede = monólito distribuído (o pior dos mundos).

---

## Os módulos de domínio

Um módulo NestJS por domínio do ERP. As fronteiras saem do dossiê (seção 04) — começam aproximadas e endurecem conforme se aprende. Conjunto inicial:

```
src/
  modules/
    vendas/         # venda, balcão, integração PDV (consolidação do offline)
    estoque/        # saldo, movimentação, inventário, custo
    fiscal/         # NFC-e, NF-e, SAT, SPED/EFD — RISCO-COROA, versionável/pinável (ADR-010)
    financeiro/     # contas a pagar/receber, CNAB, conciliação
    cadastro/       # produto, cliente, fornecedor, empresa/loja
    compras/        # pedido de compra, entrada de NF, cotação
  shared/
    tenant/         # tenant context module (request-scoped + connection por tenant)
    database/       # provider do query builder, pool, read replica router
    config/         # env, role do processo (web|worker)
    errors/         # AppException, filtro global, mapeamento p/ HTTP
  jobs/             # processors BullMQ (worker role) — fechamento, import, relatório
  main.ts           # bootstrap; decide web vs worker por env
```

### Regra de fronteira (o que mantém "modular" honesto)

1. **Nada de import cruzado de internals.** O módulo `vendas` **não** importa o repository de `estoque`. Ele depende de um **service público** que `estoque` exporta no seu `@Module({ exports: [...] })`. O resto é privado.
2. **Sem SQL cruzando domínio.** Se `vendas` precisa de saldo de estoque, chama `EstoqueService.getSaldo()`, não roda um `JOIN` na tabela de estoque. (Exceção pragmática: relatórios/rollups read-only que cruzam domínios moram num módulo `reporting` dedicado — ver [performance-playbook.md](performance-playbook.md).)
3. **Contrato é a interface do service**, não a tabela. Assim, no dia em que `fiscal` virar serviço, troca-se a chamada in-process por uma chamada de rede **sem tocar quem chama**.

```ts
// estoque/estoque.module.ts — só o service é público
@Module({
  controllers: [EstoqueController],
  providers: [EstoqueService, EstoqueRepository], // repository é privado do módulo
  exports: [EstoqueService],                      // só o service cruza a fronteira
})
export class EstoqueModule {}
```

---

## Camadas: controller → service → repository

Camadas explícitas e finas. Espelham a separação que o Delphi **não** tinha (lógica + SQL + UI no mesmo `.pas`) e que estamos impondo de propósito.

| Camada | Responsabilidade | Não faz |
|--------|------------------|---------|
| **Controller** | HTTP/transport, valida DTO, chama service | Regra de negócio, SQL |
| **Service** | Regra de negócio (as condicionais do Delphi vivem aqui), orquestra repos, transação | Montar SQL, HTTP |
| **Repository** | Acesso a dados via query builder (Kysely) | Regra de negócio |

```ts
// vendas/vendas.controller.ts
@Controller('vendas')
export class VendasController {
  constructor(private readonly vendas: VendasService) {}

  @Post()
  async criar(@Body() dto: CriarVendaDto) {       // DTO validado por zod/class-validator
    return this.vendas.registrar(dto);
  }
}

// vendas/vendas.service.ts — onde mora a regra de negócio extraída do dossiê
@Injectable()
export class VendasService {
  constructor(
    private readonly repo: VendasRepository,
    private readonly estoque: EstoqueService,     // dependência via service público
  ) {}

  async registrar(dto: CriarVendaDto) {
    // condicionais de negócio que vieram do .pas (ex.: bloqueia venda sem estoque
    // se a empresa não permite negativo) ficam AQUI, testáveis e isoladas do SQL.
    for (const item of dto.itens) {
      const saldo = await this.estoque.getSaldo(item.produtoId);
      if (!dto.empresa.permiteEstoqueNegativo && saldo < item.quantidade) {
        throw new BusinessRuleError('ESTOQUE_INSUFICIENTE', { produtoId: item.produtoId });
      }
    }
    return this.repo.inserirVenda(dto);
  }
}
```

---

## DTOs e validação

Validação no controller, schema único compartilhado com o frontend via **zod** (preferência) ou **class-validator** onde o estilo decorator do Nest ajuda. O `zod` é a fonte única: o mesmo schema valida o DTO no backend e o form no React (ver [frontend-react-standards.md](frontend-react-standards.md)).

```ts
// vendas/dto/criar-venda.dto.ts — zod como fonte única back↔front
import { z } from 'zod';

export const criarVendaSchema = z.object({
  empresaId: z.number().int().positive(),
  itens: z.array(z.object({
    produtoId: z.number().int().positive(),
    quantidade: z.number().positive(),
    precoUnitario: z.number().nonnegative(),
  })).min(1),
  desconto: z.number().min(0).max(100).default(0),
});
export type CriarVendaDto = z.infer<typeof criarVendaSchema>;

// pipe que aplica o schema zod nos controllers
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: z.ZodSchema) {}
  transform(value: unknown) {
    const r = this.schema.safeParse(value);
    if (!r.success) throw new ValidationError(r.error.flatten());
    return r.data;
  }
}
// uso: @Body(new ZodValidationPipe(criarVendaSchema)) dto: CriarVendaDto
```

---

## Tenant context module (isolamento por tenant)

ADR-003/004: **cliente = tenant = banco**; filiais do mesmo cliente no mesmo banco; clientes nunca se misturam. Uma frota stateless serve todos, **roteando por tenant**. O isolamento é crítico — um vazamento cross-tenant é o pior bug possível.

### Resolução request-scoped + connection por tenant

```ts
// shared/tenant/tenant-context.ts — contexto request-scoped via AsyncLocalStorage
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantCtx { tenantId: string; lojaId?: number; }
export const tenantStore = new AsyncLocalStorage<TenantCtx>();

export function currentTenant(): TenantCtx {
  const ctx = tenantStore.getStore();
  if (!ctx) throw new Error('TENANT_CONTEXT_MISSING'); // fail-closed: nunca rode sem tenant
  return ctx;
}
```

```ts
// shared/tenant/tenant.middleware.ts — resolve tenant do request e abre o escopo
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const tenantId = resolveTenantFromRequest(req); // do JWT/subdomínio/header — nunca do body do cliente
    if (!tenantId) throw new UnauthorizedTenantError();
    tenantStore.run({ tenantId, lojaId: req.lojaId }, () => next());
  }
}
```

```ts
// shared/database/database.provider.ts — connection por tenant (pool por banco)
@Injectable()
export class DatabaseProvider {
  private pools = new Map<string, Kysely<DB>>(); // 1 pool por tenant/banco (ADR-004)

  forTenant(): Kysely<DB> {
    const { tenantId } = currentTenant();         // fail-closed se faltar
    let db = this.pools.get(tenantId);
    if (!db) { db = this.buildKysely(tenantId); this.pools.set(tenantId, db); }
    return db;
  }

  // leitura pesada vai para a réplica (ADR-007) — ver performance-playbook.md
  forTenantRead(): Kysely<DB> { return this.buildReplica(currentTenant().tenantId); }
}
```

> **Isolamento é fail-closed.** Sem tenant no contexto, o repository **lança**, nunca cai num default. O `tenantId` vem de fonte confiável (JWT/sessão), **nunca** de um campo controlado pelo cliente. Detalhe de roteamento e pooling em [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) e [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md).

```ts
// uso no repository — o pool certo do tenant, transparente
@Injectable()
export class VendasRepository {
  constructor(private readonly dbp: DatabaseProvider) {}
  private get db() { return this.dbp.forTenant(); } // já isolado por tenant
}
```

---

## Uma app, dois papéis: web OU worker (ADR-005/006)

A **mesma imagem** sobe como API interativa ou como consumidor de fila, decidido por env. Não há binário "do worker" separado.

```ts
// main.ts — role do processo por env
async function bootstrap() {
  const role = process.env.APP_ROLE ?? 'web'; // 'web' | 'worker'
  if (role === 'worker') {
    // sobe só os processors BullMQ; sem servidor HTTP
    const app = await NestFactory.createApplicationContext(WorkerModule);
    await app.init(); // BullMQ Workers começam a consumir
  } else {
    const app = await NestFactory.create(AppModule);
    app.use(tenantMiddleware);
    await app.listen(3000);
  }
}
```

```ts
// jobs/sped.processor.ts — job pesado fora da API interativa; tenant viaja no payload
@Processor('fiscal')
export class SpedProcessor {
  constructor(private readonly dbp: DatabaseProvider) {}

  @Process('gerar-sped')
  async handle(job: Job<{ tenantId: string; competencia: string }>) {
    // reabre o tenant context dentro do worker (não há request aqui)
    return tenantStore.run({ tenantId: job.data.tenantId }, async () => {
      // leitura pesada na réplica, escrita do arquivo no primário, em lotes
      // ... ver performance-playbook.md (streaming, batch, read replica)
    });
  }
}
```

> O job **carrega o `tenantId` no payload** e reabre o contexto via `tenantStore.run`, porque no worker não existe request HTTP para o middleware resolver. Errar isso = job processar o tenant errado. Sempre teste o caminho real (regra de ouro do eval — [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)).

---

## O mapeamento canônico: SQL dinâmica do Delphi → query builder

Este é o coração da reconstrução. O legado monta SQL **condicionalmente em runtime**; cada `if … SQL.Add(...)` precisa virar uma cláusula **rastreável e diffável**. Lado a lado:

### Delphi (origem)

```pascal
// Tela de consulta de produtos — montagem condicional típica
procedure TfrmConsultaProduto.Buscar;
begin
  qry.SQL.Clear;
  qry.SQL.Add('SELECT p.id, p.codigo, p.descricao, p.preco_venda, c.nome AS categoria');
  qry.SQL.Add('FROM produto p');
  qry.SQL.Add('LEFT JOIN categoria c ON c.id = p.id_categoria');
  qry.SQL.Add('WHERE p.id_empresa = :emp');
  qry.ParamByName('emp').AsInteger := EmpresaAtual;

  if chkSomenteAtivos.Checked then
    qry.SQL.Add('AND p.ativo = ''S''');

  if edDescricao.Text <> '' then
  begin
    qry.SQL.Add('AND UPPER(p.descricao) LIKE :desc');
    qry.ParamByName('desc').AsString := '%' + UpperCase(edDescricao.Text) + '%';
  end;

  if cmbCategoria.ItemIndex > 0 then
  begin
    qry.SQL.Add('AND p.id_categoria = :cat');
    qry.ParamByName('cat').AsInteger := CategoriaSelecionadaId;
  end;

  if rgEstoque.ItemIndex = 1 then       // "somente com saldo"
    qry.SQL.Add('AND p.saldo_atual > 0');

  qry.SQL.Add('ORDER BY p.descricao');
  qry.Open;
end;
```

### NestJS + Kysely (alvo) — mesma lógica, condicional 1:1

```ts
// cadastro/produto.repository.ts
export interface FiltroProduto {
  empresaId: number;
  somenteAtivos?: boolean;
  descricao?: string;
  categoriaId?: number;
  somenteComSaldo?: boolean;
}

@Injectable()
export class ProdutoRepository {
  constructor(private readonly dbp: DatabaseProvider) {}

  async buscar(f: FiltroProduto) {
    let q = this.dbp.forTenantRead()            // consulta = read replica (ADR-007)
      .selectFrom('produto as p')
      .leftJoin('categoria as c', 'c.id', 'p.id_categoria')
      .select([
        'p.id', 'p.codigo', 'p.descricao', 'p.preco_venda',
        'c.nome as categoria',
      ])
      .where('p.id_empresa', '=', f.empresaId); // :emp

    // cada if do Delphi -> um .where() condicional, na MESMA ordem
    if (f.somenteAtivos)   q = q.where('p.ativo', '=', 'S');
    if (f.descricao)       q = q.where(sql`upper(p.descricao)`, 'like', `%${f.descricao.toUpperCase()}%`);
    if (f.categoriaId)     q = q.where('p.id_categoria', '=', f.categoriaId);
    if (f.somenteComSaldo) q = q.where('p.saldo_atual', '>', 0);

    q = q.orderBy('p.descricao');

    // PARIDADE: q.compile().sql é a string SQL real, comparável ao legado no harness
    return q.execute();
  }
}
```

### Por que isto preserva a paridade

- **Mapeamento de tradução explícito:** o dossiê (seção 04) lista cada condicional (`chkSomenteAtivos` → `somenteAtivos`) e o teste de paridade compara o SQL compilado e o resultado contra o legado (ver [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)).
- **SQL no claro:** `q.compile()` devolve a SQL e os parâmetros — diff direto contra o `qry.SQL.Text` capturado em runtime (ver extração em [../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md)).
- **Sem mágica de ORM:** nada some atrás de relations. É por isso que o query builder é a preferência travada (ADR-006 + [tech-stack.md](tech-stack.md)).

> Armadilha: a **ordem** das condicionais e o tratamento de string vazio/`UPPER`/`LIKE` mudam o resultado. Replique a semântica do Delphi (ex.: `UpperCase` + `%…%`), não "uma busca parecida". Para nomes sem acento/UPPERCASE, confira a normalização no dossiê — esse tipo de mismatch já mordeu antes.

---

## Tratamento de erro

Hierarquia de exceções de aplicação + filtro global que mapeia para HTTP. Regras de negócio lançam exceções **tipadas e nomeadas** (o nome vira código de erro estável que o frontend trata), nunca `throw new Error('...')` solto.

```ts
// shared/errors/app-error.ts
export abstract class AppError extends Error {
  abstract readonly code: string;        // estável, vai pro contrato (ex.: 'ESTOQUE_INSUFICIENTE')
  abstract readonly httpStatus: number;
  constructor(message: string, public readonly details?: Record<string, unknown>) { super(message); }
}

export class BusinessRuleError extends AppError {
  readonly httpStatus = 422;
  constructor(readonly code: string, details?: Record<string, unknown>) { super(code, details); }
}
export class ValidationError extends AppError {
  readonly code = 'VALIDATION'; readonly httpStatus = 400;
}
export class UnauthorizedTenantError extends AppError {
  readonly code = 'TENANT_FORBIDDEN'; readonly httpStatus = 403;
  constructor() { super('TENANT_FORBIDDEN'); }
}
```

```ts
// shared/errors/all-exceptions.filter.ts — mapeamento único p/ HTTP
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof AppError) {
      return res.status(err.httpStatus).json({ code: err.code, message: err.message, details: err.details });
    }
    // erro inesperado: log com tenantId do contexto, resposta genérica (não vaza detalhe)
    logger.error({ tenantId: tenantStore.getStore()?.tenantId, err });
    return res.status(500).json({ code: 'INTERNAL', message: 'Erro interno' });
  }
}
```

---

## Organização de pastas e convenções de nomenclatura

### Pastas (resumo)

```
src/modules/<dominio>/
  <dominio>.module.ts
  <dominio>.controller.ts
  <dominio>.service.ts
  <recurso>.repository.ts
  dto/<acao>-<recurso>.dto.ts      # zod schema + type inferido
  entities/                        # tipos do schema do banco (gerados p/ Kysely)
src/shared/{tenant,database,config,errors}/
src/jobs/<dominio>.processor.ts
```

### Nomenclatura

| Item | Convenção | Exemplo |
|------|-----------|---------|
| Arquivo | kebab-case + sufixo de papel | `produto.repository.ts`, `criar-venda.dto.ts` |
| Classe | PascalCase + sufixo | `ProdutoRepository`, `VendasService`, `SpedProcessor` |
| Módulo | `<Dominio>Module` | `EstoqueModule` |
| DTO | `<Acao><Recurso>Dto` / schema `<acao><Recurso>Schema` | `CriarVendaDto` / `criarVendaSchema` |
| Erro de negócio | `code` SCREAMING_SNAKE estável | `ESTOQUE_INSUFICIENTE` |
| Tabela/coluna (Postgres) | snake_case (espelha o domínio fiscal-BR) | `preco_venda`, `id_empresa` |
| Identificadores em prosa | inglês em código, português nos termos de domínio fiscal | `produto`, `nfce` |

> Princípio: **uma responsabilidade por arquivo**, sufixo declara o papel (`.controller`/`.service`/`.repository`/`.dto`/`.processor`). Quem abre a pasta entende a camada sem ler o conteúdo.

---

## Ver também

- [tech-stack.md](tech-stack.md) — por que Kysely/Knex em vez de ORM full.
- [performance-playbook.md](performance-playbook.md) — keyset, read replica, rollups, EXPLAIN via MCP (ADR-007).
- [frontend-react-standards.md](frontend-react-standards.md) — o `zod` compartilhado e o consumo dos contratos.
- [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) — roteamento de tenant e pooling (ADR-003/004).
- [../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md) — capturar a SQL real do Delphi.
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — provar legado × novo.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-006 e correlatos.
