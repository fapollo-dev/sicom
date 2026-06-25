# Harness de Paridade (arquivo-coroa)

> O mecanismo que prova **legado×novo idênticos**: captura o **golden** do legado rodando (SQL e outputs em runtime), roda os **mesmos inputs** no novo, e **compara**. Data-driven, alimentado pelos casos golden do dossiê. A regra de ouro: **verde que não exercita o caminho real — SQL real, condicional real, dispatch real — é falsa confiança.**

## Pré-requisitos de leitura

- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — o loop legado×novo e a regra de ouro do eval.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — paridade comportamental provada (critério de sucesso); o anti-objetivo do verde cego.
- [testing-strategy.md](testing-strategy.md) — onde a paridade se encaixa na pirâmide (prioridade máxima).
- [../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md) — **a captura de SQL/outputs em runtime** (de onde vem o golden).
- [../04-screen-dossier/dossier-template.md](../04-screen-dossier/dossier-template.md) — os casos golden (§9) que alimentam o harness.

---

## O que é, em uma frase

Um **executor data-driven** que, para cada caso golden, alimenta o **mesmo input** ao legado e ao novo e exige **output igual** (e — quando aplicável — a **mesma SQL** e o **mesmo conjunto de efeitos**). O golden do legado é o **oráculo**: não decidimos o que é "certo" de cabeça; o velho sistema, que produção já confia há 20 anos, decide.

```
   ┌──────────────┐   captura runtime   ┌──────────────────────────────┐
   │  LEGADO      │ ──────────────────► │ GOLDEN (fixture versionada)  │
   │  (Delphi)    │  SQL + params +     │ input → { sql, rows, outputs,│
   │              │  rows + outputs     │          effects }           │
   └──────────────┘                     └──────────────┬───────────────┘
                                                       │ mesmo input
                                                       ▼
   ┌──────────────┐                     ┌──────────────────────────────┐
   │  NOVO        │ ──── roda ────────► │ COMPARADOR                   │
   │ (NestJS/PG)  │  produz outputs     │ legado == novo ?             │
   └──────────────┘                     │  outputs, sql normalizada,   │
                                        │  efeitos. diff = REPROVA     │
                                        └──────────────────────────────┘
```

---

## Como construir — as três fases

### Fase 1 — Capturar o golden do legado (em runtime)

Não basta ler o `.pas`: a SQL dinâmica e o resultado têm de ser **observados rodando** ([../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md)). Liga-se o log de query (FireDAC `OnExecute`/trace, ou trace do banco), **exercita-se a tela** percorrendo cada caminho condicional do dossiê, e grava-se um registro por caso:

```json
// golden/cadProduto/Q2-busca-comEstoque.json — capturado do legado rodando
{
  "id": "G-02",
  "covers": ["Q2:caminho(b)+(c)", "filtro busca + comEstoque"],
  "input": {
    "session": { "empresa": 7, "usuario": "CAIXA01" },
    "fields":  { "busca": "arroz", "comEstoque": true, "inativos": false, "ordem": 0 }
  },
  "observed": {
    "sql": "SELECT P.COD, P.DESCRICAO, P.PRECOVENDA FROM PRODUTO P WHERE P.EMPRESA=:emp AND P.ATIVO='S' AND UPPER(P.DESCRICAO) LIKE :busca AND EXISTS (SELECT 1 FROM ESTOQUE E WHERE E.COD=P.COD AND E.QTD>0) ORDER BY P.DESCRICAO",
    "params": { "emp": 7, "busca": "%ARROZ%" },
    "rows":   [ { "COD": 1011, "DESCRICAO": "ARROZ TIPO 1 5KG", "PRECOVENDA": 24.90 }, "…" ],
    "rowCount": 12,
    "outputs": { "gridTitle": "12 produto(s)" },
    "effects": []
  },
  "captured": { "from": "Delphi build 3.41", "at": "2026-06-10", "by": "analista-legado" }
}
```

Princípios da captura:
- **Um golden por caminho condicional** do dossiê (§4) e por regra (§5) — não um por tela. A §9 do dossiê lista quais.
- **Capture a SQL real, com params reais** — é a prova de que o branch certo foi tomado.
- **Capture os efeitos** que a SQL não mostra: linhas inseridas por **trigger**, sequence consumida, documento gerado ([../04-screen-dossier/dossier-template.md](../04-screen-dossier/dossier-template.md) §6).
- **Golden de cálculo** (fiscal/financeiro) guarda os valores **verbatim** — 1 centavo importa.
- **Versione o golden** junto do dossiê e do código ([../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md)).

### Fase 2 — Rodar o novo com o mesmo input (o caminho real)

O harness pega `input` do golden e roda o **novo** — pelo **caminho que produção usa**. Não uma simplificação: o repository real, contra **Postgres real**, com o tenant/transação reais, e — se há ramo assíncrono (fila/worker) — exercitando-o de verdade.

```ts
// parity/runner.ts — executor data-driven, um caso golden por vez
import { loadGoldens } from './golden';
import { runLegacyMirror } from './legacyMirror'; // opção: re-executa o legado vivo (ver Fase 3)
import { diffParity } from './diff';

for (const g of loadGoldens('cadProduto')) {
  test(`paridade ${g.id} — ${g.covers.join(', ')}`, async () => {
    // roda o NOVO pelo caminho REAL: service+repository contra Postgres real
    const novo = await app.run(g.input);          // sem mock do repo/da query/do dispatch

    // compara contra o golden capturado do legado
    const verdict = diffParity(g.observed, novo, {
      compareSql: true,            // a SQL normalizada tem de bater (provou o branch certo)
      compareRows: 'orderedByKey', // mesma ordem que o ORDER BY do legado
      money: 'exact',              // tolerância ZERO em valores fiscais/financeiros
      effects: true,              // triggers/sequence/documento gerado
    });

    expect(verdict.equal, verdict.report).toBe(true);
  });
}
```

### Fase 3 — Comparar (e o que "igual" significa)

O comparador é onde a falsa confiança morre. Ele compara **três planos**, não só o output visível:

| Plano | O que compara | Por que importa |
|---|---|---|
| **Outputs** | valores retornados/exibidos (preço, total, imposto, mensagens, rowCount) | é o que o usuário/fisco vê |
| **SQL** | a query emitida pelo novo, **normalizada**, contra a do golden | prova que o **branch condicional real** foi tomado (não um atalho) |
| **Efeitos** | inserts por trigger, sequence consumida, documento/evento gerado | a escrita-fantasma que a tela "não sabe" que faz |

Normalização de SQL (para comparar intenção, não dialeto): minúsculas, espaços colapsados, Oracle→Postgres conhecido (`NVL`↔`COALESCE`, `(+)`↔`LEFT JOIN`, `SYSDATE`↔`now()`, `ROWNUM`↔`LIMIT`), params nomeados estáveis. **Não** normalize a estrutura de JOIN/WHERE/ORDER — essa é justamente a paridade que se quer.

```ts
// parity/diff.ts — comparador com os 3 planos
export function diffParity(golden: Observed, novo: Actual, opts: DiffOpts): Verdict {
  const problems: string[] = [];

  // 1) outputs — dinheiro com tolerância ZERO
  for (const [k, gv] of Object.entries(golden.outputs ?? {})) {
    if (!deepEqualMoneyAware(gv, novo.outputs?.[k], opts.money)) // 'exact' => 1 centavo reprova
      problems.push(`output.${k}: legado=${fmt(gv)} novo=${fmt(novo.outputs?.[k])}`);
  }
  // rows na mesma ordem do ORDER BY do legado
  if (opts.compareRows && !rowsEqual(golden.rows, novo.rows, opts.compareRows))
    problems.push(rowsReport(golden.rows, novo.rows));

  // 2) SQL — normalizada; prova o caminho real
  if (opts.compareSql && normalizeSql(golden.sql) !== normalizeSql(novo.sql))
    problems.push(`SQL divergente:\n  legado: ${golden.sql}\n  novo:   ${novo.sql}`);

  // 3) efeitos — triggers/sequence/documento
  if (opts.effects && !effectsEqual(golden.effects, novo.effects))
    problems.push(effectsReport(golden.effects, novo.effects));

  return { equal: problems.length === 0, report: problems.join('\n') };
}
```

> **Modo "espelho vivo" (opcional, mais forte):** em vez de só comparar contra o golden gravado, o harness re-executa o **legado vivo** (banco de teste restaurado, mesma carga) no mesmo input e compara em tempo real (`runLegacyMirror`). Pega regressão que um golden estático envelhecido esconderia. Use para o **fiscal** e onde a regra muda com frequência.

---

## A regra de ouro: verde sem caminho real é falsa confiança

> Um teste verde que **não toca a SQL real, a condicional real e o dispatch real** prova nada — pior, dá confiança falsa. ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md), [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md))

Como o harness **força** o caminho real (não é opção — é design):

- **SQL real:** `compareSql: true`. Se o novo não emitiu a query equivalente à do golden, reprova — mesmo que o output "por acaso" bata. Um mock de repository nunca passaria nesse plano (não há SQL para comparar).
- **Condicional real:** **um golden por branch** (§4 do dossiê). Cobrir só o caminho feliz deixa branches sem golden → o harness acusa **lacuna de cobertura** no fechamento da tela, não "verde".
- **Dispatch real:** se o caso tem ramo assíncrono (fila/worker, ADR-005), o harness roda o caso **através** do dispatch e verifica o efeito ao final — não chama o handler direto pulando a fila. (Lição importada: feature que vive no caminho síncrono e some no assíncrono **passa** num eval cego — aqui não, porque o caso exercita o dispatch que produção usa.)
- **Banco real:** integration roda contra **Postgres real**, não in-memory que diverge em trigger/dialeto/ordenação.
- **Motor offline real:** golden fiscal/PDV roda **no motor que o Electron usa offline** (ADR-008), não só na API da nuvem.

Teste de fumaça do próprio harness: **mute uma linha de regra no novo e confirme que algum caso fica vermelho.** Se nada quebra, a suíte é falsa confiança — conserte a suíte antes de confiar no verde (mutation testing dirigido ao dossiê).

---

## Estrutura de um caso de teste (exemplo completo)

```
parity/
  cadProduto/
    goldens/
      G-01-margem.json            # cobre BR-07 (cálculo de margem)
      G-02-busca-comEstoque.json  # cobre Q2 caminho (b)+(c)
      G-03-ean-duplicado.json     # cobre BR-03 (EAN dup) + mensagem
      G-08-fiscal-ST.json         # cobre BR-12 (ICMS-ST) — tolerância ZERO
    cadProduto.parity.spec.ts     # runner data-driven (acima)
```

```ts
// G-01: paridade de cálculo (unit-shaped, mas oráculo = legado)
test('G-01 margem: custo=10,00 margem=30% → preço=14,29 (verbatim do legado)', async () => {
  const g = loadGolden('cadProduto', 'G-01');          // { input:{custo:10, margem:30}, observed:{outputs:{preco:14.29}} }
  const novo = precoService.porMargem(g.input.custo, g.input.margem);
  // round-half-to-even capturado do RoundTo do Delphi; half-up daria 14,29 também aqui,
  // mas há casos onde diverge 1 centavo — por isso o golden é verbatim, não recalculado.
  expect(novo).toBe(g.observed.outputs.preco);
});
```

```ts
// G-08: paridade fiscal — roda no MOTOR OFFLINE, tolerância zero
test('G-08 ICMS-ST NCM 2202.10.00 UF=SP — motor offline (Electron)', async () => {
  const g = loadGolden('cadProduto', 'G-08');
  const cupom = await fiscalEngineOffline.calcular(g.input);   // o MESMO motor que o PDV usa offline
  const v = diffParity(g.observed, cupom, { money: 'exact', compareSql: false, effects: true });
  expect(v.equal, v.report).toBe(true);                        // 1 centavo de ST = reprova
});
```

---

## Onde o harness se conecta

- **Entrada:** os casos golden do dossiê (§9, [../04-screen-dossier/dossier-template.md](../04-screen-dossier/dossier-template.md)); a captura de runtime ([../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md)).
- **Execução:** a etapa 3 do loop por tela ([../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md)) — o verde que define "concluída".
- **Pirâmide:** prioridade máxima, atravessa unit/integration/e2e ([testing-strategy.md](testing-strategy.md)).
- **Teclado/fluxo:** o harness cobre dados/lógica; o fluxo de teclado e o E2E ponta-a-ponta vão em Playwright ([playwright-e2e.md](playwright-e2e.md)).

---

## Ver também

- [testing-strategy.md](testing-strategy.md) — a pirâmide e a prioridade da paridade.
- [playwright-e2e.md](playwright-e2e.md) — E2E e fluxos de teclado (o que o harness de dados não cobre).
- [README.md](README.md) — índice da seção 06.
- [../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md) — capturar SQL/outputs em runtime (a fonte do golden).
- [../04-screen-dossier/dossier-template.md](../04-screen-dossier/dossier-template.md) — os casos golden (§9).
- [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md) — o harness como etapa 3 do loop e definição de "concluída".
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — a regra de ouro do eval.
