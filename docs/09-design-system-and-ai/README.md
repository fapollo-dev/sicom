# 09 — Design System & IA (forks limpos da Apollo)

> Os dois artefatos que o Apollo **reaproveita** da Apollo por **fork limpo** (ADR-013): o **design system** (clone + rebrand verde→azul) e o **DataScience/IA** (port para o domínio de supermercado). Regra única e dura em ambos: **strip Apollo obrigatório** antes de qualquer commit no git do cliente — marca, cor, copy, asset, dados, segredos, prompts, knowledge.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-013** (DS e DataScience são forks limpos, sem vínculo Apollo) e **ADR-010** (teclado primeira classe).
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — higiene de fork: rodar o checklist de strip antes de commitar.

## Arquivos da seção

| Arquivo | Para quê |
|---------|----------|
| [design-system-rebrand.md](design-system-rebrand.md) | **ADR-013**: clone do DS de referência + **rebrand verde→azul** via design tokens (paleta primitiva → semântica → componente). **CHECKLIST de strip Apollo** completo (nomes, logos, favicons, fontes, tokens de cor, URLs, meta, segredos, histórico) + CI gate. A **camada de teclado** ([../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md)) é parte do DS. Exemplo de tokens antes/depois. |
| [ds-as-submodule.md](ds-as-submodule.md) | **ADR-014**: o DS entra nos repos de app como **git submodule** pinado. Modelo de 2 repos + a fronteira dura (componente=DS / tela=app), por que submodule e não só npm, setup, consumo (`theme.css` + lib), e **versionamento controlado** (o tronco central evolui, o app escolhe quando adotar). |
| [ds-agent-workflow.md](ds-agent-workflow.md) | **ADR-014**: como o agente trabalha com o DS **em cada etapa**. O contrato de entrada (ler `CLAUDE.md`+`ds-standards.md`), telas de tabela via **`crud-builder`** (`/ds-create-crud`, entrevista **alimentada pelo dossiê**), e o **modelo de autonomia em 3 zonas** (🟢 fluir / 🟡 pipeline do DS com gate / 🔴 mantenedor) que deixa o DS auto-evoluir **sem travar**. |
| [datascience-port.md](datascience-port.md) | **ADR-013**: port do DataScience/IA para o cliente "surfar a onda da IA" com os dados de varejo deles. **Strip de TODO vínculo Apollo** (dados, segredos, tenants, prompts, knowledge). Re-domínio para supermercado (demanda, ruptura, ABC, precificação, perdas/validade, cesta de compras). **FASE POSTERIOR** (Fase 6) — não é prioridade inicial. Proposta de valor + checklist. |

## A regra que atravessa os dois

> **Reuso acelera; vazar Apollo é defeito de release.** Em ambos os forks o "strip Apollo" é **gate de merge**, não cosmética. No DS visual o risco é marca/cor; no DataScience é **dado/segredo/conhecimento de terceiro** (mais grave — trate vazamento como incidente de segurança). Comece o fork com árvore git limpa (`--orphan`/export sem `.git`), rode o checklist, plugue o CI gate, e só então commite no repo do cliente.

## Ordem de leitura sugerida

1. [design-system-rebrand.md](design-system-rebrand.md) — o fork visual (acontece cedo, junto da fundação).
2. [ds-as-submodule.md](ds-as-submodule.md) — como o DS entra no app (submodule) e é versionado.
3. [ds-agent-workflow.md](ds-agent-workflow.md) — como o agente trabalha com o DS (contrato, crud-builder, autonomia).
4. [datascience-port.md](datascience-port.md) — o fork de IA (acontece tarde, Fase 6).

## Ver também

- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) — a camada de teclado é parte do DS.
- [../02-stack-and-standards/frontend-react-standards.md](../02-stack-and-standards/frontend-react-standards.md) — `shared/ui` / `shared/keyboard`, duas cascas.
- [../07-devops-infra/ci-cd-zero-downtime.md](../07-devops-infra/ci-cd-zero-downtime.md) — onde plugar o CI gate de strip.
- [../10-roadmap/phases.md](../10-roadmap/phases.md) — DS cedo (fundação), IA tarde (Fase 6).
- [../10-roadmap/blind-spots.md](../10-roadmap/blind-spots.md) — BI baseline antes da IA; LGPD; FinOps.
