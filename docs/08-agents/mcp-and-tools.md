# MCPs & Ferramentas

> As ferramentas que os agentes invocam para trabalhar **informados por dado real**, não no escuro: o **MCP de Postgres** (inspecionar schema, volume, índices, cardinalidade, `EXPLAIN`/planos antes de decidir índice/particionamento), **Playwright** (teste estruturado, inclusive teclado), a **captura de SQL em runtime**, e o uso responsável de tudo isso. A regra que atravessa a página: **nunca decida estrutura no escuro.**

## Pré-requisitos de leitura

- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — "decisões informadas por dados reais"; a regra de ouro do eval; captura de runtime.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — "migre o que o sistema faz" (a ferramenta serve a prova, não o palpite).
- [roster.md](roster.md) — quais agentes invocam quais ferramentas.
- [../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md) — a captura de SQL em runtime, em profundidade.
- [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md) — as decisões de banco (índice/partição/empacotamento) que o MCP informa.

---

## O princípio: nunca no escuro

> Decisão de estrutura (índice, particionamento, escolha de instância, reconstrução de SQL) **informada por dado real** — schema, volume, cardinalidade, índices existentes, plano de query — **antes** de decidir. Decidir no escuro é o anti-padrão que o Apollo proíbe ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)).

"No escuro" é, por exemplo: criar índice porque "parece que ajuda" sem ver o plano; escolher chave de partição por `store_id` sem medir a cardinalidade; declarar paridade de SQL sem rodar a query contra o banco real. As ferramentas abaixo existem para que a decisão seja **medida e provada**, não palpitada.

```
   PALPITE (proibido)                       INFORMADO POR DADO (o jeito Apollo)
   "acho que esse índice ajuda"             MCP: EXPLAIN ANALYZE → vê seq scan → cria índice → reconfirma plano
   "particiona por loja"                    MCP: count(distinct store_id) → cardinalidade real → escolhe a chave
   "a SQL nova está igual"                  MCP: roda a query, compara rowCount/digest com o golden do legado
   "o teste passou, tá bom"                 Playwright/harness: exercita o CAMINHO REAL, senão é falsa confiança
```

---

## MCP de Postgres — decisões informadas por dado real

O **MCP de Postgres** é a janela do agente para o banco **real** (o legado em análise, o banco-sombra de extração, ou o alvo). Ele permite **inspecionar e medir** antes de decidir — e **provar** depois. Usos canônicos:

### 1. Inspecionar schema

Entender a estrutura real (tipos, constraints, FKs, defaults) — base para reconstruir o schema-alvo e para o Migration Engineer planejar o Oracle→PG ([../05-migration-engineering/oracle-to-postgres.md](../05-migration-engineering/oracle-to-postgres.md)).

```
-- via MCP: o schema como ele REALMENTE é (não como o .dfm sugere)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_name = 'produto' ORDER BY ordinal_position;

SELECT conname, contype, pg_get_constraintdef(oid)        -- constraints e FKs reais
FROM pg_constraint WHERE conrelid = 'produto'::regclass;
```

### 2. Volume de tabela (e crescimento)

Quanto pesa cada tabela/banco — decide empacotamento (pequeno junto / grande dedicado), promoção de tier e se vale particionar ([../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md)).

```
-- via MCP: as maiores tabelas (decide partição/arquivamento)
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
```

### 3. Índices existentes e uso

Não criar índice redundante; achar índice **morto** (que só pesa na escrita, nunca é usado na leitura) — entra no [../02-stack-and-standards/performance-playbook.md](../02-stack-and-standards/performance-playbook.md).

```
-- via MCP: índices que nunca são usados (idx_scan = 0) → candidatos a remover
SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY pg_relation_size(indexrelid) DESC;
```

### 4. Cardinalidade

Medir a distribuição **antes** de escolher chave de partição ou estratégia de índice. Particionar por uma coluna de baixa cardinalidade (poucos valores) ou indexar uma de cardinalidade ruim é desperdício — ou pior.

```
-- via MCP: cardinalidade real antes de decidir a chave de partição
SELECT count(*) AS linhas, count(DISTINCT store_id) AS lojas,
       count(DISTINCT date_trunc('month', data_mov)) AS meses
FROM venda;   -- muitas lojas? muitos meses? decide LIST(store) vs RANGE(período) com NÚMERO
```

### 5. EXPLAIN / planos — antes de decidir índice/particionamento

O coração do "não no escuro": **ver o plano real** que a query toma. Confirma se a SQL reconstruída ([../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md)) usa índice ou faz seq scan; mede o efeito de um índice/partição **antes** de gravá-lo no schema.

```
-- via MCP: o plano REAL (não o imaginado)
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, p.descricao, p.preco_venda FROM produto p
WHERE p.id_empresa = 7 AND p.ativo = 'S' AND upper(p.descricao) LIKE '%ARROZ%'
ORDER BY p.preco_venda DESC;
-- procura: Seq Scan onde deveria ser Index Scan? a ordenação usa índice ou faz Sort caro?
```

### 6. Provar a paridade da SQL (resultado real)

Antes de declarar paridade, rodar a SQL do alvo com os **params do golden** contra o banco-sombra e comparar `rowCount`/`resultDigest` com a fixture do legado ([../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md), [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)). É a ponte entre "reconstruí a SQL" e "ela produz o mesmo que o legado".

> **Quem usa o MCP de Postgres** ([roster.md](roster.md)): o **Analista de Legado** (validar SQL reconstruída + plano), o **Backend Builder** (confirmar a SQL antes da paridade), o **Migration Engineer** (medir antes de migrar/particionar) e o **DevOps** (capacidade, empacotamento, promoção de tier). Todos pela mesma razão: **medir, não adivinhar.**

---

## Playwright — teste estruturado (inclusive teclado)

Todo teste de UI/fluxo é **estruturado** em Playwright — e, no Apollo, isso inclui o **fluxo de teclado** como cidadão de primeira classe (ADR-010), porque a memória muscular é o critério de aceite.

- **E2E ponta a ponta** com page objects: fluxos fiscais/PDV, retaguarda, sync — o caminho que o operador realmente percorre.
- **Fluxo de teclado** ([../06-testing-quality/playwright-e2e.md](../06-testing-quality/playwright-e2e.md), [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md)): `Tab` segue a taborder extraída do `.dfm`; `Enter` avança/confirma como o legado; F-keys disparam; **Alt+letra** (mnemônico `&`) aciona a ação ou foca o campo.
- **As duas cascas:** o mesmo fluxo roda no **browser** e na casca **Electron** (onde estão as teclas que o browser reserva — Ctrl+W/F5/F11). O teste cobre a casca que produção usa.

```ts
// teclado é teste estruturado, não "olhei e funcionou"
test('taborder + Enter-avança + mnemônico, idênticos ao Delphi', async ({ page }) => {
  await page.goto('/cadastro/produto');
  await expect(page.getByLabel('Código')).toBeFocused();   // ActiveControl = 1º campo
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Descrição')).toBeFocused(); // ordem do .dfm
  await page.keyboard.press('Enter');                       // Enter AVANÇA, não submete
  await expect(page.getByLabel('Preço')).toBeFocused();
  await page.keyboard.press('Alt+s');                       // mnemônico &Salvar → aciona Salvar
  await expect(page.getByText('Produto salvo')).toBeVisible();
});
```

> Playwright é a ferramenta do **QA** ([roster.md](roster.md)) e o que o **Revisor** exige para o portão de teclado ([review-loop.md](review-loop.md)). Cobre o que o harness de dados não cobre: o **fluxo** e o **teclado** ponta a ponta. O harness prova dados/lógica/SQL; o Playwright prova a jornada.

---

## Captura de SQL em runtime

A SQL do legado **nasce no `.dfm` e muta no `.pas` sob condicional** — é uma função do estado em runtime ([../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md)). Extração estática **não basta**. A ferramenta é **ligar o log e exercitar a tela** para capturar a verdade:

- **Log do banco (preferido):** no banco-sombra de extração, `log_statement = 'all'` + `log_min_duration_statement = 0` captura a SQL **exatamente** como chegou, com params resolvidos.
- **SQL monitor do FireDAC** (`TFDMonitorClient`): mostra cada comando que o driver envia, útil rodando o legado original.
- **Trace/proxy** quando não dá para mexer no banco.

Cada captura vira uma **fixture** `input → SQL real → resultado real` — que é **ao mesmo tempo** a verdade de extração e o **golden** do harness de paridade ([../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md)). É a materialização da regra de ouro: o teste roda a SQL que **produção** roda, capturada do **legado em execução** — não a que o agente *achou* que o legado roda.

```ini
# banco-sombra de extração — captura tudo, sem dó (NÃO em produção)
log_statement = 'all'
log_min_duration_statement = 0
log_parameter_max_length = -1     # não trunca os parâmetros
```

> A captura de runtime é a ferramenta do **Analista de Legado**. Sem ela, a §4 do dossiê é hipótese; com ela, é fato. Usar um **banco-sombra** (cópia representativa), nunca produção — exercita-se a tela muitas vezes, e esse barulho/risco não vai em prod.

---

## Como os agentes invocam os MCPs

O MCP é uma **capacidade do ambiente do agente**, não um serviço que o código de produção chama. O agente o invoca **durante o trabalho** (análise, decisão de schema, validação de paridade) para olhar o banco real e voltar com a resposta.

```
   AGENTE (Analista / Backend / Migration / DevOps)
        │  "preciso decidir/provar X com dado real"
        ▼
   MCP de Postgres ──► banco real (legado / sombra / alvo)
        │  inspeciona schema · mede volume/cardinalidade · EXPLAIN · roda a query
        ▼
   resposta com NÚMERO/PLANO ──► a decisão (índice/partição/paridade) é registrada no DOSSIÊ
                                  (contexto que não vira artefato se perde)
```

- **A invocação é parte do loop**, não um passo extra. O Analista valida a SQL reconstruída via MCP **antes** de marcar a §4 como pronta; o Backend confirma a SQL **antes** de mandar para a paridade; o Migration Engineer mede **antes** de escrever a migration.
- **O resultado vira artefato.** O número/plano que justificou a decisão (este índice, esta chave de partição) **mora no dossiê** — senão o contexto se perde e o próximo agente decide no escuro de novo ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)).
- **Escopo correto.** Inspeção/decisão roda no **banco-sombra** ou no alvo de teste; o agente não martela produção para "dar uma olhada". Capacidade de leitura para inspecionar; escrita só no ambiente próprio.

---

## Uso responsável de ferramentas

Poder de olhar o banco real e dirigir o navegador exige disciplina:

- **Banco-sombra, não produção, para exploração.** Inspeção pesada (`log_statement='all'`, `EXPLAIN ANALYZE` repetido, exercitar tela 50 vezes) vai no ambiente de extração/teste. Produção não é playground.
- **Isolamento de tenant vale para a ferramenta também.** Ao inspecionar via MCP, respeita-se a fronteira de tenant ([../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md)) — não se cruza dado de clientes "para ver". O MCP é para **estrutura e plano**, não para vasculhar dado sensível de cliente.
- **Sem PII/segredo no artefato.** O que volta do MCP para o dossiê é **estrutura, número, plano** — não dump de dado real de cliente. Mesma higiene do log ([../07-devops-infra/observability.md](../07-devops-infra/observability.md)).
- **Medir não substitui provar.** O EXPLAIN diz que o plano melhorou; a **paridade** ainda tem de bater (resultado == golden). A ferramenta informa a decisão; o harness a **prova**.
- **A ferramenta serve o caminho real.** Playwright/harness valem se exercitam o que produção executa — mock no caminho real é falsa confiança ([review-loop.md](review-loop.md)). A ferramenta não é álibi para verde cego.

---

## Ver também

- [roster.md](roster.md) — quais agentes invocam quais ferramentas e por quê.
- [review-loop.md](review-loop.md) — o portão de paridade/teclado que estas ferramentas alimentam.
- [../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md) — a captura de SQL em runtime, em profundidade.
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — onde as fixturas viram golden e o resultado é comparado.
- [../06-testing-quality/playwright-e2e.md](../06-testing-quality/playwright-e2e.md) — Playwright e os fluxos de teclado.
- [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md) — as decisões de banco (índice/partição/empacotamento) que o MCP informa.
- [../02-stack-and-standards/performance-playbook.md](../02-stack-and-standards/performance-playbook.md) — índices/EXPLAIN no alvo.
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — "não decida no escuro" e a regra de ouro do eval.
