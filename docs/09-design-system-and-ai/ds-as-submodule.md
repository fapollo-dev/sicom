# Design System como Submodule

> Como o Apollo Design System (`@apollosg/design-system`) entra e é consumido nos repos
> de aplicação da migração — via **git submodule** — e como sua evolução fica versionada
> e controlada sem travar os agentes.

**Pré-requisitos de leitura:** [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) (ADR-013, ADR-014) · [ds-agent-workflow.md](ds-agent-workflow.md) · [design-system-rebrand.md](design-system-rebrand.md)

---

## O modelo de 2 repos (a fronteira que não pode borrar)

A migração tem **dois mundos** de frontend, e o DS impõe uma fronteira que os agentes **não podem cruzar**:

| Mundo | O que mora aqui | Repo | Pipeline de agente |
|-------|-----------------|------|--------------------|
| **Design System** | componentes, tokens, a linguagem visual, exemplos canônicos | `apollo-designsystem-admin` (vira submodule) | `ds-designer → GATE → ds-dev → ds-reviewer` |
| **Aplicação (ERP)** | telas, páginas, fluxos, CRUDs reais consumindo o DS | repos do app (NestJS+React) | `app-designer → app-dev-react` + skill `crud-builder` |

> **Lei do DS** (do próprio `CLAUDE.md` dele): *"Pedido de TELA/PÁGINA/fluxo é Domínio App → vai no repo do app, não no DS."*
>
> Logo: **componente/token/visual → repo do DS**. **Tela/página/fluxo → repo do app.** Um agente que vai criar uma tela de "Clientes" trabalha no **app**, consumindo o `<DataTable>` do DS; se descobrir que precisa de um componente que **não existe**, ele cruza pro **DS** (pelo pipeline do DS, com gate) e volta.

O **submodule** é o que dá ao agente acesso aos **dois mundos ao mesmo tempo**: o source do DS, suas regras (`.claude/rules/`), suas skills (`crud-builder`, `ds-create-*`) e seus exemplos canônicos — tudo dentro do repo do app.

---

## Por que submodule (e não só `npm install`)

Publicar o DS como pacote npm (`@apollosg/design-system`) resolve **consumo de runtime**, mas não dá aos agentes o que eles precisam pra trabalhar:

1. **Acesso às regras e skills do DS** — o agente precisa ler o `CLAUDE.md`, o `.claude/rules/ds-standards.md` e rodar `/ds-create-crud`. Isso só existe no **source**, não no pacote publicado (`dist-lib/`).
2. **Evolução controlada** — o DS vai se auto-evoluir na direção da Apollo (componentes/padrões novos). O submodule fica **pinado num commit**: o app sabe exatamente em qual versão do DS está, e subir a versão é um ato **deliberado** (mover o ponteiro), não um `^x.y.z` que muda sozinho.
3. **Evoluir e consumir no mesmo passo** — um agente pode criar um componente no DS (numa branch do DS) e consumi-lo no app imediatamente, sem esperar um `npm publish`.

`npm` é para terceiros que só **consomem**. **Submodule** é para quem **co-evolui** — que é exatamente o caso da migração.

---

## Estado atual (pré-requisito antes do submodule)

O DS já foi forkado, desversionado e rebrandeado (ver [design-system-rebrand.md](design-system-rebrand.md)). Ele está em `apollo-designsystem-admin`, **sem remote**. Antes de virar submodule:

1. **Publicar o DS no git da Apollo** — criar o repo remoto deles (ex: `github.com/apollosg/apollo-designsystem-admin`) e dar o primeiro push do fork limpo.
2. Confirmar que o checklist de **strip iGreen** passou (ver [design-system-rebrand.md](design-system-rebrand.md)).

Só depois disso o submodule referencia um remote real.

---

## Setup do submodule (no repo do app)

```bash
# dentro do repo do app (ex: apollo-erp-web)
git submodule add git@github.com:apollosg/apollo-designsystem-admin.git design-system
git commit -m "chore: adiciona Apollo DS como submodule (pinado)"
```

Estrutura resultante:

```
apollo-erp-web/                 # repo do app
├── .gitmodules                 # aponta para o remote do DS + commit pinado
├── design-system/              # ← submodule (o DS inteiro: src, tokens, .claude, skills)
│   ├── CLAUDE.md               # a LEI do DS (agentes leem primeiro)
│   ├── .claude/rules/ds-standards.md
│   ├── .claude/skills/crud-builder/
│   └── src/components/ui/      # <DataTable>, <Button>, etc.
├── src/                        # o app ERP (telas, fluxos)
└── package.json
```

Clonar o app com o DS junto:

```bash
git clone --recurse-submodules <app-remote>
# ou, se já clonou sem:
git submodule update --init --recursive
```

---

## Como o app consome o DS

Duas formas, do mais simples ao mais integrado:

1. **Biblioteca buildada (recomendado p/ runtime):** o submodule expõe `@apollosg/design-system` via `build:lib`. No app, aponte a dependência para o caminho do submodule:
   ```jsonc
   // package.json do app
   "dependencies": { "@apollosg/design-system": "file:./design-system" }
   ```
   e importe normal: `import { DataTable, Button } from "@apollosg/design-system"` + o `theme.css`.
2. **Workspace (monorepo):** se o app for um workspace (pnpm/npm workspaces), o submodule entra como package do workspace e o link é automático.

> Seja qual for, o **`theme.css`** do DS (gerado por `npm run tokens:tw4`) precisa ser importado uma vez no app — é ele que carrega os tokens (a paleta Apollo azul+verde) como CSS vars.

---

## Versionamento e evolução controlada (o "tronco central")

O submodule fica **pinado num commit** do DS. Isso é a régua que deixa o DS evoluir **sem o app pegar mudança não-intencional**:

- **Subir a versão do DS no app** = ato deliberado:
  ```bash
  cd design-system && git pull origin main && cd ..
  git add design-system && git commit -m "chore: bump Apollo DS -> <novo-commit>"
  ```
- **Cada bump é revisável**: o diff do submodule mostra exatamente o que mudou no DS entre as duas versões.
- **Rollback trivial**: reaponta o submodule pro commit anterior.

Isso materializa a ideia do **tronco central**: o DS cresce (componentes novos, padrões novos rumo à Apollo), mas cada app escolhe **quando** absorver, e a história do DS é linear e auditável. A autonomia dos agentes para *criar* no DS (ver [ds-agent-workflow.md](ds-agent-workflow.md)) convive com o controle de *quando* o app adota.

---

## Regras de ouro do submodule (pra agentes)

1. **Editar o DS = commitar DENTRO de `design-system/`**, numa branch do DS (nunca em `main` do DS direto — regra do próprio DS). Depois, no app, commitar o **bump do ponteiro** separadamente.
2. **Nunca `git push`/`npm publish`/release do DS sozinho** — é decisão do mantenedor (regra do DS, ver [ds-agent-workflow.md](ds-agent-workflow.md), zona vermelha).
3. **Dois commits, dois mundos**: mudança no DS é um commit no repo do DS; adoção no app é um commit no repo do app (o bump). Não misturar.
4. **Sempre rodar `npm run tokens:tw4` no DS** após mexer em token, antes de consumir no app.

## Ver também
- [ds-agent-workflow.md](ds-agent-workflow.md) — como o agente trabalha com o DS em cada etapa (contrato, crud-builder, autonomia).
- [design-system-rebrand.md](design-system-rebrand.md) — o fork verde→azul e o strip iGreen.
- [../02-stack-and-standards/frontend-react-standards.md](../02-stack-and-standards/frontend-react-standards.md) — padrões do app que consome o DS.
