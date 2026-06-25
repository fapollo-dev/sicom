# O Roster de Agentes

> Quem faz o quê nesta migração, e como os agentes se passam o bastão. Cada agente tem **inputs**, **outputs**, as **seções que lê** e um **handoff** explícito. O **dossiê é o contrato** entre todos eles — é por ele que o trabalho de um vira o input do próximo, sem conversa perdida.

## Pré-requisitos de leitura

- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — a disciplina de contexto, o loop fazer→revisar→legado×novo e quando agir vs. perguntar.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — a tese "contexto é tudo" e os 3 hábitos inegociáveis que estes papéis executam.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — os ADRs que **todos** obedecem (ADR-012: dossiê é a unidade de trabalho).
- [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md) — o processo por tela que estes papéis percorrem.
- [review-loop.md](review-loop.md) — o ciclo de revisão independente (o agente Revisor em detalhe).

---

## O dossiê é o contrato (a ideia central do roster)

Nenhum agente conversa "no ar" com outro. O artefato que um produz e o próximo consome é o **dossiê de tela** ([../04-screen-dossier/dossier-template.md](../04-screen-dossier/dossier-template.md), ADR-012). O Analista de Legado **escreve** no dossiê; o Backend e o Frontend **leem** dele; o QA **deriva** os testes dele; o Revisor **audita** contra ele e contra o legado. Se o handoff falha, é porque o dossiê estava incompleto — não porque "faltou alinhar". Isso torna o trabalho **assíncrono, auditável e à prova de contexto perdido**: o dossiê cabe na janela; o ERP inteiro não.

> **Regra de independência (ADR-012 / [review-loop.md](review-loop.md)):** o agente que **faz** uma tela **não** é o que a **revisa**. A independência é a essência da etapa 2 do loop. Vale para todo o roster.

```
   ANALISTA ──┐                                        ┌── (reprova) volta ao autor
   DE LEGADO  │  escreve                                │
              ▼                                          │
        ┌──────────────┐   lê    ┌──────────────────┐   │   ┌──────────────┐
        │   DOSSIÊ      │ ──────► │ BACKEND/FRONTEND │ ──┼──►│   REVISOR    │
        │ (o contrato)  │ ──────► │ MIGRATION ENG.   │   │   │ (independente)│
        │ §1..§10       │ ──────► │ QA/PLAYWRIGHT    │   │   └──────┬───────┘
        └──────────────┘         └──────────────────┘   │          │ aprova
              ▲                            │             │          ▼
              │ externa achados            └─ DevOps sobe ──► PARIDADE LEGADO×NOVO (verde real)
   ORQUESTRADOR sequencia, resolve dúvida que contradiz ADR, mantém o ritmo strangler
```

---

## Analista de Legado

O agente que **mergulha** no Delphi e extrai o que o sistema **faz** (não o que a tela mostra). É a materialização da tese "contexto é tudo".

- **Inputs:** o código-fonte Delphi da tela — `.pas`, `.dfm`, `.dproj`, datamodules — e acesso a um **banco-sombra** para captura de runtime.
- **O que faz:** lê de cima a baixo sem presumir; reconstrói a **SQL dinâmica** (estática + runtime, exercitando a tela); extrai **regra de negócio** com o *porquê* (validações, cálculos, condicionais, casos de borda); caça o **acoplamento oculto** (datamodules globais, estado entre telas, triggers/escritas-fantasma); extrai o **mapa de teclado** do `.dfm` (taborder, mnemônicos `&`, F-keys); captura os **golden** do legado rodando.
- **Outputs:** as seções de análise do **dossiê** preenchidas — §4 (dados/SQL com todos os caminhos), §5 (regras + porquê + procedência), §6 (efeitos/estado externo), §8 (teclado), §9 (golden) — cada achado **com procedência** (`.pas`/`.dfm`/runtime/datamodule).
- **Lê:** [../03-legacy-analysis/](../03-legacy-analysis/) inteira — [delphi-anatomy.md](../03-legacy-analysis/delphi-anatomy.md), [dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md) (arquivo-coroa), [business-rule-extraction.md](../03-legacy-analysis/business-rule-extraction.md), [hidden-coupling-traps.md](../03-legacy-analysis/hidden-coupling-traps.md).
- **Ferramentas:** captura de SQL em runtime (log do banco) e o **MCP de Postgres** para validar a SQL reconstruída e o plano ([mcp-and-tools.md](mcp-and-tools.md)).
- **Handoff:** entrega o dossiê com a análise completa ao **Dossiê Writer** (se for outro agente) e aos **Builders**. Sem §4/§5/§6 completas e confirmadas em runtime, **não há handoff** — o builder implementaria pela superfície.

> **Quando escala ao Orquestrador:** quando falta uma regra que **não está no legado** (decisão de produto) ou quando o achado **contradiz um ADR** ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)).

## Dossiê Writer

O agente que **estrutura** a análise no template — pode ser o próprio Analista, mas o papel é distinto: garantir que o dossiê está **completo, rastreável e fechável**.

- **Inputs:** a análise do legado (bruta) + o scaffold gerado do `.dfm` (UI, taborder, mnemônicos).
- **O que faz:** preenche o [dossier-template.md](../04-screen-dossier/dossier-template.md) (§1..§10) sem deixar branco; amarra cada item à sua **procedência**; mapeia o §10 (alvo: NestJS + React + o que roda offline no Electron); roda o **checklist de fechamento** (toda SQL com todos os caminhos, regras com porquê, estado externo, mapa de teclado, golden por condicional).
- **Outputs:** o **dossiê completo e versionável**, no mesmo repo/PR do código que ele vai gerar ([../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md)).
- **Lê:** [../04-screen-dossier/](../04-screen-dossier/) (template + processo).
- **Handoff:** dossiê fechado → Builders e QA. O dossiê é o **contrato**: se um endpoint/validação/branch/teste não rastreia para uma linha dele, ou o dossiê está incompleto ou alguém implementou pela superfície.

## Backend Builder (NestJS)

Implementa a lógica do servidor **a partir do dossiê**, não da tela.

- **Inputs:** dossiê §4 (SQL/caminhos), §5 (regras), §6 (efeitos/estado externo), §10 (alvo).
- **O que faz:** reconstrói o **query builder implícito** do Delphi em Kysely — cada condicional do `.pas` vira um `.where()` na **mesma ordem e semântica**; põe a **regra no service** (não no controller, não na SQL); valida com DTO/zod; respeita o **roteamento de tenant** request-scoped (nunca escolhe banco na mão — [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md)); enfileira o pesado no **worker tier** em vez de rodar na API ([../01-architecture/workload-tiers.md](../01-architecture/workload-tiers.md)).
- **Outputs:** módulo/endpoints NestJS, repository, service, DTOs — com a SQL comparável (via `q.compile()`) ao golden do legado.
- **Lê:** [../02-stack-and-standards/backend-nestjs-standards.md](../02-stack-and-standards/backend-nestjs-standards.md), [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md), [../01-architecture/workload-tiers.md](../01-architecture/workload-tiers.md), e a §4 do legado ([../03-legacy-analysis/dynamic-sql-extraction.md](../03-legacy-analysis/dynamic-sql-extraction.md)).
- **Ferramentas:** **MCP de Postgres** para validar SQL/plano antes de declarar paridade ([mcp-and-tools.md](mcp-and-tools.md)).
- **Handoff:** código + a indicação de quais golden ele deve passar → QA. Nada de SQL "parecida": a SQL emitida tem de bater (normalizada) com a do legado.

## Frontend Builder (React / teclado)

Implementa a tela **a partir do dossiê**, com a **UX de teclado idêntica** ao Delphi (ADR-010 — critério de aceite).

- **Inputs:** dossiê §2 (UI/`.dfm`→React + reflow), §3 (eventos), §8 (taborder + mnemônicos), §10 (qual casca: browser vs Electron).
- **O que faz:** monta a tela com o design system; **consome o mapa de teclado** (`label="&…"`, `ShortcutScope`, `useEnterAdvances`, `DataGrid`) sem reinventar; replica taborder (ordem do DOM, nunca `tabindex` positivo), Enter-avança-campo, F-keys e mnemônicos `&` **exatos**; decide a casca (Electron quando precisa das teclas que o browser reserva).
- **Outputs:** componente/rota React, integração com a camada de teclado compartilhada.
- **Lê:** [../02-stack-and-standards/frontend-react-standards.md](../02-stack-and-standards/frontend-react-standards.md), [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) (arquivo-coroa do teclado).
- **Handoff:** tela → QA, que valida o teclado em Playwright. "Modernizar" atalho é anti-objetivo — reprova.

## Migration Engineer (Oracle→PG, expand/contract, sync)

O agente da **engenharia de migração**: o schema, o dado e o protocolo de sync. Atravessa telas — opera no nível do banco e do contrato.

- **Inputs:** o schema Oracle do legado, os dossiês (para saber que tabelas/colunas as telas exigem), o estado atual do schema-alvo.
- **O que faz:** migra **Oracle→PostgreSQL** (ADR-011 — PL/SQL, tipos, packages); desenha migrations **expand/contract** (parallel change — aditivo, backfill, contract tardio) para os 900 bancos sem downtime (ADR-009); mantém a **compatibilidade N/N-1** e o **protocolo de sync** backward-compatible (edge/PDV em versões diferentes); garante a **idempotência** do sync (identidade estável, upsert, watermark).
- **Outputs:** migrations expand/contract, scripts de backfill (no worker tier), o protocolo de sync versionado.
- **Lê:** [../05-migration-engineering/](../05-migration-engineering/) — [oracle-to-postgres.md](../05-migration-engineering/oracle-to-postgres.md), [migrations-expand-contract.md](../05-migration-engineering/migrations-expand-contract.md), [versioning-and-compatibility.md](../05-migration-engineering/versioning-and-compatibility.md), [sync-protocol.md](../05-migration-engineering/sync-protocol.md); e [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md).
- **Ferramentas:** **MCP de Postgres** para medir volume/cardinalidade/plano antes de decidir índice/particionamento numa migration ([mcp-and-tools.md](mcp-and-tools.md), [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md)).
- **Handoff:** migrations + protocolo → **DevOps**, que os roda em lote nos 900 bancos via migration runner ([../07-devops-infra/ci-cd-zero-downtime.md](../07-devops-infra/ci-cd-zero-downtime.md)).

## QA / Playwright

O agente que **prova** — constrói e roda os testes que tornam "concluída" real.

- **Inputs:** os **golden** do dossiê (§9), o código do Backend e do Frontend, o mapa de teclado (§8).
- **O que faz:** alimenta o **harness de paridade** com os golden capturados do legado, roda o **mesmo input** no novo pelo **caminho real** e compara (outputs + SQL + efeitos); escreve **Playwright** para E2E e **fluxo de teclado** (Tab segue a ordem, Alt+letra aciona/foca, F-keys disparam, Enter avança/confirma); cobre o **fiscal** (1 centavo reprova), **offline/sync** (idempotência, watermark, conflito=regra de negócio) e roda o golden fiscal no **motor offline** que o Electron usa.
- **Outputs:** suíte de paridade verde (que **exercita o caminho real**) + suíte Playwright; relatório de cobertura **derivada do dossiê** (não % de linha).
- **Lê:** [../06-testing-quality/](../06-testing-quality/) inteira — [parity-harness.md](../06-testing-quality/parity-harness.md) (coroa), [playwright-e2e.md](../06-testing-quality/playwright-e2e.md), [testing-strategy.md](../06-testing-quality/testing-strategy.md).
- **Ferramentas:** **Playwright** (incl. teclado) e o harness data-driven; **MCP de Postgres** para confirmar resultado/plano da SQL ([mcp-and-tools.md](mcp-and-tools.md)).
- **Handoff:** verde de paridade → o Revisor e o Orquestrador. **Verde que não exercita o caminho real não conta** ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)).

## DevOps

O agente que **roda, sobe e mantém de pé** — a seção 07 é dele.

- **Inputs:** as imagens buildadas, as migrations do Migration Engineer, o registry de tenants, os anéis de rollout.
- **O que faz:** opera a **frota stateless** e o deploy **zero-downtime** (rolling/blue-green, health/drain/graceful); roda o **migration runner** nos 900 bancos (expand/contract, em lote, staggered); orquestra o **rollout escalonado** de Electron/edge (pinável, nunca no meio de venda); mantém **backup/PITR/DR**, **retenção fiscal**, **provisionamento de tenant** e a **observabilidade** (NOC, sync lag, transmissão fiscal, SLOs).
- **Outputs:** infra provisionada, deploys, migrations aplicadas, painéis e alertas, novos tenants provisionados.
- **Lê:** [../07-devops-infra/](../07-devops-infra/) inteira — [infrastructure.md](../07-devops-infra/infrastructure.md), [ci-cd-zero-downtime.md](../07-devops-infra/ci-cd-zero-downtime.md), [database-ops.md](../07-devops-infra/database-ops.md), [observability.md](../07-devops-infra/observability.md).
- **Ferramentas:** **MCP de Postgres** para decisões de capacidade/partição/empacotamento ([mcp-and-tools.md](mcp-and-tools.md)).
- **Handoff:** ambiente saudável e observável → todos. Reporta ao **Orquestrador** o estado da frota (quantos dos 900 em N, saúde fiscal) que rege o ritmo do strangler.

## Revisor (independente)

O agente que **audita** — **diferente** do autor, sempre (ADR-012). É a etapa 2 do loop, detalhada em [review-loop.md](review-loop.md).

- **Inputs:** o dossiê + o código + os testes, **no mesmo PR**; e o **legado** (`.pas`/`.dfm`/runtime) como referência.
- **O que faz:** confere **legado × dossiê × código** — regra preservada (nenhuma condicional perdida), **paridade de SQL** (o branch certo foi tomado), **teclado** (taborder/mnemônicos/F-keys), **efeitos colaterais** (triggers/estado externo não esquecidos), **aderência aos ADRs**, e o **portão de paridade** (verde exercita o caminho real). Pega o que o teste não vê (regra não capturada como golden) — o teste pega o que ele não vê (1 centavo).
- **Outputs:** veredito **aprovado** ou **reprovado com motivo rastreável** ao legado; se reprova, **volta ao autor** (não conserta — quem conserta é o autor).
- **Lê:** [review-loop.md](review-loop.md), o dossiê em revisão, e a seção da matéria (legado/stack/testes) conforme o caso.
- **Handoff:** aprovado → segue para paridade/DevOps; reprovado → volta ao Builder/Analista. A independência é inegociável.

## Orquestrador

O agente que **sequencia e desbloqueia** — não implementa; coordena.

- **Inputs:** o backlog de telas/módulos, o estado da frota (do DevOps), as dúvidas escaladas.
- **O que faz:** define a **ordem strangler** (qual tela/módulo primeiro, [../10-roadmap/phases.md](../10-roadmap/phases.md)); distribui o trabalho respeitando a **independência** (quem faz ≠ quem revisa); resolve dúvidas que **contradizem um ADR** (e, se preciso, propõe um ADR novo que supersede — nunca edita decisão travada em silêncio); garante que **achados canônicos** descobertos no caminho vão para [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md); mantém o ritmo do cutover por cliente.
- **Outputs:** sequência de trabalho, decisões de produto escaladas, ADRs novos quando necessário.
- **Lê:** [../00-orientation/](../00-orientation/) inteira, [../10-roadmap/](../10-roadmap/), e os índices das seções para rotear.
- **Handoff:** atribui telas e desbloqueia; é o ponto de escalonamento de todos os outros agentes.

---

## Resumo: inputs/outputs e o handoff

| Agente | Lê (principal) | Produz | Passa para |
|---|---|---|---|
| **Analista de Legado** | seção 03; `.pas`/`.dfm`/runtime | análise no dossiê (§4/§5/§6/§8/§9) + procedência | Dossiê Writer / Builders |
| **Dossiê Writer** | seção 04 (template/processo) | dossiê completo, versionável, fechado | Builders, QA |
| **Backend Builder** | 02-backend, 01-tenancy/tiers, §4 legado | módulo/repository/service NestJS | QA, Revisor |
| **Frontend Builder** | 02-frontend, 02-keyboard | tela React + teclado idêntico | QA, Revisor |
| **Migration Engineer** | seção 05, 01-offline-sync | migrations expand/contract + sync protocol | DevOps |
| **QA / Playwright** | seção 06 | paridade verde (caminho real) + Playwright | Revisor, Orquestrador |
| **DevOps** | seção 07 | infra/deploy/migrations/observabilidade | todos (frota saudável) |
| **Revisor** | review-loop + dossiê + legado | veredito (aprova/reprova rastreável) | autor (reprova) / paridade (aprova) |
| **Orquestrador** | seção 00, 10, índices | sequência strangler, ADRs, desbloqueio | todos |

> O fio que costura a tabela: **o dossiê é o contrato**. Cada "produz" de um vira "lê" do próximo através dele. Quando o handoff trava, conserta-se o **dossiê** (a fonte), não a conversa.

---

## Ver também

- [review-loop.md](review-loop.md) — o ciclo fazer→revisar→legado×novo e o Revisor independente em detalhe.
- [mcp-and-tools.md](mcp-and-tools.md) — as ferramentas que os agentes invocam (MCP de Postgres, Playwright, captura de SQL).
- [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md) — o processo por tela que estes papéis percorrem.
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — a disciplina de contexto e o quando-agir-vs-perguntar.
- [README.md](README.md) — índice da seção 08.
