# 10 — Roadmap

> Como o Apollo sai do Delphi para a plataforma nova **sem big-bang**: um plano **strangler** em fases (do menor risco ao maior, com cutover por cliente) e o inventário dos **pontos cegos** que afundam migrações de ERP de varejo. O legado **convive e é estrangulado**; go-live é evento controlado, não torcida.

## Pré-requisitos de leitura

- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — anti-objetivo **big-bang**, o risco-coroa fiscal, critérios de sucesso.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — os ADRs que o roadmap obedece (ADR-008/009/011/013).

## Arquivos da seção

| Arquivo | Para quê |
|---------|----------|
| [phases.md](phases.md) | Plano **strangler** em 7 fases: **0** fundação (playbook, infra, camada de teclado, roteamento de tenant, SPIKE fiscal) · **1** tela-piloto (retaguarda baixo risco, dossiê + paridade) · **2** expandir retaguarda · **3** PDV (offline/devices/fiscal — risco máximo) · **4** edge + sync (substituir o Horse) · **5** cutover por cliente (dual-run, reconciliação, rollback) · **6** DS/IA. Ordem de módulos por risco, **critério de saída** de cada fase, tabela-resumo. |
| [blind-spots.md](blind-spots.md) | **Arquivo de alto valor** — os pontos que o cliente ainda não enxergou, por **tema** (fiscal/pagamentos, PDV/devices, dados/cutover, varejo, plataforma, negócio/pessoas) e **severidade** (🔴 crown / 🟠 alto / 🟡 médio). Cada item: risco em 1–2 linhas + ponteiro de mitigação. Cobre motor fiscal, contingência offline, TEF/PIX, periféricos/balança, cutover, RBAC, LGPD, auditoria, preço/promoções/ESL, estoque/NF-e entrada, integrações, BI baseline, conflito offline, backup/DR, SaaS/billing, onboarding 900+, contrato de API, ICMS ST/DIFAL, skills/bus-factor, observabilidade de frota, FinOps, segurança do PDV, feature flags, SLA/exportação. Mapa rápido tema×severidade×fase. |

## A ideia central

> **Strangler, não substituição.** O sistema novo cresce em volta do Delphi módulo a módulo, do menor risco ao maior; em qualquer momento, parte do cliente está no novo e parte no velho — por design. O fiscal, o TEF e os periféricos correm como **trilha de risco desde a Fase 0** (SPIKE), mesmo entregando tarde. O **cutover por cliente** (Fase 5) é o dia mais arriscado: dual-run, reconciliação e rollback. A **IA é a última** (Fase 6): só sobre dado limpo e BI baseline.

## Ordem de leitura sugerida

1. [phases.md](phases.md) — o caminho no tempo e os critérios de saída.
2. [blind-spots.md](blind-spots.md) — os riscos a vigiar em cada fase (use o mapa tema×severidade×fase).

## Ver também

- [../05-migration-engineering/migrations-expand-contract.md](../05-migration-engineering/migrations-expand-contract.md) — schema sem downtime entre fases (ADR-009).
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — PDV offline + edge (Fases 3–4) + contingência fiscal.
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — o teste de paridade que libera cada fase.
- [../09-design-system-and-ai/datascience-port.md](../09-design-system-and-ai/datascience-port.md) — Fase 6 (IA/DS).
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — a tese e os anti-objetivos.
