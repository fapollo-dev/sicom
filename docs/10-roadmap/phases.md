# Roadmap em Fases — Strangler, módulo a módulo (sem big-bang)

> O plano de migração é **strangler** (anti-objetivo: nada de big-bang): o legado Delphi **convive e é estrangulado** módulo a módulo, do **menor risco para o maior**, com **cutover por cliente** controlado. Cada fase tem **critério de saída** explícito — não se avança por torcida.

## Pré-requisitos de leitura

- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — anti-objetivo **big-bang**; o risco-coroa fiscal; critérios de sucesso.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-008** (PDV offline Electron), **ADR-009** (expand/contract, janela de versão), **ADR-011** (Oracle→Postgres), **ADR-013** (DS/IA forks).
- [blind-spots.md](blind-spots.md) — os pontos que o cliente ainda não enxergou (cada fase aponta para os relevantes).
- [../05-migration-engineering/migrations-expand-contract.md](../05-migration-engineering/migrations-expand-contract.md) — como migrar schema sem downtime entre fases.

---

## Princípio: estrangular, não substituir de uma vez

O **Strangler Fig**: a planta nova cresce em volta da árvore velha até substituí-la sem nunca derrubá-la de uma vez. Aqui: o sistema novo (NestJS+React) cresce em volta do Delphi, **um módulo de cada vez**, e o legado segue rodando o que ainda não foi migrado. Em qualquer momento do projeto, **parte do cliente está no novo, parte no velho** — e isso é projetado, não acidente.

Implicações que valem para **todas** as fases:

- **Legado convive.** O Delphi não morre na Fase 1; morre, por cliente, quando o último módulo dele migrar e o cutover daquele cliente reconciliar (Fase 5).
- **Ordem por risco crescente.** Começa pela retaguarda de baixo risco; termina no PDV/fiscal (risco máximo) e no sync (substituir o Horse).
- **Dossiê é a unidade.** Nenhuma tela migra sem dossiê + teste de paridade + revisão legado×novo (ADR-012) — ver [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md).
- **Expand/contract entre fases.** Schema muda só aditivo, com janela N/N-1 (ADR-009).
- **Trilhas de risco em paralelo desde a Fase 0.** Fiscal, TEF e periféricos são **SPIKEs** que correm cedo, mesmo que a entrega seja tarde — ver [blind-spots.md](blind-spots.md).

---

## Visão geral das fases

| Fase | Nome | Foco | Risco | Legado ainda roda? |
|------|------|------|-------|--------------------|
| **0** | Fundação | playbook, esqueleto de infra, camada de teclado, roteamento de tenant, **SPIKE fiscal** | médio (descoberta) | tudo |
| **1** | Tela-piloto | 1 módulo de retaguarda **baixo risco**, dossiê + paridade verde de ponta a ponta | baixo | quase tudo |
| **2** | Retaguarda | expandir módulos de back-office (cadastro, compras, estoque, financeiro, preço) | médio | PDV + fiscal + sync |
| **3** | PDV | caixa **offline**, devices, **fiscal** (risco máximo) | **máximo** | sync (Horse) |
| **4** | Edge + Sync | edge da loja, protocolo de sync — **substituir o Horse** | alto | nada de novo; legado em phase-out |
| **5** | Cutover | go-live **por cliente**: dual-run, reconciliação, rollback | alto (operacional) | só nos clientes não migrados |
| **6** | DS / IA | port do DataScience, IA sobre BI baseline | médio | — |

> A ordem **0→6** é por risco e dependência: ninguém toca PDV/fiscal antes de a fundação, a camada de teclado e a retaguarda estarem provadas; o cutover só ocorre quando o módulo do cliente tem paridade; a IA é a última (precisa de dado limpo + BI baseline).

---

## Fase 0 — Fundação

**Objetivo:** existir o chão sobre o qual toda tela é construída, e **descobrir cedo** o risco fiscal.

Entregas:

- **Este playbook** canônico (00–10) e o **loop de trabalho** (Fazer→Revisar→Revisar legado×novo).
- **Esqueleto de infra**: monólito modular NestJS (web/worker), Postgres db-per-tenant, Redis/BullMQ, CI/CD zero-downtime, observabilidade base — ver [../01-architecture/target-architecture.md](../01-architecture/target-architecture.md) e [../07-devops-infra/infrastructure.md](../07-devops-infra/infrastructure.md).
- **Camada de teclado** (`shared/keyboard`) e **`shared/ui`** (DS clonado + rebrand) prontos **antes** da primeira tela — ADR-010 exige fundação, não polimento. Ver [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) e [../09-design-system-and-ai/design-system-rebrand.md](../09-design-system-and-ai/design-system-rebrand.md).
- **Roteamento de tenant** seguro (pool no compute, silo no dado — ADR-004) — ver [../01-architecture/tenancy-and-data.md](../01-architecture/tenancy-and-data.md).
- **SPIKE de risco fiscal** (e TEF, e periféricos): provar de ponta a ponta **uma** NFC-e/SAT em homologação, contingência offline, certificado A1, um pinpad. **Não entrega o módulo — derrisca a arquitetura.** Ver [blind-spots.md](blind-spots.md).
- **SPIKE Oracle→Postgres** (ADR-011): pôr a sub-migração no radar cedo — ver [../05-migration-engineering/oracle-to-postgres.md](../05-migration-engineering/oracle-to-postgres.md).

**Critério de saída:**

- [ ] `shared/keyboard` + `shared/ui` rodam uma tela de exemplo com taborder/mnemônicos/Enter-avança provados em Playwright.
- [ ] Roteamento de tenant testado (request → banco correto, isolamento provado).
- [ ] Pipeline CI/CD faz deploy rolling/blue-green sem downtime de um "hello tenant".
- [ ] SPIKE fiscal emitiu **1** documento em homologação **e** operou **contingência offline** simulada.
- [ ] Plano de Oracle→Postgres com riscos mapeados (PL/SQL, tipos, packages).

---

## Fase 1 — Tela-piloto (retaguarda de baixo risco)

**Objetivo:** provar o **loop inteiro** numa tela real, ponta a ponta, com **paridade verde** — o "verde que vale" (exercita o caminho real).

Escolha do piloto: um módulo de **retaguarda de baixo risco** — cadastro simples (ex.: cadastro de **fornecedor** ou **unidade de medida**), sem fiscal, sem device, sem offline. CRUD com regras, mas sem o risco-coroa.

Entregas:

- **Dossiê completo** da tela (regra extraída, SQL dinâmica reconstruída, mapa de teclado do `.dfm`, casos de teste) — ver [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md).
- Implementação NestJS + React herdando a camada de teclado.
- **Teste de paridade** legado×novo verde no caminho real — ver [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md).
- Revisão por agente revisor independente — ver [../08-agents/review-loop.md](../08-agents/review-loop.md).

**Critério de saída:**

- [ ] Dossiê revisado e aprovado.
- [ ] Paridade verde **exercitando a SQL/condicional real** do legado (não mock).
- [ ] Teclado idêntico ao Delphi validado em Playwright (Tab/Alt+letra/Enter).
- [ ] Migration da tela em expand/contract, sem downtime, reversível.
- [ ] Tempo do ciclo dossiê→paridade medido (vira a base de estimativa das próximas).

---

## Fase 2 — Expandir a retaguarda

**Objetivo:** estrangular o back-office em massa, na **ordem de risco crescente**, reusando o ritmo da Fase 1.

Ordem sugerida de módulos (menor→maior risco de regra):

1. **Cadastros** (produto, fornecedor, cliente, NCM/tributação base).
2. **Compras / NF-e de entrada** (importação XML, manifestação do destinatário) — ver [blind-spots.md](blind-spots.md).
3. **Estoque / inventário** (saldo, balanço, perdas, validade, transferência entre lojas).
4. **Motor de preço e promoções** (tabela de preço, promoções, combos, preço por loja).
5. **Financeiro** (contas a pagar/receber, CNAB/boletos).
6. **Fiscal central / SPED/EFD** (apuração, geração de arquivos) — alta complexidade tributária; entra com a trilha fiscal já madura do SPIKE.

Tudo em **read replica + rollups** para relatório pesado (ADR-005/007) e worker tier para batch (fechamento, importação) — ver [../01-architecture/workload-tiers.md](../01-architecture/workload-tiers.md).

**Critério de saída:**

- [ ] Cada módulo com dossiê + paridade + revisão (sem exceção).
- [ ] **Relatórios/BI baseline** (DRE, margem, ruptura, ABC) determinísticos no ar — pré-requisito da Fase 6.
- [ ] RBAC/matriz de permissão do back-office implementada — ver [blind-spots.md](blind-spots.md).
- [ ] Trilha de auditoria imutável ligada nos módulos financeiro/fiscal.

---

## Fase 3 — PDV (offline, devices, fiscal) — risco máximo

**Objetivo:** o coração operacional. **Não pode cair quando a internet cair** (ADR-001/008). Aqui mora o risco-coroa.

Entregas:

- **PDV Electron offline-first** com banco local; vende 100% offline e reconcilia (ADR-008) — ver [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md).
- **Motor fiscal** no PDV: NFC-e/SAT, **contingência offline legal**, certificado A1/A3, fiscal **pinável** (ADR-010) — ver [blind-spots.md](blind-spots.md).
- **Camada de drivers** no Electron: impressora fiscal, **balança (EAN-13 peso/preço)**, gaveta, pinpad, leitor.
- **TEF/pagamentos**: Sitef/PayGo, bandeiras, **PIX no PDV**, certificação com adquirentes.
- **Teclado-pesado total** (kiosk, atalhos reservados) — a casca Electron assume o teclado que o browser nega.

**Critério de saída:**

- [ ] PDV vende, imprime cupom e fecha caixa **100% offline**; reconcilia sem perda nem duplicidade.
- [ ] Contingência fiscal offline **certificada** e transmissão posterior provada.
- [ ] TEF certificado com pelo menos um adquirente; PIX operando.
- [ ] Todos os periféricos do cliente-alvo operando via camada de drivers.
- [ ] Paridade de venda (legado×novo) verde com cupons reais.

---

## Fase 4 — Edge + Sync (substituir o Horse)

**Objetivo:** consolidar a topologia edge da loja e **substituir o microframework Horse** pelo protocolo de sync próprio.

Entregas:

- **Edge da loja**: consolidação local multi-PDV, fila de sync, resiliência de link.
- **Protocolo de sync** com semântica de conflito **de negócio** (não só técnica) — ver [blind-spots.md](blind-spots.md) e [../05-migration-engineering/sync-protocol.md](../05-migration-engineering/sync-protocol.md).
- **Contrato de API backward-compatible** para integrações de terceiros que hoje batem no Horse antigo (ADR-009) — ver [../05-migration-engineering/versioning-and-compatibility.md](../05-migration-engineering/versioning-and-compatibility.md).

**Critério de saída:**

- [ ] Sync edge↔nuvem reconcilia com regras de conflito de negócio definidas e testadas.
- [ ] Terceiros que usavam o Horse migram para o novo contrato sem quebra (janela N/N-1).
- [ ] Horse desligável num cliente sem perda de função.

---

## Fase 5 — Cutover por cliente (o dia mais arriscado)

**Objetivo:** go-live **por cliente** (= por tenant; cliente = empresa, ADR-003), como **evento controlado**.

Entregas por cliente:

- **Migração de dados** do legado → Postgres (ADR-011), reconciliada.
- **Dual-run**: legado e novo rodando em paralelo, comparando saídas, por uma janela definida.
- **Reconciliação** financeira/fiscal/estoque (saldos batem) antes de virar a chave.
- **Plano de rollback** ensaiado + janela + **treinamento** da equipe da loja.
- **Feature flags / rollout por tenant** para virar gradual.

**Critério de saída (por cliente):**

- [ ] Dual-run sem divergência material por N dias.
- [ ] Reconciliação de saldos (caixa, estoque, fiscal) fechada.
- [ ] Rollback ensaiado e cronometrado; janela e responsáveis definidos.
- [ ] Equipe treinada; suporte de plantão no go-live.
- [ ] Legado daquele cliente **desligado** após estabilização.

---

## Fase 6 — DS / IA (última)

**Objetivo:** "surfar a onda da IA" com os dados do cliente — **só depois** de core migrado e **BI baseline** no ar.

Entregas:

- Port do **DataScience** com **strip Apollo total** + re-domínio para varejo (ADR-013) — ver [../09-design-system-and-ai/datascience-port.md](../09-design-system-and-ai/datascience-port.md).
- Casos de valor: previsão de demanda, ruptura, ABC, precificação, perdas/validade, cesta de compras.

**Critério de saída:**

- [ ] **BI baseline determinístico** validado contra o legado (pré-requisito).
- [ ] Strip Apollo do DataScience completo + CI gate verde.
- [ ] Pelo menos um caso de IA medido contra o baseline (valor provado, não prometido).
- [ ] FinOps por tenant/dia pesado orçado — ver [blind-spots.md](blind-spots.md).

---

## Trilhas de risco que correm em paralelo (não são fases)

Algumas frentes **não esperam a fase** — começam como SPIKE na Fase 0 e amadurecem até a entrega:

- **Fiscal / TEF / periféricos** — SPIKE na Fase 0, entrega na Fase 3. Risco-coroa.
- **Oracle→Postgres** (ADR-011) — radar na Fase 0, executa por módulo nas Fases 2–5.
- **Onboarding/provisionamento de tenant em escala 900+** — automação que precisa existir antes do cutover em massa (Fase 5).
- **Observabilidade de frota** — cresce com a frota; obrigatória antes da Fase 5.
- **Modelo comercial SaaS** (metering/billing/dunning) — pode amadurecer em paralelo; afeta a Fase 5.

> Todas detalhadas em [blind-spots.md](blind-spots.md), por tema e severidade.

---

## Ver também

- [blind-spots.md](blind-spots.md) — pontos cegos por tema/severidade, com mitigação por fase.
- [README.md](README.md) — índice da seção 10.
- [../05-migration-engineering/migrations-expand-contract.md](../05-migration-engineering/migrations-expand-contract.md) — schema sem downtime entre fases.
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — PDV offline + edge (Fases 3–4).
- [../09-design-system-and-ai/datascience-port.md](../09-design-system-and-ai/datascience-port.md) — Fase 6.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — anti-objetivo big-bang.
