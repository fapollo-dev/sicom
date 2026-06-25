# Oracle → PostgreSQL

> Como tirar o ERP de cima do Oracle e assentá-lo no PostgreSQL sem perder uma regra: mapeamento de tipos, sequences, triggers, o destino do PL/SQL (service ou pl/pgsql, caso a caso), packages e views; o ETL de dados, a reconciliação que prova que nada se perdeu, as ferramentas, e o cutover por tenant com dual-run.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-011 (Postgres é o banco-alvo), ADR-003 (db-per-tenant), ADR-009 (expand/contract, janela de versão).
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — "não migre o que você vê, migre o que o sistema faz"; risco-coroa fiscal (centavo importa).
- [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) — cada cliente é um banco; o cutover é **por tenant**, não global.
- [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) — o MCP de Postgres para inspecionar schema/volume **antes** de decidir.

## O princípio (ADR-011)

> **O banco-alvo é PostgreSQL. PL/SQL, packages e tipos Oracle são migrados ou reescritos. Licença Oracle na nuvem é proibitiva; Postgres é o padrão do alvo.**

Esta não é uma migração de "exportar e importar". O Oracle de um ERP de 20 anos carrega **lógica de negócio dentro do banco** — triggers que validam, packages que calculam imposto, views que mascaram regras. Tratar isso como "DDL + dados" perde exatamente a camada onde mora a regra. A disciplina da canon vale aqui em cheio: **migre o que o sistema faz**, não o que o `CREATE TABLE` mostra.

A sub-migração tem cinco frentes, em ordem de risco crescente:

1. **Tipos e DDL** — mecânico, mas cheio de armadilhas de semântica (NULL, string vazia, número).
2. **Sequences** — fácil, com um detalhe de cutover (continuar a numeração, não reiniciar).
3. **Triggers** — reescrita de sintaxe + decisão de onde a lógica vai morar.
4. **Views** — reescrita de SQL dialeto (Oracle → Postgres), geralmente direta.
5. **PL/SQL (procedures, functions, packages)** — a frente-coroa: **decidir caso a caso** entre subir a lógica para o service (NestJS) ou reescrever em pl/pgsql.

> **Inspecione antes de mapear.** Use o MCP de Postgres (e o catálogo do Oracle) para medir: quantas tabelas, quais tipos realmente em uso, volume por tabela, quais triggers/packages existem, cardinalidade. Não migre no escuro — ver [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) e [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md).

## 1. Mapeamento de tipos

A tabela-base. O perigo não está no caso comum — está nas três armadilhas semânticas (NUMBER sem escala, NULL vs string vazia, DATE com hora).

| Oracle | PostgreSQL | Observação / armadilha |
|---|---|---|
| `NUMBER(p,s)` | `numeric(p,s)` | **Sempre** `numeric` para dinheiro/quantidade. Nunca `float`/`double` (arredondamento binário fura o centavo — risco-coroa fiscal). |
| `NUMBER` (sem precisão) | `numeric` (sem precisão) **ou** `bigint` se for inteiro de fato | `NUMBER` solto no Oracle é decimal arbitrário. Inspecione o **uso real**: se a coluna só guarda inteiro (id, quantidade), `bigint`; se guarda decimal, `numeric`. Decidir com dados, não por nome. |
| `NUMBER(10)` (id) | `bigint` ou `integer` | Use `bigint` para chaves de movimento (vendas, itens) que crescem sem teto. |
| `VARCHAR2(n)` | `varchar(n)` ou `text` | Postgres não cobra por `text`; `varchar(n)` só se o limite for **regra de negócio** (ex.: CNPJ 14). Caso contrário, `text`. |
| `CHAR(n)` | `char(n)` → preferir `text` | `CHAR` faz **padding com espaço** no Oracle; em Postgres `char` também, mas comparações mudam. Migrar para `text` e `TRIM` no ETL evita bug sutil de comparação. |
| `DATE` | `timestamp(0)` ou `timestamptz` | **Oracle `DATE` tem hora.** Não é `date` do Postgres (que é só dia). Mapear `DATE` → `date` **perde a hora** silenciosamente. Use `timestamp` (ou `timestamptz` se houver fuso) e só use `date` quando a coluna for comprovadamente só-dia. |
| `TIMESTAMP` | `timestamp` | Direto. Se houver `TIMESTAMP WITH TIME ZONE`, vai para `timestamptz`. |
| `TIMESTAMP WITH LOCAL TIME ZONE` | `timestamptz` | Cuidado: a sessão Oracle define o fuso; padronize tudo em UTC no destino. |
| `CLOB` | `text` | Postgres `text` é ilimitado; não precisa do tipo LOB separado. |
| `BLOB` | `bytea` | Binário (XML de NF-e assinado, imagem, PDF). `bytea`. Para grandes volumes, considere object storage e guardar só a referência. |
| `RAW(n)` | `bytea` | Binário curto. |
| `LONG` / `LONG RAW` | `text` / `bytea` | Tipos legados; raramente bem usados. Inspecione o conteúdo real. |
| `FLOAT` / `BINARY_DOUBLE` | `double precision` | **Nunca** para valor monetário. Só se for medida física genuinamente aproximada. |
| `ROWID` / `UROWID` | (sem equivalente) | Se a aplicação usa `ROWID` como identidade, é dívida técnica — substituir por PK explícita. |
| `XMLTYPE` | `xml` ou `text` | Postgres tem `xml`; para XML fiscal, `text` costuma bastar (validação é na app). |
| `INTERVAL` | `interval` | Direto. |

### Armadilha 1: NUMBER sem escala → decida com o uso real

`NUMBER` puro no Oracle é decimal de precisão arbitrária. Mapear tudo para `numeric` é seguro mas pode ser lento e desperdiçar índice quando a coluna sempre guardou inteiro. Inspecione:

```sql
-- no Oracle (origem): a coluna realmente tem casas decimais?
SELECT MAX(CASE WHEN valor <> TRUNC(valor) THEN 1 ELSE 0 END) AS tem_decimal,
       MAX(valor) AS maior
FROM   produto;
-- tem_decimal = 0  -> é inteiro de fato -> bigint/integer no Postgres
-- tem_decimal = 1  -> decimal real      -> numeric(p,s) com escala medida
```

### Armadilha 2: NULL vs string vazia (a diferença que muda WHERE)

> **No Oracle, `''` (string vazia) é tratado como `NULL`.** No PostgreSQL, `''` e `NULL` são **coisas distintas**.

Isso quebra condições silenciosamente. Um `WHERE coluna IS NULL` que no Oracle pegava registros com `''` **deixa de pegá-los** no Postgres. E um `WHERE coluna = ''` que no Oracle nunca retornava nada **passa a retornar** no Postgres.

```sql
-- Oracle: estes dois retornam o MESMO conjunto (porque '' É null)
SELECT * FROM cliente WHERE nome_fantasia IS NULL;
SELECT * FROM cliente WHERE nome_fantasia = '';   -- nunca casa nada no Oracle

-- Postgres: retornam conjuntos DIFERENTES
SELECT * FROM cliente WHERE nome_fantasia IS NULL; -- só os NULL de verdade
SELECT * FROM cliente WHERE nome_fantasia = '';    -- só os '' (que existem!)
```

Estratégia: **normalizar no ETL**. Decida a política por coluna (a maioria: `'' → NULL`, para preservar o comportamento Oracle) e aplique na carga:

```sql
-- no ETL, ao inserir no Postgres: empty string vira NULL (preserva semântica Oracle)
INSERT INTO cliente (id, nome_fantasia)
SELECT id, NULLIF(TRIM(nome_fantasia), '')   -- '' e '   ' viram NULL
FROM   staging.cliente;
```

Toda condicional do legado que dependia de `IS NULL`/`= ''` precisa ser **reconstruída no dossiê** e coberta pelo teste de paridade ([../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)). Esta é uma fonte clássica de regressão silenciosa.

### Armadilha 3: DATE com hora

Repetindo por importância: `DATE` do Oracle **carrega hora**. Um cupom emitido `2026-06-23 14:35:07` vira `2026-06-23 00:00:00` se você mapear para `date`. Isso destrói ordenação intradiária, fechamento de caixa por turno e qualquer regra fiscal que dependa de hora. Default seguro: `timestamp(0)`.

### Armadilha 4: acento, collation e unaccent

Busca por nome no ERP é caso campeão de bug. Nomes costumam estar `UPPERCASE` e sem acento no cadastro antigo, mas a digitação do operador vem acentuada/minúscula. O Oracle pode estar com `NLS_SORT`/`NLS_COMP` configurado para ignorar acento; o Postgres **não faz isso por padrão**.

```sql
-- Postgres: habilitar busca acento-insensível
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;   -- ou pg_trgm para LIKE/fuzzy

-- "São José" casa "SAO JOSE"
SELECT * FROM cliente
WHERE unaccent(lower(nome)) = unaccent(lower(:termo));

-- índice funcional para não fazer seq scan
CREATE INDEX idx_cliente_nome_unaccent
  ON cliente (unaccent(lower(nome)));
```

Mapeie o `NLS_SORT`/`NLS_COMP` da origem e replique o comportamento com `unaccent`/`citext`/`pg_trgm` no destino, ou a busca do operador "deixa de achar" o que achava antes.

### Armadilha 5: arredondamento

Oracle e Postgres arredondam half-up de forma compatível em `ROUND`, **mas** o caminho importa: se o legado calculava em `NUMBER` (decimal) e o novo calcula em `float`, o resultado diverge no centavo. Regra dura do fiscal: **todo cálculo monetário em `numeric`, do começo ao fim**, e o arredondamento explícito (`ROUND(valor, 2)`) replicado igual ao legado. O teste de paridade tem **tolerância zero de centavo** ([../06-testing-quality/testing-strategy.md](../06-testing-quality/testing-strategy.md)).

## 2. Sequences

Oracle `SEQUENCE` → Postgres `sequence` (ou `GENERATED ... AS IDENTITY` para PKs novas). Mapeamento direto, com **um cuidado de cutover**: o `START WITH` do destino tem de continuar de onde a origem parou — reiniciar do 1 colidiria com dados migrados.

```sql
-- Oracle (origem): descobrir o último valor
SELECT last_number FROM user_sequences WHERE sequence_name = 'SEQ_NOTA_FISCAL';
-- ex.: 5_842_119

-- Postgres (destino): criar continuando a numeração
CREATE SEQUENCE seq_nota_fiscal START WITH 5842120 INCREMENT BY 1;

-- ou, se a PK virou IDENTITY, alinhar o seu valor após a carga de dados:
SELECT setval(
  pg_get_serial_sequence('nota_fiscal', 'id'),
  (SELECT COALESCE(MAX(id), 0) FROM nota_fiscal)
);
```

> **Numeração fiscal é sagrada.** Série/numeração de NF-e/NFC-e **não pode furar nem repetir** — é controle legal. No cutover, congele a emissão na origem, capture o último número, e continue **exatamente** no próximo no destino. Documente isso no plano de cutover do tenant.

`NEXTVAL`/`CURRVAL` do Oracle → `nextval('seq')`/`currval('seq')` no Postgres (mesma ideia; `currval` exige `nextval` antes na sessão). O idioma `seq.NEXTVAL` (notação de coluna) vira função.

## 3. Triggers

Triggers do Oracle (`BEFORE INSERT FOR EACH ROW`, etc.) precisam de **reescrita de sintaxe** e, mais importante, de uma **decisão**: a lógica continua no banco (pl/pgsql) ou sobe para o service? A regra prática:

- **Continua como trigger** (pl/pgsql): invariantes de **integridade de dados** que precisam valer mesmo que outro processo escreva direto no banco (ETL, import, correção manual). Ex.: `updated_at` automático, denormalização defensiva, audit row.
- **Sobe para o service** (NestJS): **regra de negócio** — cálculo de imposto, validação de venda, geração de documento. Regra de negócio escondida em trigger é dívida (difícil de testar, invisível). A canon manda **extrair via dossiê** e materializar no domínio.

Sintaxe — o trigger Oracle não roda direto; em Postgres a função é separada do `CREATE TRIGGER`:

```sql
-- Oracle
CREATE OR REPLACE TRIGGER trg_item_total
BEFORE INSERT OR UPDATE ON item_venda
FOR EACH ROW
BEGIN
  :NEW.total := :NEW.quantidade * :NEW.preco_unit;
END;

-- Postgres: função + trigger separados; NEW em vez de :NEW; RETURN NEW
CREATE OR REPLACE FUNCTION fn_item_total() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.total := NEW.quantidade * NEW.preco_unit;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_item_total
BEFORE INSERT OR UPDATE ON item_venda
FOR EACH ROW EXECUTE FUNCTION fn_item_total();
```

Diferenças que mordem na reescrita:

- `:NEW`/`:OLD` → `NEW`/`OLD`; a função **precisa** `RETURN NEW` (BEFORE row) ou `RETURN NULL`.
- `WHEN (condition)` na trigger Oracle → cláusula `WHEN` também existe em Postgres, mas teste.
- `:NEW.col := valor` para mutar a linha **só funciona em `BEFORE`** (igual Oracle).
- `AUTONOMOUS_TRANSACTION` do Oracle **não existe** em pl/pgsql — padrão comum em trigger de auditoria que comita à parte. Reescrever via `dblink`/extensão ou (melhor) mover a auditoria para a app/outbox.
- `:NEW` em statement-level: Postgres usa transition tables (`REFERENCING NEW TABLE AS ...`).

## 4. PL/SQL → service OU pl/pgsql (a decisão-coroa)

Aqui está o coração do ADR-011. Procedures, functions e **packages** carregam a inteligência do ERP. A canon exige decidir **caso a caso** entre dois destinos:

### Critério de decisão

| Mover para o **service (NestJS)** quando… | Manter no banco como **pl/pgsql** quando… |
|---|---|
| É **regra de negócio** (imposto, preço, fechamento, validação de venda). | É **set-based pesado** que mover para a app significaria puxar milhões de linhas (rollup, agregação, fechamento que varre a tabela). |
| Precisa de **testes de paridade** legíveis e versionados no código. | É **invariante de integridade** que tem de valer mesmo com escrita direta no banco. |
| Chama serviços externos (SEFAZ, TEF, gateway). | É chamada por **muitos** callers e reescrever na app duplicaria. |
| Tem condicional complexa que o dossiê precisa explicitar. | A latência de round-trip app↔banco dominaria (loop por linha). |
| É o **caminho normal** de uma tela/endpoint. | Migração 1:1 de algo estável reduz risco no curto prazo (e some no contract depois). |

Default da canon: **regra de negócio vai para o service** (testável, visível, no domínio — ADR-006). Lógica fica em pl/pgsql só quando há motivo de performance set-based ou integridade que justifica.

### Exemplo: regra de negócio → service

Uma function Oracle que calcula imposto de um item não deve virar pl/pgsql opaco; deve virar **código de domínio testável**, reconstruído do dossiê.

```sql
-- Oracle (legado): regra de imposto escondida numa function de package
FUNCTION calcula_icms(p_valor NUMBER, p_aliquota NUMBER, p_uf VARCHAR2)
RETURN NUMBER IS
  v_base NUMBER;
BEGIN
  v_base := p_valor;
  IF p_uf IN ('AM','RR','RO') THEN          -- regra regional
    v_base := v_base * 0.93;
  END IF;
  RETURN ROUND(v_base * p_aliquota / 100, 2);
END;
```

```ts
// Apollo (alvo): domínio testável, numeric via Decimal, regra explícita no dossiê
import Decimal from 'decimal.js';

export function calcularIcms(valor: Decimal, aliquota: Decimal, uf: string): Decimal {
  let base = valor;
  const UF_REDUCAO = new Set(['AM', 'RR', 'RO']); // extraído do legado, citado no dossiê §5
  if (UF_REDUCAO.has(uf)) {
    base = base.mul('0.93');
  }
  return base.mul(aliquota).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
```

O teste de paridade roda os **mesmos inputs** na function Oracle e nesta função e exige resultado idêntico ao centavo ([../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)). A regra `'AM','RR','RO'` e o fator `0.93` saem do dossiê — não se inventa, se extrai.

### Exemplo: agregação pesada → pl/pgsql

Um fechamento que soma milhões de itens não deve puxar tudo para a app. Reescreve a procedure em pl/pgsql, mantendo o trabalho perto do dado.

```sql
-- Postgres: fechamento set-based permanece no banco (worker o invoca)
CREATE OR REPLACE FUNCTION fn_fechamento_diario(p_store_id int, p_dia date)
RETURNS TABLE (total_bruto numeric, total_desc numeric, qtd_cupons bigint)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT COALESCE(SUM(v.total), 0),
         COALESCE(SUM(v.desconto), 0),
         COUNT(*)
  FROM   venda v
  WHERE  v.store_id = p_store_id
    AND  v.data_mov::date = p_dia;
END;
$$;
```

O **worker tier** (ADR-005) invoca isso fora da API interativa. Mover essa soma para a app puxaria milhões de linhas pela rede — exatamente o que não se faz.

### Packages

Oracle **packages** (`CREATE PACKAGE` + body) não têm equivalente direto em Postgres. Opções:

- **Schema namespace + funções** — agrupe as functions do package num schema Postgres (`fiscal.calcula_icms`, `fiscal.calcula_pis`). Aproxima o namespacing.
- **Package state** (variáveis de pacote que guardam estado entre chamadas na sessão) **não existe** em pl/pgsql — esse é um anti-padrão escondido; reescreva passando estado explícito ou subindo para o service.
- **A maioria dos packages de regra** vai para **módulos NestJS** — é a tradução natural (package fiscal → módulo `fiscal`), e ganha testes.

## 5. Views

Views Oracle → views Postgres, geralmente **reescrita de SQL de dialeto**:

| Oracle | Postgres |
|---|---|
| `NVL(a, b)` | `COALESCE(a, b)` |
| `NVL2(a, b, c)` | `CASE WHEN a IS NOT NULL THEN b ELSE c END` |
| `DECODE(x, 1,'a', 2,'b', 'c')` | `CASE x WHEN 1 THEN 'a' WHEN 2 THEN 'b' ELSE 'c' END` |
| `SYSDATE` | `now()` / `current_timestamp` (atenção ao fuso) |
| `a || b` (concat) | igual, mas `NULL || x` difere (Oracle ignora NULL; Postgres propaga) |
| `ROWNUM <= n` | `LIMIT n` |
| `CONNECT BY` (hierárquico) | `WITH RECURSIVE` |
| `(+)` (outer join Oracle) | `LEFT/RIGHT JOIN` explícito |
| `TO_DATE`/`TO_CHAR` máscaras | `to_date`/`to_char` (máscaras parecidas, validar) |
| `TRUNC(data)` | `date_trunc('day', data)` |
| `MINUS` | `EXCEPT` |
| `DUAL` | omitir (`SELECT 1` sem FROM) |
| sequence `seq.NEXTVAL` | `nextval('seq')` |

A armadilha do `||` com NULL: no Oracle `'a' || NULL = 'a'`; no Postgres `'a' || NULL = NULL`. Views que concatenam endereço/nome podem "sumir" linhas. Use `COALESCE` ou `concat()` (que ignora NULL).

Materialized views do Oracle → `MATERIALIZED VIEW` do Postgres com `REFRESH` (atende o read model de relatório do ADR-007).

## ETL / migração de dados

O movimento de dados em si. Disciplina:

1. **Carga inicial em staging.** Extrair Oracle → arquivos (CSV/Parquet) ou stream direto → schema `staging` no Postgres do tenant. Não transforme na extração; traga cru.
2. **Transformar no staging** (SQL no Postgres): normalizar `'' → NULL`, `TRIM` de `CHAR`, ajustar fusos, converter tipos com as regras acima.
3. **Carregar nas tabelas finais** com as FKs e checks ativos — para o banco **rejeitar** dado inconsistente em vez de aceitá-lo silenciosamente.
4. **Ordem importa:** carregue respeitando dependências de FK (pais antes de filhos) ou desabilite FK durante a carga em massa e revalide depois.

```sql
-- carga em massa: a forma rápida no Postgres é COPY, não INSERT linha a linha
COPY staging.cliente FROM '/data/oracle_export/cliente.csv'
  WITH (FORMAT csv, HEADER true, NULL '');

-- transform + load idempotente (re-rodável: re-aplica sem duplicar)
INSERT INTO cliente (id, cnpj, nome, nome_fantasia, criado_em)
SELECT id,
       lpad(regexp_replace(cnpj, '\D', '', 'g'), 14, '0'),  -- normaliza CNPJ
       upper(unaccent(trim(nome))),
       NULLIF(trim(nome_fantasia), ''),                     -- '' -> NULL
       coalesce(criado_em, now())
FROM   staging.cliente
ON CONFLICT (id) DO UPDATE
  SET cnpj = excluded.cnpj, nome = excluded.nome,
      nome_fantasia = excluded.nome_fantasia;
```

Para **tabelas de 1TB** (tenant grande), a carga é em **lotes**, fora de horário, com `COPY` paralelizado por partição, e índices criados **depois** da carga (criar índice antes torna a inserção lenta) — `CREATE INDEX CONCURRENTLY` para não travar. Ver [migrations-expand-contract.md](migrations-expand-contract.md) para o runner em lote sobre os 900 bancos.

## Validação / reconciliação (provar que nada se perdeu)

Migrar sem reconciliar é torcer. Três níveis, do barato ao caro:

### Nível 1 — contagens (row counts)

Toda tabela: `COUNT(*)` na origem vs destino, **exatamente** igual.

```sql
-- Oracle
SELECT 'cliente' tabela, COUNT(*) n FROM cliente
UNION ALL SELECT 'venda', COUNT(*) FROM venda;
-- Postgres (mesma lista) -> diff tem de ser ZERO em toda linha
```

### Nível 2 — checksums / agregados de controle

Contagem igual não prova que o **conteúdo** veio certo (pode ter migrado linha com valor zerado). Compare **somas de controle** das colunas que importam:

```sql
-- Oracle e Postgres: somas que têm de bater (centavo a centavo)
SELECT SUM(total)        AS soma_total,
       SUM(desconto)     AS soma_desc,
       MIN(data_mov)     AS menor_data,
       MAX(data_mov)     AS maior_data,
       COUNT(DISTINCT store_id) AS lojas
FROM   venda;
```

Para detectar corrupção linha-a-linha em colunas-chave, um **hash agregado** independente de ordem:

```sql
-- Postgres: hash do conjunto, ordem-independente (xor de md5 por linha)
SELECT md5(string_agg(
         md5(id::text || '|' || coalesce(cnpj,'') || '|' || coalesce(total::text,'')),
         '' ORDER BY id))
FROM   venda;
-- compare com o equivalente calculado na origem
```

### Nível 3 — amostragem dirigida

Sortear N registros (e **todos** os casos de borda: valores nulos, máximos, negativos, datas extremas, o cliente do incidente conhecido) e comparar **campo a campo** origem×destino. Foque no fiscal: pegue notas reais e confira base de cálculo, impostos e totais ao centavo. Isto se entrelaça com o **teste de paridade** ([../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)) — a reconciliação prova que os **dados** vieram; a paridade prova que a **lógica** produz o mesmo.

> A reconciliação é **gate de cutover**: o tenant não vai a produção no Postgres enquanto contagens, checksums e amostra não baterem. Registre o relatório de reconciliação por tenant — é a evidência do go-live.

## Ferramentas

- **ora2pg** — a ferramenta de fato para Oracle→Postgres: converte schema (DDL, tipos), exporta dados, e **tenta** converter PL/SQL/views/triggers para pl/pgsql. Trate a conversão de código como **rascunho** — ela acerta a sintaxe, mas **não decide** "service vs pl/pgsql" (essa é decisão humana/dossiê) nem entende a regra de negócio. Use `ESTIMATE_COST` do ora2pg para dimensionar o esforço de cada package/procedure.
- **MCP de Postgres** — inspeção do **destino**: schema criado, volume, índices, `EXPLAIN` de queries migradas, validação de partições. É o instrumento de "não decidir no escuro" da canon ([../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md)).
- **Catálogos Oracle** (`user_tab_columns`, `user_sequences`, `user_triggers`, `user_source`, `user_dependencies`) — para **inventariar** o que existe antes de mapear (quantos triggers, quais packages, dependências entre objetos).
- **`pgloader`** — alternativa para a carga de **dados** (rápida), quando o schema já foi tratado.
- **`COPY` / `pg_dump`/`pg_restore`** — para mover dados já no Postgres (staging → final, ou tenant entre instâncias).

## Cutover por tenant + dual-run

O cutover **não é global** — é **por tenant** (ADR-003: cada cliente é um banco, com janela de upgrade independente). Cada um dos 900 vira no seu tempo, com rollback próprio. O padrão é **dual-run**: rodar legado (Oracle) e novo (Postgres) **em paralelo** por um período, comparando, antes de cortar de vez.

```
  CUTOVER DE UM TENANT (Oracle -> Postgres)

  [1] CARGA INICIAL          Oracle (prod) ──ETL──> Postgres (staging->final)
                             reconcilia (contagem/checksum/amostra)  ── GATE

  [2] DUAL-RUN (dias)        escrita ainda no Oracle; CDC/replicação espelha no Postgres
                             relatórios/telas rodam contra Postgres em SHADOW
                             compara saída legado×novo (paridade em produção)

  [3] CONGELA + DELTA        janela curta: congela emissão no Oracle,
                             aplica último delta, alinha sequences (numeração fiscal!)

  [4] VIRA                   tráfego do tenant aponta pro Postgres (registry de tenant)
                             Oracle vira read-only standby (rollback rápido)

  [5] OBSERVA + APOSENTA     monitora N dias; ok -> desliga Oracle daquele tenant
                             não ok -> rollback: registry volta pro Oracle
```

Notas que tornam o dual-run seguro:

- **Direção única de escrita por vez.** Durante o dual-run, o Oracle continua dono da escrita; o Postgres recebe por replicação/CDC e serve **leitura sombra**. Escrita dupla simultânea é fonte de divergência — evite.
- **Reconciliação contínua**, não só no D0: durante o dual-run, compare agregados diários Oracle×Postgres; divergência = bug a corrigir antes de virar.
- **Rollback é trocar o ponteiro** no registry de tenant ([../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md)) de volta ao Oracle, com o Oracle ainda vivo como standby por N dias.
- **Numeração fiscal** alinhada no passo [3] — congelar, capturar o último número, continuar exato (seção Sequences acima).
- **Janela curta** só no passo [3] (congela+delta+vira); o trabalho pesado (carga, dual-run) é feito **antes**, sem afetar a operação.

Como cada tenant vira no seu tempo, durante meses há tenants no Oracle e tenants no Postgres **ao mesmo tempo** — é o mesmo fato de vida do schema versionado por tenant ([migrations-expand-contract.md](migrations-expand-contract.md)). O código da app já é stateless e roteia por tenant (ADR-004); só o registry sabe quem está onde.

## Ver também

- [migrations-expand-contract.md](migrations-expand-contract.md) — depois de no Postgres, **como** o schema evolui sem downtime nos 900 bancos.
- [versioning-and-compatibility.md](versioning-and-compatibility.md) — por que tenants em versões diferentes ao mesmo tempo é a vida normal.
- [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md) — db-per-tenant, registry de tenant, particionamento do grande.
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — paridade legado×novo (prova a lógica; a reconciliação prova os dados).
- [../06-testing-quality/testing-strategy.md](../06-testing-quality/testing-strategy.md) — tolerância zero de centavo no fiscal.
- [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) — MCP de Postgres para inspecionar schema/volume.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-011, ADR-003, ADR-009.
