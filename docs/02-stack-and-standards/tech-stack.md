# Tech Stack (travada)

> A stack do Apollo, com versões pinadas e a justificativa de cada escolha — alinhada às decisões canônicas. Não rediscuta o que está aqui; proponha um ADR novo se precisar mudar.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-006 (monólito modular), ADR-007 (read replica + rollups), ADR-008 (PDV Electron), ADR-010 (teclado + fiscal pinável), ADR-011 (Oracle→Postgres).
- [../00-orientation/glossary.md](../00-orientation/glossary.md) — vocabulário Delphi ↔ stack moderna.
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — disciplina de contexto e loop de trabalho.

---

## Princípio que governa toda escolha

A stack não é escolhida por modismo; é escolhida para **reconstruir fielmente um ERP procedural** e **preservar o operador de teclado**. Três restrições mandam:

1. **A SQL do legado é dinâmica e condicional** (`if … then SQL.Add('AND …')`). Precisamos de uma camada de dados onde a condicional vira código TypeScript legível, não string mágica nem um ORM que esconde o SQL. → **query builder explícito**.
2. **A mesma app React roda em browser e Electron** (ADR-008). Nada de fork de frontend; a casca muda, o código não.
3. **Teclado é requisito de primeira classe** (ADR-010). A escolha de UI tem que ser *headless* e controlável no nível da tecla, não um framework de componentes opinado que sequestra Tab/Enter/Alt.

Tudo abaixo deriva disso.

---

## Versões pinadas

> Versões "piso" (major.minor) que o playbook assume. CI trava a versão exata via lockfile. Atualização de major é evento de ADR/changelog, não decisão de PR isolado. O **motor fiscal pina suas próprias versões** independente do resto (ADR-010) — ver [performance-playbook.md](performance-playbook.md) e a trilha fiscal em [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md).

### Backend

| Tecnologia | Versão-piso | Papel | Porquê travada |
|------------|-------------|-------|----------------|
| **Node.js** | 20 LTS | Runtime do backend e do worker | LTS; mesmo runtime web/worker (ADR-005) |
| **TypeScript** | 5.4+ | Linguagem única (back+front) | Tipos compartilhados back↔front; DTOs e contratos de sync tipados |
| **NestJS** | 10.x | Backend modular | Módulo por domínio = fronteira sem rede (ADR-006); DI testável; mesmo binário sobe como web ou worker |
| **Kysely** | 0.27+ | **Query builder** (preferência) | SQL dinâmica do Delphi → `.where()` encadeado, totalmente tipado, SQL visível. Detalhe abaixo. |
| **Knex** | 3.x | Query builder alternativo / migrations | Aceitável onde precisar de SQL cru pesado e schema-builder maduro |
| **pg** | 8.x | Driver PostgreSQL | Driver canônico; pooling via `pg.Pool` |
| **PostgreSQL** | 16 | Banco-alvo (db-per-tenant) | ADR-003 / ADR-011; primário + read replica (ADR-007) |
| **Redis** | 7.x | Broker da fila + cache | Backbone do worker tier (ADR-005) |
| **BullMQ** | 5.x | Fila de jobs do worker tier | Fechamento fiscal/SPED, importações, relatório mensal saem da API interativa |
| **zod** | 3.x | Validação/inferência de schema | Mesmo schema valida DTO no Nest e form no React; fonte única de verdade |

### Frontend (browser **e** Electron — mesmo código)

| Tecnologia | Versão-piso | Papel | Porquê travada |
|------------|-------------|-------|----------------|
| **React** | 18.x | UI | Base do alvo; concurrent features úteis em grid grande |
| **Vite** | 5.x | Build/dev server | Build único que empacota para browser e para o renderer do Electron |
| **TypeScript** | 5.4+ | Linguagem | Tipos compartilhados com o backend |
| **Electron** | 30.x (LTS-ish) | Casca PDV + superfícies teclado-pesado | ADR-008: devices USB/serial, offline, **controle total do teclado** |
| **TanStack React Query** | 5.x | Server state | Cache/refetch/invalidação; substitui o `TDataSource`/binding do Delphi |
| **react-hook-form** | 7.x | Forms | Performático (uncontrolled), casa com a camada de teclado |
| **zod** | 3.x | Validação de form | Mesmo schema do backend via `@hookform/resolvers/zod` |
| **Radix UI** | 1.x (primitives) | Componentes **headless** | Acessibilidade/foco/focus-trap sem sequestrar o teclado |
| **React Aria** | (react-aria/-components) | Headless alternativo | Onde o comportamento de foco/teclado precisa de mais controle que Radix dá |
| **AG Grid** | 31.x (Community) | **Grid teclado-first** | Substitui o `TDBGrid`: seta/Enter/Tab célula-a-célula |
| **TanStack Table** | 8.x | Grid headless alternativo | Quando precisamos montar a UX de teclado do grid 100% nós mesmos |
| **react-hotkeys-hook** | 4.x | Registro de atalhos | F-keys/Ctrl com escopo por tela (ou command registry próprio) |
| **React Router** | 6.x | Routing | Rotas = `TForm`s; mesma árvore nas duas cascas |

### Testes e qualidade

| Tecnologia | Versão-piso | Papel |
|------------|-------------|-------|
| **Playwright** | 1.4x | E2E estruturado, **incluindo fluxos de teclado** (taborder, F-keys, mnemônicos `&`) — ver [../06-testing-quality/playwright-e2e.md](../06-testing-quality/playwright-e2e.md) |
| **Vitest** | 1.x | Unit/integração (front e back); mesmo runtime Vite |
| **Jest** | 29.x | Unit no backend Nest, se preferir o default do framework |

---

## Decisão-chave: acesso a dados = query builder explícito (Kysely/Knex)

O ERP legado monta SQL **condicionalmente em runtime**. O Delphi faz assim:

```pascal
// Delphi — montagem condicional clássica
SQL.Clear;
SQL.Add('SELECT p.codigo, p.descricao, p.preco');
SQL.Add('FROM produto p');
SQL.Add('WHERE p.id_empresa = :emp');
if cbSomenteAtivos.Checked then
  SQL.Add('AND p.ativo = ''S''');
if edFiltroDescricao.Text <> '' then
  SQL.Add('AND p.descricao LIKE :desc');
if cbCategoria.ItemIndex > 0 then
  SQL.Add('AND p.id_categoria = :cat');
SQL.Add('ORDER BY p.descricao');
```

Esse padrão exige uma camada de dados onde **cada `if` do legado vira uma cláusula condicional rastreável**, com o SQL final **visível e diffável** contra o original (teste de paridade). É exatamente o que um query builder faz:

```ts
// Kysely — a mesma condicional, agora tipada e visível
let q = db
  .selectFrom('produto as p')
  .select(['p.codigo', 'p.descricao', 'p.preco'])
  .where('p.id_empresa', '=', empresaId);

if (filtro.somenteAtivos) q = q.where('p.ativo', '=', 'S');
if (filtro.descricao)     q = q.where('p.descricao', 'like', `%${filtro.descricao}%`);
if (filtro.categoriaId)   q = q.where('p.id_categoria', '=', filtro.categoriaId);

const rows = await q.orderBy('p.descricao').execute();
// q.compile().sql -> string SQL real, comparável ao legado no harness de paridade
```

### Por que NÃO um ORM "mágico" (TypeORM/Prisma) como default

| Critério | Query builder (Kysely/Knex) | ORM full (TypeORM/Prisma) |
|----------|-----------------------------|---------------------------|
| Reconstruir SQL condicional do Delphi | **Direto**: `if` → `.where()`; mapeamento 1:1 | Indireto: relations/where objects; some o SQL |
| SQL final visível p/ **teste de paridade** | **Sim** (`compile()`/`toSQL()`) — diff contra o legado | Opaco; precisa logar o SQL gerado e torcer |
| SQL avançado (CTE, window, `DISTINCT ON`, lateral, partições) | **Total** | Limitado / escapa pra raw e perde tipagem |
| Keyset/cursor pagination (ADR-007) | Natural | Possível, mas contraintuitivo |
| Tipagem do resultado | Kysely: forte e inferida | Boa (Prisma), mas acoplada ao schema do ORM |
| Migrations | Knex tem migrator maduro; Kysely tem migrator próprio | Bom (Prisma migrate / TypeORM) |
| Curva p/ time vindo de SQL/Delphi | Baixa: **é SQL** com tipos | Alta: precisa "pensar em ORM" |

**Veredito (preferência travada):** **Kysely** como padrão (tipagem + SQL visível), **Knex** aceitável onde a maturidade do schema-builder/raw ajuda. ORM full **não** é proibido em CRUD trivial de cadastro, mas **nunca** numa tela cuja SQL do legado é dinâmica — ali o query builder é obrigatório para o mapeamento ser auditável. Detalhe do padrão de repositório em [backend-nestjs-standards.md](backend-nestjs-standards.md).

> Por que isso importa para a paridade: a regra de ouro do eval ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)) exige tocar **a SQL real**. Se o ORM esconde o SQL, você não consegue provar que reconstruiu a condicional certa. O query builder mantém o SQL no claro.

---

## Decisão-chave: UI headless + teclado-first

O Delphi VCL dá controle absoluto de Tab/Enter/Alt. Um framework de componentes web opinado (Material UI, Chakra etc.) **luta contra** a camada de teclado: intercepta Tab, impõe focus rings próprios, e não expõe os ganchos que a [keyboard-ux-layer.md](keyboard-ux-layer.md) precisa.

- **Headless (Radix UI / React Aria):** entregam comportamento de acessibilidade, foco e focus-trap **sem** impor visual nem sequestrar o teclado. O visual vem do design system (seção 09); o teclado vem da nossa camada (ADR-010).
- **Grid teclado-first (AG Grid / TanStack Table):** o `TDBGrid` era o coração da retaguarda — navegação por seta, Enter edita, Tab entre células. AG Grid entrega isso pronto; TanStack Table quando queremos montar a UX de teclado nós mesmos. Detalhe em [keyboard-ux-layer.md](keyboard-ux-layer.md).
- **Forms (react-hook-form + zod):** o mesmo `zod` schema valida no backend e no form; uncontrolled inputs casam com Enter-avança-campo sem re-render por tecla.
- **Atalhos (react-hotkeys-hook ou registro próprio):** F-keys e Ctrl com escopo por tela/painel ativo — espelha `KeyPreview`/`TActionList` do Delphi.

Detalhes de comportamento (taborder, Enter-avança, mnemônicos `&`, caveat do browser que reserva Ctrl+W/F5/etc., e por que **Electron resolve**) estão no arquivo-coroa: [keyboard-ux-layer.md](keyboard-ux-layer.md).

---

## Worker tier (Redis + BullMQ)

A **mesma imagem** do backend sobe como **web** (HTTP interativo) ou **worker** (consumidor de fila), decidido por env (ADR-005, ADR-006). Cargas pesadas — fechamento fiscal/SPED, importação, relatório mensal — entram numa fila BullMQ e nunca degradam o PDV/telas. Detalhe de implementação (role do processo, tenant em job) em [backend-nestjs-standards.md](backend-nestjs-standards.md); estratégia de leitura pesada (read replica, rollups, keyset) em [performance-playbook.md](performance-playbook.md).

---

## Tabela resumo (a stack numa olhada)

| Camada | Escolha travada | Alternativa aceita | Anti-escolha (não use) |
|--------|------------------|--------------------|------------------------|
| Runtime | Node 20 LTS | — | — |
| Linguagem | TypeScript 5.4+ (back+front) | — | JS puro em código novo |
| Backend | NestJS 10 (monólito modular) | — | Microserviços já (ADR-006) |
| Acesso a dados | **Kysely** | Knex | TypeORM/Prisma em tela com SQL dinâmica |
| Banco | PostgreSQL 16 (db-per-tenant) | — | Oracle (ADR-011) |
| Worker | Redis 7 + BullMQ 5 | — | Job pesado na API interativa |
| Frontend | React 18 + Vite 5 + TS | — | Fork browser vs Electron (ADR-008) |
| Casca pesada/PDV | Electron 30 | — | Confiar no teclado do browser p/ ERP |
| Server state | TanStack React Query 5 | — | Estado de servidor em Redux global |
| Forms | react-hook-form 7 + zod 3 | Formik (legado) | Controlled inputs com re-render por tecla |
| Componentes | Radix UI / React Aria (headless) | — | MUI/Chakra (sequestram teclado) |
| Grid | AG Grid 31 | TanStack Table 8 | `<table>` cru sem navegação por seta |
| Atalhos | react-hotkeys-hook 4 / registro próprio | — | `accesskey` do browser (inconsistente) |
| E2E | Playwright 1.4x | — | E2E manual / só unit |
| Unit | Vitest 1 | Jest 29 (back) | — |

---

## Ver também

- [backend-nestjs-standards.md](backend-nestjs-standards.md) — como o NestJS modular usa o query builder e o tenant context (ADR-006).
- [frontend-react-standards.md](frontend-react-standards.md) — estrutura feature-based, duas cascas, React Query.
- [performance-playbook.md](performance-playbook.md) — keyset, índices via EXPLAIN, rollups, read replica (ADR-007).
- [keyboard-ux-layer.md](keyboard-ux-layer.md) — a fundação de teclado (ADR-010).
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — as decisões que esta stack materializa.
