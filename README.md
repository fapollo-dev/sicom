# Apollo ERP — Fase 0 (esqueleto andante)

Fundação web do Apollo (migração do ERP Delphi → NestJS + React) e o **piloto `uCadBancos`**
rodando ponta-a-ponta com **paridade provada** contra o legado.
Plano: `~/.claude/plans/starry-kindling-stream.md`. Playbook: `/Library/Apollo`.

## Estrutura
```
apps/api    NestJS modular (Kysely+pg, tenant request-scoped fail-closed, outbox)
apps/web    React 19 + Vite + camada de teclado própria (ADR-010) + telas do piloto
packages/shared   zod schema do Banco (fonte única back↔front)
```

## Toolchain (headless, sem admin)
Node e Postgres foram instalados localmente (sem admin):
```bash
source .toolchain/env.sh      # põe o Node 20 no PATH
```
Postgres é embarcado (`embedded-postgres`, binários arm64) — não precisa Docker.

## Rodar e verificar
```bash
source .toolchain/env.sh
pnpm install

# Backend: paridade de SQL (vs golden do legado) + integração (Postgres real)
pnpm --filter @apollo/api test          # 12 verdes

# Camada de teclado (mnemônicos &, Enter-avança) — ADR-010
pnpm --filter @apollo/web test          # 7 verdes

# Smoke "hello tenant": sobe API + Postgres e exercita o CRUD por HTTP
pnpm --filter @apollo/api smoke         # 9 verdes (tenant fail-closed, delta, carimbo, outbox)

# Demo no browser (precisa do Postgres rodando — ver nota)
pnpm --filter @apollo/api start:dev     # API em :3000
pnpm --filter @apollo/web dev           # web em :5173
```

## O que está provado (paridade com o legado, capturada em homologação)
- **Leitura** `select * from bancos where codbco = $1` (= semente `.dfm`).
- **INSERT delta** (só colunas tocadas) + **carimbo de auditoria** (statement separado) + **outbox** (replicação) na mesma transação.
- **UPDATE delta**, **DELETE físico**, pesquisa via view **`get_bancos`** (aliases `codigo`/`codigo_banco`).
- **PK por sequence**, **BR-02** (obrigatórios antes do banco), **BR-04** (uppercase), **RBAC** (seam), **tenant fail-closed**.
- **Teclado** (ADR-010): `&` mnemônico (Alt+letra) e Enter-avança-campo.

## Design System (plugado)
A UI consome o **`@apollosg/design-system`** (lib buildada em `dist-lib`): `Button` e
`FormFieldInput` com a camada de teclado por cima (mnemônicos `&` + Enter-avança),
Tailwind v4 + tema do DS. `pnpm --filter @apollo/web build` gera o bundle. Fronteira ADR-014
respeitada (visual = DS; teclado/tela = app). Pendência menor: fonte Geist (system-ui por ora).
Nota macOS: binários nativos do npm vêm com quarentena do Gatekeeper — limpar com
`xattr -rd com.apple.quarantine node_modules` (feito).

## Deferido (Fase 0 posterior / outras fases)
- `DataTable` do DS na listagem (hoje tabela simples) + RBAC real (stub).
- Replicação **fan-out por terminal** e contingência → trilha de sync (Fase 4).
- Worker tier (BullMQ), IaC/CI-CD/observabilidade, Electron/PDV, Oracle→PG em escala.

## Banco do piloto
Postgres local com a tabela `bancos` mapeada do Oracle e **seed real** (15 bancos do
tenant PINHEIRAO de homologação). DDL/seed em `apps/api/migrations/`.
