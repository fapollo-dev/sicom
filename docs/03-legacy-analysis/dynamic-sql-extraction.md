# Extração de SQL dinâmica (arquivo-coroa)

> O problema central da extração: a SQL **nasce** no `.dfm` (`SQL.Strings`) mas **muta** no `.pas` em runtime, sob condicional — a SQL executada é uma **função do estado em runtime**. Extração puramente estática é **insuficiente**. Método em duas frentes: (A) estático, reconstruir o query builder implícito; (B) runtime, ligar o log do banco e **exercitar a tela** para capturar a verdade — e essas capturas viram **fixtures de teste** e a régua de paridade.

## Pré-requisitos de leitura

- [delphi-anatomy.md](delphi-anatomy.md) — o que é `SQL.Strings` no `.dfm`, `TFDQuery`, `ParamByName`, e o pareamento `.dfm`/`.pas`.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — "migre o que o sistema faz" e o anti-objetivo do **eval verde que não exercita o caminho real**.
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — a **regra de ouro do eval** e o uso do MCP de Postgres / captura de runtime.
- [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md) — o mapeamento canônico SQL dinâmica → query builder (Kysely), do qual este arquivo é a fundação.

> Este é **o** arquivo da seção 03. Se você só ler um, leia este. Errar a SQL dinâmica é a forma número um de quebrar paridade sem perceber — o eval fica verde porque você testou o caminho que escreveu, não o caminho que produção executa.

---

## O problema, com precisão

Num form Delphi, um dataset (`TFDQuery`/`TQuery`) tem uma SQL **de design-time** no `.dfm`:

```pascal
// CadProduto.dfm — a SEMENTE
object qryProduto: TFDQuery
  Connection = dmPrincipal.conn
  SQL.Strings = (
    'SELECT id, codigo, descricao, preco_venda'
    'FROM produto'
    'WHERE id_empresa = :emp')
end
```

Se a história parasse aqui, extração estática bastava: leia o `.dfm`, copie a SQL, traduza. **Mas não para.** O `.pas` **reescreve** essa SQL em runtime, e quase sempre **condicionalmente**:

```pascal
procedure TfrmConsultaProduto.Buscar;
begin
  qry.Close;
  qry.SQL.Clear;                                              // joga a semente fora!
  qry.SQL.Add('SELECT p.id, p.codigo, p.descricao, p.preco_venda');
  qry.SQL.Add('FROM produto p');
  qry.SQL.Add('WHERE p.id_empresa = :emp');

  if chkSomenteAtivos.Checked then
    qry.SQL.Add('AND p.ativo = ''S''');                        // condicional 1

  if edDescricao.Text <> '' then
    qry.SQL.Add('AND UPPER(p.descricao) LIKE ' +              // condicional 2 (concatena!)
                QuotedStr('%' + UpperCase(edDescricao.Text) + '%'));

  if cmbOrdem.ItemIndex = 1 then
    qry.SQL.Add('ORDER BY p.preco_venda DESC')                // condicional 3
  else
    qry.SQL.Add('ORDER BY p.descricao');

  qry.ParamByName('emp').AsInteger := EmpresaAtual;
  qry.Open;
end;
```

A SQL **realmente executada** depende de:

- `chkSomenteAtivos.Checked` (um checkbox),
- `edDescricao.Text` (um campo de texto digitado),
- `cmbOrdem.ItemIndex` (um combo),
- `EmpresaAtual` (uma variável global, talvez setada por outra tela).

Há **pelo menos 2 × 2 × 2 = 8 SQLs distintas** que essa tela emite, mais a variação de parâmetro. **Nenhuma delas está escrita inteira em lugar nenhum** — cada uma é montada na hora. É um **query builder implícito**, escondido no fluxo procedural.

> Conclusão dura: **a SQL não é um texto, é uma função `f(estado) → SQL`.** Quem extrai só a semente do `.dfm` migra **uma** das 8 e jura que migrou a tela. Isso é o eval-verde-falso que a missão proíbe.

### Os verbos de mutação que você precisa caçar

A SQL muda por um vocabulário pequeno e fechado de operações sobre `TStrings`/`TFDQuery`. Caçar **todas** as ocorrências destes no `.pas` é a frente estática:

| Operação Pascal | O que faz | Sinal para o agente |
|-----------------|-----------|---------------------|
| `qry.SQL.Clear` | Apaga a SQL (descarta a semente do `.dfm`) | A semente do `.dfm` **não vale** — a verdade é construída abaixo |
| `qry.SQL.Add('...')` | Acrescenta uma linha | Cada `Add` sob `if` é uma **cláusula condicional** |
| `qry.SQL.Text := '...'` | Substitui a SQL inteira | Reset total — leia a string montada |
| `qry.SQL[i] := '...'` | Reescreve a **linha i** | Mutação por índice — fácil de perder; rara mas existe |
| `qry.SQL.Insert(i, '...')` | Insere linha na posição i | Idem |
| `StringReplace(s, '#FILTRO#', x, ...)` | Substitui um **placeholder** dentro da string | Template com marcadores — caça o placeholder e todas as substituições |
| `Format('... %s ...', [x])` | Interpola | Concatenação por formatação |
| `'...' + variavel + '...'` | Concatena | **Risco de SQL injection no legado** e variação de SQL |
| `qry.ParamByName('x').AsXxx := v` | Liga um parâmetro `:x` | Não muda o **texto**, muda o **valor** — capture os dois |
| `qry.MacroByName('m').AsRaw := v` | Macro FireDAC `&m` — injeta **texto** (pode ser cláusula inteira!) | Perigoso: macro injeta SQL bruta, não valor |

> `ParamByName` (`:x`) é **valor parametrizado** (seguro, vira `?`/`$1`). `MacroByName` (`&m`) e concatenação de string **injetam texto** e podem mudar a estrutura da query (até cláusulas inteiras). Distinguir os dois é vital: parâmetro vira binding; macro/concatenação vira **ramo condicional** no query builder.

---

## Frente A — Estático: reconstruir o query builder implícito

Objetivo: a partir do `.dfm` + `.pas`, montar o **mapa de todos os caminhos** que a SQL pode tomar. Não para gerar a SQL final (runtime faz melhor), mas para **enumerar as condicionais** que precisam ser exercitadas e não deixar nenhuma escapar.

### Passo 1 — localizar todas as sementes

Do `.dfm` (já coletadas pelo parser em [delphi-anatomy.md](delphi-anatomy.md), `extractSqlSeeds`): cada `TFDQuery.SQL.Strings`. Do `.pas`: literais SQL em `SQL.Text :=`, constantes string com `SELECT`/`INSERT`/`UPDATE`/`DELETE`, e SQL embutida em chamadas a `ExecSQL`/`Open`.

```ts
// scripts/sql/find-seeds.ts — sementes no .pas (complementa as do .dfm)
const sqlLiteralRe = /'((?:SELECT|INSERT|UPDATE|DELETE|MERGE)[\s\S]*?)'/gi;
// + capturar concatenações multi-linha: 'SELECT ...' + #13#10 + '...'
```

### Passo 2 — localizar TODOS os pontos de mutação

Para **cada** dataset, grep no `.pas` por seu nome seguido dos verbos da tabela acima:

```ts
// para o dataset 'qry', encontrar todos os pontos onde a SQL dele muda
function findMutationPoints(pas: string, dataset: string): MutationPoint[] {
  const verbs = ['SQL.Clear', 'SQL.Add', 'SQL.Text', 'SQL\\[', 'SQL.Insert',
                 'MacroByName', 'ParamByName'];
  const re = new RegExp(`\\b${dataset}\\.(${verbs.join('|')})`, 'g');
  // para cada match, capturar a LINHA e o BLOCO if/case que a envolve
  // -> { line, kind:'Add'|'Param'|'Macro'|..., condition:'chkSomenteAtivos.Checked', text:"AND p.ativo='S'" }
}
```

O que registrar em cada ponto de mutação:

- **a cláusula** que ele adiciona/altera (`AND p.ativo = 'S'`),
- **a condição** que o governa (`chkSomenteAtivos.Checked`, `edDescricao.Text <> ''`, `cmbOrdem.ItemIndex = 1`),
- **a origem da condição** (um controle da tela? uma global? um parâmetro recebido?),
- se é **valor** (`ParamByName`) ou **texto** (`Add`/`Macro`/concatenação).

### Passo 3 — reconstruir o query builder implícito

Junte as sementes + mutações numa estrutura que descreve **a função `f(estado) → SQL`**:

```ts
// o "query builder implícito" reconstruído estaticamente
interface ImplicitQuery {
  dataset: 'qry';
  base: 'SELECT p.id, p.codigo, p.descricao, p.preco_venda FROM produto p WHERE p.id_empresa = :emp';
  branches: Array<{
    condition: string;        // 'chkSomenteAtivos.Checked'
    appends: string;          // "AND p.ativo = 'S'"
    kind: 'text' | 'param' | 'macro';
  }>;
  params: Array<{ name: 'emp'; source: 'EmpresaAtual (global)'; type: 'Integer' }>;
  exclusiveGroups?: string[][]; // ex.: o if/else do ORDER BY são mutuamente exclusivos
}
```

Disto sai a **matriz de caminhos** a exercitar: cada combinação de condições é um caminho de SQL. Com `exclusiveGroups` (if/else, `case`) você poda combinações impossíveis. O resultado é a **lista de fixtures que a frente B precisa capturar** — uma por caminho.

> A frente A **não** produz a SQL final confiável. Ela produz o **inventário de condicionais** (para não esquecer nenhuma — princípio "não perder nenhuma condicional", [business-rule-extraction.md](business-rule-extraction.md)) e o **roteiro de exercício** para a frente B. Por que não confiar nela sozinha? Porque concatenação de string, macros, `StringReplace` e estado vindo de fora produzem SQLs que você **não consegue** reconstruir com certeza só lendo. A verdade exige rodar.

---

## Frente B — Runtime: a verdade (e as fixtures)

A única forma de saber **exatamente** qual SQL cada caminho produz é **fazer o legado emitir e capturar**. Você liga o log de query no banco (ou um SQL monitor), **exercita a tela** acionando cada condicional, e captura a SQL real, os parâmetros reais e o resultado real. Cada captura é uma **fixture** `input → SQL → resultado`.

### Como ligar a captura

Opções, da melhor para a pior:

1. **Log do banco (preferido).** No PostgreSQL alvo da própria análise (ou num banco-sombra de teste com dados representativos), `log_statement = 'all'` + `log_min_duration_statement = 0`. Captura a SQL **exatamente** como chegou ao banco, já com parâmetros resolvidos no log (`DETAIL: parameters: $1 = '42'`).
2. **SQL monitor do FireDAC** (`TFDMonitorClient` / FDMonitor): mostra cada comando que o driver envia, no formato do app — útil quando você roda o legado original.
3. **Trace do driver / proxy** (ex.: um proxy de Postgres que loga). Bom quando não dá para mexer no banco.

```ini
# postgresql.conf no banco-sombra de extração — captura tudo, sem dó
log_statement = 'all'
log_min_duration_statement = 0
log_line_prefix = '%m [%p] app=%a '   # timestamp + pid + application_name
log_parameter_max_length = -1          # não trunca os parâmetros
```

> Use um **banco-sombra de extração** (cópia de dados representativos), não produção. Você vai exercitar telas muitas vezes; não queira esse barulho/risco em produção. O log fica volumoso — filtre por `application_name` da tela em teste.

### Como exercitar (acionar cada condicional)

Do inventário da frente A você tem a matriz de caminhos. Para a tela de consulta de produto acima:

| # | chkSomenteAtivos | edDescricao | cmbOrdem | Ação no legado |
|---|------------------|-------------|----------|----------------|
| 1 | desmarcado | vazio | índice 0 | abrir e buscar |
| 2 | **marcado** | vazio | índice 0 | marcar checkbox, buscar |
| 3 | desmarcado | **"arroz"** | índice 0 | digitar, buscar |
| 4 | desmarcado | vazio | **índice 1** | trocar ordenação, buscar |
| 5 | marcado | "arroz" | índice 1 | combinar tudo, buscar |
| ... | ... | ... | ... | cobrir os caminhos da matriz |

Cada linha é um **caso de teste manual** roteirizado (o roteiro mora no dossiê, seção 04). Você roda, o log captura. Para telas com muitas condicionais, priorize os caminhos **reais** (os que produção usa — dá para inferir do log de produção quais combinações aparecem) e os de **borda**.

### A captura vira fixture

Cada exercício produz uma fixture estruturada — a **golden** do legado:

```jsonc
// fixtures/consulta-produto/caso-05.json — input -> SQL real -> resultado real
{
  "screen": "ConsultaProduto",
  "path": "ativos+descricao+ordemPreco",
  "input": {
    "chkSomenteAtivos": true,
    "edDescricao": "arroz",
    "cmbOrdem": 1,
    "EmpresaAtual": 7
  },
  "capturedSql": "SELECT p.id, p.codigo, p.descricao, p.preco_venda FROM produto p WHERE p.id_empresa = $1 AND p.ativo = 'S' AND UPPER(p.descricao) LIKE '%ARROZ%' ORDER BY p.preco_venda DESC",
  "params": { "$1": 7 },
  "rowCount": 12,
  "resultDigest": "sha256:…",          // hash do resultset ordenado p/ comparação de paridade
  "firstRows": [ { "id": 81, "codigo": "1004", "descricao": "ARROZ TIPO 1 5KG", "preco_venda": 24.90 } ]
}
```

Essas fixtures são **duas coisas ao mesmo tempo**:

1. A **régua de paridade** — o novo código tem que produzir SQL equivalente e **o mesmo resultado** para o mesmo input (ver [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)).
2. A **verdade de extração** — elas confirmam (ou corrigem) o query builder reconstruído na frente A. Divergência entre o que a frente A previu e o que a frente B capturou = você perdeu uma condicional. Volte e ache.

> **Esta é a materialização da regra de ouro do eval** ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)): o teste de paridade roda **a SQL que produção roda**, capturada do legado em execução — não a SQL que o agente *achou* que o legado roda.

---

## Mapeamento para o query builder NestJS (Kysely)

A montagem condicional do Delphi (`if ... SQL.Add`) mapeia **1:1** para `.where()` encadeado no Kysely — cada condicional do `.pas` vira um `if` que adiciona uma cláusula, **na mesma ordem**. O lado a lado canônico vive em [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md); aqui aprofundamos o caso com **macro/ordenação condicional/concatenação**, que é o que dói.

### Exemplo completo — Pascal condicional → Kysely

Pascal (a verdade capturada na frente B):

```pascal
procedure TfrmConsultaProduto.Buscar;
begin
  qry.Close; qry.SQL.Clear;
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

  if cmbOrdem.ItemIndex = 1 then
    qry.SQL.Add('ORDER BY p.preco_venda DESC')      // ramos mutuamente exclusivos
  else
    qry.SQL.Add('ORDER BY p.descricao');

  qry.Open;
end;
```

Kysely (o alvo — condicional 1:1, na mesma ordem):

```ts
// cadastro/produto.repository.ts
export interface FiltroProduto {
  empresaId: number;
  somenteAtivos?: boolean;
  descricao?: string;
  categoriaId?: number;
  ordem?: 'descricao' | 'precoDesc';   // mapeia cmbOrdem.ItemIndex (0 -> descricao, 1 -> precoDesc)
}

@Injectable()
export class ProdutoRepository {
  constructor(private readonly dbp: DatabaseProvider) {}

  async buscar(f: FiltroProduto) {
    let q = this.dbp.forTenantRead()                 // consulta -> read replica (ADR-007)
      .selectFrom('produto as p')
      .leftJoin('categoria as c', 'c.id', 'p.id_categoria')
      .select(['p.id', 'p.codigo', 'p.descricao', 'p.preco_venda', 'c.nome as categoria'])
      .where('p.id_empresa', '=', f.empresaId);       // :emp (param, não texto)

    // cada if do .pas -> um .where() condicional, MESMA ordem, MESMA semântica
    if (f.somenteAtivos) q = q.where('p.ativo', '=', 'S');

    if (f.descricao) {
      // replica EXATO: UPPER + LIKE + %…% (a semântica do legado, não "uma busca parecida")
      q = q.where(sql`upper(p.descricao)`, 'like', `%${f.descricao.toUpperCase()}%`);
    }

    if (f.categoriaId) q = q.where('p.id_categoria', '=', f.categoriaId);

    // o if/else do ORDER BY -> escolha exclusiva
    q = f.ordem === 'precoDesc'
      ? q.orderBy('p.preco_venda', 'desc')
      : q.orderBy('p.descricao', 'asc');

    // q.compile().sql é a SQL REAL — comparável byte-a-byte (após normalização) à fixture do legado
    return q.execute();
  }
}
```

### A tabela de tradução de mutação → builder

| Mutação Delphi | Construção Kysely | Cuidado de paridade |
|----------------|-------------------|---------------------|
| `SQL.Add('AND x = :p')` + `ParamByName` | `.where('x', '=', p)` | Param vira binding — ✅ seguro |
| `SQL.Add('AND UPPER(d) LIKE :p')` | `.where(sql\`upper(d)\`, 'like', ...)` | Replicar `UPPER`/collation; **acento** importa (ver nota) |
| `if/else` sobre `ORDER BY` | `.orderBy(...)` em ramo exclusivo | Ordem do resultset é parte da paridade |
| `MacroByName('m').AsRaw := '...'` (injeta texto) | ramo `if` que escolhe cláusula/tabela | Macro = estrutura variável — vira **branch**, não param |
| `'... ' + variavel + ' ...'` (concatenação) | binding (`.where(..., var)`) se for valor; branch se for estrutura | Nunca concatene valor no alvo — sempre binding |
| `StringReplace(sql, '#F#', filtro, [])` | template → branch que injeta a cláusula | Caçar **todas** as substituições do placeholder |

> **Nota de acento/collation** (já mordeu antes em projeto irmão): `UPPER(descricao) LIKE '%ARROZ%'` no Oracle/legado pode ter semântica de acento diferente do Postgres. Quando o legado normaliza para sem-acento/UPPERCASE, replique com `unaccent`/`upper` no alvo e **prove com a fixture** — não confie no "parece igual". A divergência só aparece nos dados com acento, que o caminho feliz não cobre.

---

## Validar a SQL reconstruída com o MCP de Postgres

Antes de declarar paridade, valide a SQL do alvo **contra o banco real** usando o **MCP de Postgres** ([../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md)). Duas validações:

1. **A SQL roda e retorna o mesmo conjunto** que a fixture do legado. Rode a SQL compilada (`q.compile().sql` + params) no MCP contra o banco-sombra com os mesmos dados e compare `rowCount` + `resultDigest` com a fixture.
2. **O plano faz sentido** (`EXPLAIN`): a SQL reconstruída usa os índices certos, não faz seq scan onde o legado usava índice. Isso conecta com o [../02-stack-and-standards/performance-playbook.md](../02-stack-and-standards/performance-playbook.md) (índices decididos com EXPLAIN via MCP).

```
-- via MCP de Postgres, sobre o banco-sombra de extração:
-- 1) paridade de resultado: roda a SQL do alvo com os params da fixture
SELECT p.id, p.codigo, p.descricao, p.preco_venda, c.nome AS categoria
FROM produto p LEFT JOIN categoria c ON c.id = p.id_categoria
WHERE p.id_empresa = 7 AND p.ativo = 'S'
  AND upper(p.descricao) LIKE '%ARROZ%'
ORDER BY p.preco_venda DESC;
-- compara rowCount/digest com fixtures/consulta-produto/caso-05.json

-- 2) sanidade de plano
EXPLAIN (ANALYZE, BUFFERS)
SELECT ... ;   -- confere uso de índice em (id_empresa, ativo) etc.
```

> O MCP de Postgres é como o agente **decide informado por dados reais** (cardinalidade, índices, plano) e **prova** que a SQL reconstruída é equivalente — nunca "no escuro" ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)).

---

## Conexão com o harness de paridade

O fluxo inteiro fecha o loop **Fazer → Revisar → Revisar legado × novo**:

```
.dfm (sementes)  ─┐
                  ├─ A) estático: query builder implícito + matriz de caminhos
.pas (mutações)  ─┘                          │
                                             ▼ (roteiro de exercício)
legado em execução ── log do banco ── B) fixtures: input → SQL real → resultado real
                                             │
                                             ▼
        repository Kysely (frente A→código)  │  ← MCP Postgres valida SQL+plano
                                             ▼
        parity harness: mesmo input no novo  ==  fixture do legado?  ──→ verde só se igual
```

As fixtures capturadas aqui **são** os golden tests do harness ([../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)): mesmos inputs, compara a SQL emitida e o resultado. Verde no harness é o único verde que conta — e ele só é honesto porque a fixture veio do **legado em execução**, não de uma leitura otimista do `.pas`.

> O produto de extração desta tela — sementes + inventário de condicionais + fixtures por caminho + o repository reconstruído — **mora no dossiê** (seção 04, ADR-012). Nenhuma tela com SQL dinâmica está "pronta" sem a matriz de caminhos exercitada e as fixtures verdes.

---

## Checklist do agente (não pule)

- [ ] Coletei **todas** as sementes (`SQL.Strings` no `.dfm` + literais SQL no `.pas`).
- [ ] Grepei **todos** os pontos de mutação (`SQL.Clear/Add/Text/[i]/Insert`, `Macro`, concatenação, `StringReplace`) de **cada** dataset.
- [ ] Mapeei cada condicional à sua **origem** (controle / global / parâmetro recebido) e classifiquei **valor** (param) vs **texto** (branch).
- [ ] Montei a **matriz de caminhos** e podei combinações impossíveis (if/else, case).
- [ ] Liguei o log do banco e **exercitei cada caminho**, capturando `input → SQL → resultado` como fixture.
- [ ] Confirmei que a frente A previu **todos** os caminhos que a frente B capturou (divergência = condicional perdida).
- [ ] Traduzi para `.where()` encadeado **na mesma ordem e semântica** (incluindo `UPPER`/`LIKE`/acento/ordenação).
- [ ] Validei a SQL do alvo com o **MCP de Postgres** (resultado == fixture; `EXPLAIN` sadio).
- [ ] As fixtures estão no **harness de paridade** e passam.

---

## Ver também

- [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md) — o mapeamento canônico SQL dinâmica → Kysely (lado a lado) e a paridade via `q.compile()`.
- [business-rule-extraction.md](business-rule-extraction.md) — as condicionais que **não** são SQL (validação/cálculo) saem por aqui; nenhuma condicional se perde.
- [hidden-coupling-traps.md](hidden-coupling-traps.md) — o estado que governa a condicional (`EmpresaAtual` global, query de datamodule) muitas vezes vem de fora da tela.
- [delphi-anatomy.md](delphi-anatomy.md) — `SQL.Strings`, `TFDQuery`, `ParamByName` vs `MacroByName`, sementes.
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — as fixtures viram golden tests; régua de paridade legado × novo.
- [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) — MCP de Postgres para validar SQL e plano.
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — regra de ouro do eval; captura de runtime.
