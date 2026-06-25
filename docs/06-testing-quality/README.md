# 06 — Testes & Qualidade

> Como o Apollo prova que o novo faz **exatamente** o que o velho fazia. Prioridade máxima: **teste de paridade legado×novo** cobrindo cada condicional/regra do dossiê. Mais os testes que esta migração não pode errar — **fiscal**, **offline/sync (PDV)** e **fluxo de teclado**. Verde só conta se exercita o caminho real.

## Pré-requisitos de leitura

- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — paridade comportamental provada (critério de sucesso); risco-coroa fiscal; anti-objetivo do verde cego.
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — a regra de ouro do eval (verde sem caminho real é falsa confiança).
- [../04-screen-dossier/dossier-template.md](../04-screen-dossier/dossier-template.md) — de onde a cobertura deriva (§4 SQL, §5 regras, §9 golden).

## Arquivos da seção

| Arquivo | Para quê |
|---------|----------|
| [testing-strategy.md](testing-strategy.md) | A pirâmide (unit/integration/e2e) e a **lente de paridade** que a atravessa. Prioridade máxima ao teste legado×novo. Testes fiscais especiais (tolerância zero de centavo, UF, contingência), offline/sync (idempotência, watermark, conflito = regra de negócio), e fluxo de teclado. Cobertura **derivada do dossiê**, não % de linha. |
| [parity-harness.md](parity-harness.md) | **Arquivo-coroa.** O harness data-driven: capturar **golden** do legado em runtime, rodar o mesmo input no novo, **comparar** (outputs + SQL + efeitos). Como construir, a regra de ouro (verde sem SQL/condicional/dispatch real = falsa confiança), exemplo de estrutura e de caso. |
| [playwright-e2e.md](playwright-e2e.md) | E2E estruturado: page objects; **fluxos de teclado de primeira classe** (taborder, F-keys, Enter-avança, mnemônicos `&`); as **duas cascas** (browser/Electron); fluxos fiscais/PDV ponta-a-ponta. Exemplos com `keyboard.press('Tab'/'F2'/'Alt+s')`. |

## Ordem de leitura sugerida

1. [testing-strategy.md](testing-strategy.md) — o mapa: o que testar e com que prioridade.
2. [parity-harness.md](parity-harness.md) — o coração: como provar legado×novo idênticos.
3. [playwright-e2e.md](playwright-e2e.md) — o fluxo e o teclado, nas duas cascas.

## As duas leis desta seção

1. **A prioridade é a paridade.** O sucesso da migração é "é igual ao legado", provado com golden capturado do velho rodando — não "parece igual".
2. **Verde só conta se exercita o caminho real.** SQL real, condicional real, dispatch real, motor offline real. Verde que não toca o caminho de produção é falsa confiança ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)).

## Ver também

- [../04-screen-dossier/](../04-screen-dossier/) — o dossiê é a fonte da cobertura (caminhos de SQL, regras, golden, mapa de teclado).
- [../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md) — capturar golden/SQL do legado em runtime.
- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) — a camada de teclado que o Playwright verifica.
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — offline/sync e contingência (base dos testes de PDV).
- [../08-agents/review-loop.md](../08-agents/review-loop.md) — a revisão independente que precede a paridade.
