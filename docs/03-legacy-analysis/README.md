# 03 — Análise do Legado

> Como **ler e mergulhar** no Delphi para extrair o que o sistema **faz** (não o que a tela mostra): anatomia dos arquivos, a SQL que muta sob condicional, a regra de negócio com profundidade, e o acoplamento oculto que a leitura linear esconde. Tudo converge no **dossiê de tela** (seção 04). Carregue só o arquivo da sua tarefa.

## Pré-requisitos de leitura

- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — "não migre o que você vê, migre o que o sistema faz"; a vantagem procedural; o risco-coroa fiscal.
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — disciplina de contexto, regra de ouro do eval, captura de runtime e MCP de Postgres.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-010 (mnemônicos do `.dfm`), ADR-012 (toda tela passa por dossiê).

## Arquivos da seção

- [delphi-anatomy.md](delphi-anatomy.md) — Anatomia Delphi para quem nunca abriu o IDE: `.dpr`/`.pas`/`.dfm`/`.dproj`, como `OnClick = Handler` liga o `.dfm` ao `.pas`, datamodules, data-binding `TQuery`/`TDataSource`, posicionamento absoluto que precisa re-fluir, componentes proprietários sem 1:1, e como **parsear o `.dfm`** para gerar scaffold + extrair taborder/mnemônicos `&` + mapa de event handlers + sementes de SQL.
- [dynamic-sql-extraction.md](dynamic-sql-extraction.md) — **Arquivo-coroa.** A SQL nasce no `.dfm` e muta no `.pas` sob condicional → é uma função do estado em runtime → estática não basta. Método em duas frentes: (A) estático, reconstruir o query builder implícito; (B) runtime, ligar o log do banco e **exercitar a tela** para capturar a verdade, que vira **fixtures** e a régua de paridade. Mapeamento para Kysely, validação via MCP de Postgres.
- [business-rule-extraction.md](business-rule-extraction.md) — Extrair regra com profundidade: validações, cálculos, condicionais, efeitos colaterais e o **porquê**; ler de cima a baixo sem presumir, **não perdendo nenhuma condicional**; casos de borda; exemplo real (preço/desconto/imposto) → service NestJS testável. A regra vai para o **service**, não no controller, não na SQL.
- [hidden-coupling-traps.md](hidden-coupling-traps.md) — A exceção à vantagem procedural: **datamodules + globais = acoplamento oculto** que a leitura de uma tela não mostra. Como detectar (o campo "estado externo" do dossiê) e como quebrar (dependências explícitas, sem singletons mutáveis) — também a fronteira de segurança de tenant.

## Como esta seção se encaixa

Esta é a seção que materializa a tese **"contexto é tudo"** ([../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md)) no ato de **ler o legado**. A ordem natural: [delphi-anatomy.md](delphi-anatomy.md) alfabetiza (o que é cada arquivo e como parseá-los), e o parser do `.dfm` **semeia o dossiê** com scaffold, mapa de teclado e sementes de SQL. Sobre essa base, [dynamic-sql-extraction.md](dynamic-sql-extraction.md) reconstrói a SQL real (estático + runtime → fixtures), [business-rule-extraction.md](business-rule-extraction.md) extrai a lógica para o service sem perder condicional, e [hidden-coupling-traps.md](hidden-coupling-traps.md) caça o estado externo que a leitura linear esconde. Os quatro produtos — scaffold + SQL reconstruída + regra extraída + estado externo — **convergem no dossiê** (seção 04, ADR-012), que alimenta a stack (02), prova-se no harness de paridade (06) e usa o MCP de Postgres (08).

## Ordem de leitura sugerida

1. [delphi-anatomy.md](delphi-anatomy.md) — alfabetização: leia primeiro se você não conhece Delphi.
2. [dynamic-sql-extraction.md](dynamic-sql-extraction.md) — o arquivo-coroa; se ler só um, leia este.
3. [business-rule-extraction.md](business-rule-extraction.md) — a regra para o service, sem perder nada.
4. [hidden-coupling-traps.md](hidden-coupling-traps.md) — o estado escondido entre telas.

## Ver também

- [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md) — para onde a SQL e a regra migram (repository/service); mapeamento canônico SQL → Kysely.
- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) — consome o mapa de teclado extraído do `.dfm`.
- [../04-screen-dossier/](../04-screen-dossier/) — o dossiê de tela, destino de tudo extraído aqui (ADR-012).
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — as fixtures e casos de borda viram golden tests; paridade legado × novo.
- [../08-agents/mcp-and-tools.md](../08-agents/mcp-and-tools.md) — MCP de Postgres para validar SQL reconstruída e planos.
