# Estratégia de Testes

> A pirâmide de testes do Apollo e a regra que a inverte na prática: a **prioridade máxima é o teste de paridade legado×novo** cobrindo **cada** condicional e regra do dossiê. Mais os testes que esta migração não pode errar — **fiscal** (alto risco), **offline/sync** (PDV) e **fluxo de teclado** (memória muscular). Cobertura **derivada do dossiê**, não inventada.

## Pré-requisitos de leitura

- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — critérios de sucesso (paridade provada), o risco-coroa fiscal, anti-objetivo "não confiar em verde que não exercita o caminho real".
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — a regra de ouro do eval.
- [../04-screen-dossier/dossier-template.md](../04-screen-dossier/dossier-template.md) — de onde a cobertura deriva (seções 4, 5, 9).
- [parity-harness.md](parity-harness.md) — o harness que executa a paridade.
- [playwright-e2e.md](playwright-e2e.md) — o E2E estruturado e os fluxos de teclado.

---

## A pirâmide — e por que ela é diferente aqui

A pirâmide clássica (muitos unit, alguns integration, poucos e2e) vale para a **forma** dos testes. Mas no Apollo há um eixo ortogonal que **domina a prioridade**: o **teste de paridade**. Não é um nível da pirâmide — é uma **lente** que atravessa todos: cada nível só vale se prova que o novo faz o que o velho fazia.

```
                    ▲  menos, mais caros, mais lentos
        ┌───────────────────────┐
        │   E2E (Playwright)    │  fluxos completos nas DUAS cascas (browser/Electron),
        │  + fluxos de TECLADO  │  fiscal/PDV ponta-a-ponta, taborder/F-keys/mnemônicos
        ├───────────────────────┤
        │     Integration       │  service+repository contra Postgres REAL (caminho real
        │  (Postgres de teste)  │  da query, transação, trigger, tenant context)
        ├───────────────────────┤
        │        Unit           │  regra de negócio pura (cálculo fiscal, validação),
        │  (função/serviço)     │  parser de .dfm, reconstrução de SQL
        └───────────────────────┘
                    ▼  mais, mais baratos, mais rápidos

   ════════════ PARIDADE LEGADO×NOVO ════════════
   atravessa os 3 níveis: o golden capturado do legado é o oráculo de cada um.
   Prioridade MÁXIMA — ver parity-harness.md.
```

| Nível | Forma | O que prova | Caminho real? |
|---|---|---|---|
| **Unit** | função/serviço isolado | regra/cálculo exato (fórmula da §5 do dossiê), arredondamento fiscal, parser | a **lógica** real (sem mock da fórmula) |
| **Integration** | service + repository + **Postgres real** | a SQL real roda, com a transação/trigger/tenant; cada branch da §4 | **sim** — banco real, query real |
| **E2E** | Playwright, app rodando | fluxo do operador ponta-a-ponta, teclado, fiscal/PDV, as duas cascas | **sim** — app real, dispatch real |

> **Anti-padrão proibido:** mockar o que é o objeto do teste. Unit de cálculo fiscal não mocka o cálculo; integration de query não mocka a query; e2e de venda não mocka o dispatch. Mock só nas **bordas externas não-determinísticas** (SEFAZ, adquirente TEF, relógio) — e mesmo essas, gravadas como golden quando possível.

---

## Prioridade máxima: teste de paridade legado×novo

O teste que **define** o sucesso da migração (critérios em [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md)): mesmos inputs no legado e no novo, **outputs idênticos**. Não "parece igual" — **é** igual, byte a byte nos valores que importam (preço, imposto, total, sequência de SQL, ordem do grid).

- **A fonte é o dossiê.** Cada caminho condicional de SQL (§4) e cada regra (§5) tem ≥1 caso golden (§9). Cobertura de paridade = soma dos caminhos do dossiê. Se o dossiê listou 4 branches de uma query, há 4 golden — não 1.
- **O oráculo é o legado rodando.** O golden é **capturado** do Delphi em runtime ([../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md)), não escrito de cabeça. Escrever o "esperado" à mão reintroduz o viés que o projeto combate.
- **Verde que não exercita o caminho real é falsa confiança** — ver seção abaixo. O harness ([parity-harness.md](parity-harness.md)) é construído para impedir isso.

> Implicação cultural: a paridade é a **definição de pronto** de uma tela ([../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md)), não um teste a mais.

---

## Testes fiscais especiais (alto risco — risco-coroa)

O motor fiscal é o subsistema mais perigoso ([../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md)). Testes dedicados, mais rígidos que o resto:

- **Tolerância zero de centavo.** Base de cálculo, ICMS/ICMS-ST/DIFAL, PIS/COFINS, total — divergência de **R$ 0,01** reprova. Arredondamento (half-even vs half-up) é capturado do legado e replicado.
- **Matriz por UF/município/regime.** ST e DIFAL mudam por UF (glossário); a suíte é parametrizada por UF + NCM/CST + regime (Simples/Normal). Cada combinação relevante do cliente é um caso.
- **Documentos fiscais bate-a-bate.** NFC-e/NF-e/SAT-CF-e gerados pelo novo são comparados ao XML/layout do legado nos campos fiscais (não no whitespace). Schema válido **e** valores idênticos.
- **Contingência.** Caso de SEFAZ/WAN fora → emissão em contingência, numeração/série local, marcação correta, e **transmissão diferida idempotente** quando volta (não duplica autorização). Ver [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md).
- **Versão fiscal pinável.** Como o fiscal é versionável independente (ADR-010), a suíte fiscal roda contra a **versão pinada** — o update geral não pode arrastar nem mascarar regressão fiscal.
- **Bordas externas gravadas.** SEFAZ e adquirente TEF são gravados como golden (request/response) — o teste é determinístico, mas exercita o **fluxo real** de montagem/parsing.

---

## Testes de offline/sync (PDV)

O PDV vende offline e reconcilia (ADR-008, [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md)). O que a suíte tem de provar:

- **Venda 100% offline.** Sem rede: o caixa vende, calcula imposto local, imprime, grava no banco embedded. Nenhum caminho assume internet.
- **Idempotência da reconciliação.** Reenviar o **mesmo** cupom (id estável gerado na origem) **não duplica** no edge (`ON CONFLICT DO NOTHING`); ack perdido + retry com o mesmo id = sem duplicidade. Teste injeta perda de ack e dupla entrega.
- **Watermark/resume.** Após queda no meio do batch, retoma de onde parou sem reenviar histórico nem perder cupom.
- **Conflito = regra de negócio, não last-write-wins.** Preço mudou na central enquanto o PDV vendeu offline → o cupom vale com o preço praticado (fato consumado); o novo preço vale do recebimento da vigência em diante. Teste cobre os dois lados.
- **Carga inicial idempotente.** Re-aplicar a carga (PDV reinstalado) não causa efeito colateral.
- **Os golden fiscais rodam no motor offline** (Electron), não só na API — senão o verde não prova o caminho que o caixa executa.

---

## Testes de fluxo de teclado (memória muscular = critério de aceite)

ADR-010: taborder, Enter-avança-campo, F-keys e mnemônicos `&` são replicados **idênticos**. Isso é **testado**, em Playwright (primeira classe — [playwright-e2e.md](playwright-e2e.md)), contra o mapa de teclado do dossiê (§8, extraído do `.dfm`):

- **TabOrder:** `Tab` percorre os campos na **ordem exata** do `.dfm`; foco condicional (o que `OnExit` fazia) confere.
- **Enter-avança-campo:** Enter move ao próximo campo; confirma onde o legado confirmava (botão `Default`, último campo, item do PDV).
- **F-keys / Ctrl:** F2 busca, F4 etc. disparam a ação certa, no **escopo** certo (painel ativo ganha).
- **Mnemônicos `&`:** Alt+letra **aciona** (botão) ou **foca** (campo via `FocusControl`) — os dois papéis.
- **Duas cascas:** o que o browser reserva (F5/Ctrl+W/F11) é testado **na casca Electron** que o assume.

> Estes não são testes "de acessibilidade" opcionais — são **paridade de UX**. Quebrar a taborder reprova a tela igual quebrar um cálculo fiscal.

---

## Cobertura derivada do dossiê (não inventada)

Cobertura no Apollo **não** é "% de linhas". É: **todo caminho condicional e toda regra do dossiê têm caso de teste**. Métrica de linha é sintoma, não meta — pode-se ter 90% de linha e 0% do branch fiscal crítico.

```
  Cada dossiê (§4 + §5)  ──►  lista de caminhos condicionais + regras
                         ──►  cada item exige ≥1 golden (§9)
                         ──►  o harness checa: existe golden p/ cada caminho?
                              falta golden = lacuna de cobertura (reprova fechamento)
```

- **Rastreabilidade bidirecional:** todo teste rastreia para um `BR-…`/`Q…` do dossiê; todo `BR-…`/`Q…` rastreia para ≥1 teste. Item do dossiê sem teste = lacuna; teste sem item = ou o dossiê está incompleto, ou o teste é supérfluo.
- **O fechamento da tela exige a cobertura derivada completa** ([../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md)). Sem ela, a tela não está "concluída".

---

## A regra de ouro (aplicada a testes)

> Verde que **não exercita o caminho real** (SQL real, condicional real, dispatch real) é **falsa confiança** ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)).

Checklist anti-falsa-confiança, por nível:

- [ ] Integration roda contra **Postgres real** (não SQLite-in-memory que diverge de dialeto/trigger).
- [ ] Cada **branch** de SQL dinâmica tem caso — não só o caminho feliz.
- [ ] Caminho **assíncrono** (fila/worker, ADR-005) é exercitado, não só o síncrono.
- [ ] Golden fiscal roda **no motor que o PDV usa offline**.
- [ ] Mock só nas bordas externas não-determinísticas (SEFAZ/TEF/relógio), gravadas como golden.
- [ ] O "esperado" vem do **legado capturado**, não escrito à mão.

---

## Ver também

- [parity-harness.md](parity-harness.md) — o harness de paridade (arquivo-coroa da seção): capturar golden, rodar, comparar.
- [playwright-e2e.md](playwright-e2e.md) — E2E e fluxos de teclado como teste de primeira classe.
- [README.md](README.md) — índice da seção 06.
- [../04-screen-dossier/dossier-template.md](../04-screen-dossier/dossier-template.md) — de onde a cobertura deriva (§4, §5, §9).
- [../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md) — captura de golden em runtime.
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — offline/sync e contingência (base dos testes de PDV).
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — critérios de sucesso, risco-coroa fiscal.
