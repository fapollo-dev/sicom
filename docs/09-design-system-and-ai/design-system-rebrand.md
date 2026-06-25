# Design System — Clone + Rebrand verde→azul (ADR-013)

> O design system do cliente é um **clone limpo** de um DS de referência (iGreen) com **rebrand verde→azul** via design tokens, e **strip iGreen obrigatório** antes de qualquer commit no git do cliente. Reuso acelera; vazar marca/cor/copy/asset da iGreen é defeito de release.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-013** (DS e DataScience são forks limpos, sem vínculo iGreen) e **ADR-010** (teclado primeira classe).
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — higiene de fork: rodar o checklist de strip antes de commitar.
- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) — a camada de teclado **é parte do DS** (componentes `Button`, `Field`, `Modal`, `DataGrid`, mnemônicos).
- [../02-stack-and-standards/frontend-react-standards.md](../02-stack-and-standards/frontend-react-standards.md) — onde o DS se encaixa (`shared/ui`, `shared/keyboard`), duas cascas.
- [../02-stack-and-standards/tech-stack.md](../02-stack-and-standards/tech-stack.md) — primitivos headless (Radix/React Aria), AG Grid/TanStack.

---

## 1) Por que clonar e não recomeçar

O DS de referência (iGreen) já resolveu o caro: primitivos **headless** vestidos por token, foco/acessibilidade, grid teclado-first, formulários, modais, theming por CSS variables. Recomeçar do zero é reinventar meses de trabalho de baixo valor. A decisão canônica (ADR-013) é **forkar e rebrandear**, com **uma única regra dura**: nada de iGreen entra no repositório do cliente — nem cor, nem nome, nem copy, nem asset, nem URL, nem comentário.

> **A marca é dado.** Tratar "strip iGreen" como tarefa de gosto/cosmética é o erro. É **gate de release**: um logo iGreen num `favicon.ico` ou um `#00A859` perdido num token de borda é vazamento de marca de terceiro no produto do cliente.

O que **vem junto** no clone (e fica):

- **Camada de teclado** completa (`shared/keyboard`): `ShortcutScope`, `useEnterAdvances`, `useMnemonic`, taborder, mnemônicos `&` — ver [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md). É a coroa do ERP (ADR-010) e **parte do DS**, não um add-on.
- **Componentes `shared/ui`** vestidos por token: `Button`, `Field`, `Modal`/`Dialog`, `DataGrid`, `Menu`, `Toast`, `Table`, `Tabs`, `Form`.
- **Theming por tokens** (CSS variables + camada TS), que é exatamente o ponto de injeção do rebrand.

---

## 2) Arquitetura de tokens (o ponto de injeção do rebrand)

O rebrand **não toca componente** — toca **token**. Se um componente tem cor hardcoded, isso é bug a corrigir (token-leak), não algo a rebrandear caso a caso. O DS expõe três camadas de token:

| Camada | Exemplo | Quem mexe no rebrand |
|--------|---------|----------------------|
| **Primitivos** (paleta crua) | `--blue-600: #2563EB` | **Sim** — troca a rampa verde por azul |
| **Semânticos** (papel) | `--color-primary: var(--blue-600)` | **Aponta** para a nova rampa (nome do papel não muda) |
| **De componente** (opcional) | `--button-bg: var(--color-primary)` | Não, herda do semântico |

A regra: **componentes consomem só semânticos**; o rebrand troca a paleta primitiva e o apontamento semântico. Um componente nunca lê `--green-500` direto — se ler, é leak.

```ts
// shared/ui/tokens/primitives.ts — paleta crua (a rampa que o rebrand troca)
// ❌ ANTES (iGreen — verde): rampa de marca da iGreen
export const green = {
  50:  '#E6F7EE', 100: '#C2EBD4', 200: '#8FDCAE', 300: '#5BCB88',
  400: '#2FBC68', 500: '#00A859', 600: '#009A4E', 700: '#00813F',
  800: '#006833', 900: '#004F26',
} as const;

// ✅ DEPOIS (cliente — azul): rampa neutra, sem qualquer referência iGreen
export const blue = {
  50:  '#EFF6FF', 100: '#DBEAFE', 200: '#BFDBFE', 300: '#93C5FD',
  400: '#60A5FA', 500: '#3B82F6', 600: '#2563EB', 700: '#1D4ED8',
  800: '#1E40AF', 900: '#1E3A8A',
} as const;
```

```ts
// shared/ui/tokens/semantic.ts — papéis (o componente lê DAQUI, nunca da paleta crua)
// ❌ ANTES
export const color = {
  primary:        green[500],   // #00A859  (verde iGreen)
  primaryHover:   green[600],
  primaryActive:  green[700],
  primarySubtle:  green[50],
  focusRing:      green[400],
  link:           green[700],
};

// ✅ DEPOIS  (mesmos NOMES de papel; só o apontamento muda verde→azul)
export const color = {
  primary:        blue[600],    // #2563EB  (azul do cliente)
  primaryHover:   blue[700],
  primaryActive:  blue[800],
  primarySubtle:  blue[50],
  focusRing:      blue[400],
  link:           blue[700],
};
```

```css
/* shared/ui/theme.css — CSS variables (runtime). O rebrand troca os HEX, não os nomes. */
:root {
  /* ❌ ANTES (verde iGreen) */
  /* --color-primary:        #00A859;
     --color-primary-hover:  #009A4E;
     --color-focus-ring:     #2FBC68; */

  /* ✅ DEPOIS (azul cliente) */
  --color-primary:        #2563EB;
  --color-primary-hover:  #1D4ED8;
  --color-primary-active: #1E40AF;
  --color-primary-subtle: #EFF6FF;
  --color-focus-ring:     #60A5FA;
  --color-link:           #1D4ED8;
}
```

### Exemplo de tokens antes/depois (verde → azul)

| Token (papel) | ANTES — verde iGreen | DEPOIS — azul cliente | Observação |
|---------------|----------------------|------------------------|------------|
| `--color-primary` | `#00A859` | `#2563EB` | cor de marca; a mais visível |
| `--color-primary-hover` | `#009A4E` | `#1D4ED8` | um passo mais escuro na rampa |
| `--color-primary-active` | `#00813F` | `#1E40AF` | estado pressionado |
| `--color-primary-subtle` | `#E6F7EE` | `#EFF6FF` | fundo de seleção/badge |
| `--color-focus-ring` | `#2FBC68` | `#60A5FA` | **anel de foco — crítico p/ teclado** (não esquecer) |
| `--color-link` | `#00813F` | `#1D4ED8` | links |
| `--brand-name` | `"iGreen"` | `"<cliente>"` | **token de texto** — vira copy se vazar |
| `--logo-src` | `/assets/igreen-logo.svg` | `/assets/<cliente>-logo.svg` | asset, não só cor |
| `--font-brand` | `"Greenz Sans"` | `"Inter"` (ou a do cliente) | fonte de marca também identifica |

> Atenção ao **anel de foco** (`--color-focus-ring`): num ERP teclado-pesado ele é a affordance mais usada da tela (o operador não usa mouse — ver [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md)). Se o rebrand esquecer o foco, sobra verde iGreen no lugar mais visível para quem opera de teclado.

---

## 3) CHECKLIST de strip iGreen (gate de release — obrigatório antes de commitar)

Rode **antes de qualquer commit** no git do cliente. Cada categoria tem o "o quê" e o "como caçar". Nada vai para o repositório do cliente com `[ ]` aberto.

### 3.1 Nomes de marca e copy

- [ ] **Nome "iGreen"/"iGreen Energy"/"igreen"** em qualquer casing — código, comentário, JSON, MD, teste, fixture.
- [ ] **Razão social / CNPJ / endereços** da iGreen em rodapés, "sobre", páginas de erro, e-mails.
- [ ] **Slogans/taglines** ("energia que…", etc.) e termos de domínio iGreen (energia/telecom/seguros) que não existem no domínio de supermercado.
- [ ] **Nomes de pessoas/personas** da iGreen (ex.: agentes "Sol"/"Claudia"/"Janete"/"Betina") em strings, mocks ou copy.
- [ ] **Copy de e-mail/notificação/WhatsApp** templatizada com marca iGreen.

```bash
# caça por nome de marca (case-insensitive) em tudo que vai pro repo
grep -ri -E 'igreen|i-green|igreenenergy|igreen energy' src/ public/ \
  --include='*.{ts,tsx,js,jsx,css,scss,json,md,html,svg,txt,yml,yaml,env}' \
  -l
# personas/domínio que não pertencem ao cliente
grep -ri -E '\b(sol|claudia|janete|betina)\b|energia|telecom|licenciado|consultor' src/ public/ -l
```

### 3.2 Logos, ícones e assets visuais

- [ ] **Logos** (SVG/PNG/WebP) iGreen em `public/`, `assets/`, `static/`.
- [ ] **Ilustrações/imagens** com marca ou identidade verde iGreen.
- [ ] **SVGs inline** com `fill="#00A859"` ou path do logotipo iGreen.
- [ ] **Sprites/icon fonts** que embutam o ícone da marca.
- [ ] **Open Graph / social images** (`og-image.png`, `twitter-card.png`).

```bash
# assets binários e SVG por nome
find public/ src/ -iname '*igreen*' -o -iname '*logo*' -o -iname '*brand*'
# verde iGreen embutido em SVG/CSS
grep -rli -E '#00a859|#009a4e|#00813f|00a859' src/ public/
```

### 3.3 Favicons e ícones de app

- [ ] **`favicon.ico`**, `favicon.svg`, `apple-touch-icon.png`, `icon-192/512.png`.
- [ ] **`manifest.webmanifest`** (`name`, `short_name`, `theme_color`, `background_color`, ícones).
- [ ] **Ícones do Electron** (`build/icon.icns`/`icon.ico`/`icon.png`, `electron-builder` `appId`/`productName`).
- [ ] **`theme_color`** do PWA/manifest ainda verde iGreen.

### 3.4 Tokens de cor (verde → azul)

- [ ] **Paleta primitiva** trocada (rampa verde removida, rampa azul no lugar) — seção 2.
- [ ] **Sem `--green-*` / hex verde iGreen** restante em token, componente ou CSS.
- [ ] **Apontamento semântico** revisado (primary/hover/active/subtle/**focusRing**/link).
- [ ] **Charts/data-viz**: paleta de gráficos não pode começar no verde de marca.
- [ ] **Status colors** (success) podem ser verde **genérico** — mas não o **verde de marca** iGreen; distinga.

```bash
# nenhum hex da rampa iGreen pode sobrar
grep -rni -E '#(00a859|009a4e|00813f|006833|004f26|2fbc68|5bcb88|8fdcae)' src/ public/
# nenhum token nomeado 'green' de marca
grep -rni -E '\b(green)-?(50|100|500|600|700)\b' src/ui/tokens/
```

### 3.5 Fontes e tipografia de marca

- [ ] **Web fonts proprietárias** da iGreen (`.woff2` de fonte de marca) removidas de `public/fonts/`.
- [ ] **`@font-face`** apontando para fonte de marca iGreen.
- [ ] **`font-family`** de marca substituída pela do cliente (ou neutra: Inter/system).
- [ ] **Licença da fonte**: a fonte de marca iGreen pode ser licenciada **para a iGreen** — não pode ir no app do cliente.

### 3.6 URLs, domínios, endpoints, IDs

- [ ] **Domínios** `*.igreenenergy.com.br`, `hub.igreen*`, links de docs/dashboard iGreen.
- [ ] **Endpoints de API** apontando para serviços iGreen (DS API, Hub, Knowledge).
- [ ] **Telefones/e-mails** (`@igreenenergy.com.br`, números de suporte iGreen).
- [ ] **Deep-links / redirect URIs / OAuth callbacks** com domínio iGreen.
- [ ] **Analytics/telemetria** (GA/Sentry DSN/PostHog) apontando para projeto iGreen — **trocar de projeto, não só de cor**.

```bash
grep -rni -E 'igreenenergy\.com\.br|hub\.igreen|@igreenenergy|sentry\.io/[0-9]+|posthog' \
  src/ public/ .env* --include='*'
```

### 3.7 Meta, SEO e head

- [ ] **`<title>`** e `<meta name="application-name">` / `description` / `author`.
- [ ] **Open Graph** (`og:title`, `og:site_name`, `og:image`, `og:url`).
- [ ] **`<meta name="theme-color">`** verde iGreen.
- [ ] **`robots.txt` / `sitemap.xml`** com domínio iGreen.
- [ ] **`package.json`** (`name`, `description`, `author`, `homepage`, `repository`, `license`).

### 3.8 Segredos, configs e histórico (o que mais escapa)

- [ ] **`.env`/`.env.example`** sem chaves/tokens/DSN iGreen (mesmo que "exemplo").
- [ ] **Comentários e TODO** mencionando sistemas iGreen.
- [ ] **Storybook/Chromatic**: stories e baselines visuais com marca iGreen.
- [ ] **Histórico git** — clone do DS deve começar com **squash/`--orphan`** (sem trazer o log iGreen). Strip no `HEAD` não basta se o histórico carrega a marca.
- [ ] **CHANGELOG / LICENSE / NOTICE / CONTRIBUTING** com nome iGreen.
- [ ] **CI/CD** (workflows, secrets names, badges) referenciando org/repo iGreen.

> **Higiene de fork (ADR-013):** o clone do cliente **não** compartilha remote nem histórico com o repo iGreen. Comece com árvore limpa (`git checkout --orphan` ou export sem `.git`), rode o checklist, e só então faça o primeiro commit no git do cliente. Um `grep` que volta vazio nas seções 3.1–3.8 é o sinal verde.

### 3.9 Verificação automatizável (CI gate)

Transforme o checklist num **teste de CI que falha o build** se a marca vazar. Roda em todo PR do repo do cliente:

```bash
#!/usr/bin/env bash
# scripts/check-no-igreen.sh — falha o CI se qualquer referência iGreen vazar
set -euo pipefail
PATTERNS='igreen|i-green|igreenenergy|#00a859|#009a4e|#00813f|greenz sans|\bsol\b|claudia|janete|betina'
HITS=$(grep -rniE "$PATTERNS" src/ public/ package.json index.html \
  --include='*.{ts,tsx,js,jsx,css,scss,json,md,html,svg,txt,webmanifest}' || true)
if [ -n "$HITS" ]; then
  echo "❌ STRIP iGREEN FALHOU — referências encontradas:"; echo "$HITS"; exit 1
fi
echo "✅ strip iGreen OK — nenhum vazamento de marca"
```

> Faça este script um **job obrigatório** no pipeline (ver [../07-devops-infra/ci-cd-zero-downtime.md](../07-devops-infra/ci-cd-zero-downtime.md)). Marca-zero-vazamento é critério de merge, igual a teste verde.

---

## 4) A camada de teclado faz parte do DS

Diferente de um DS web comum, **a camada de teclado é componente de primeira classe do design system** do Apollo (ADR-010). Ela vem no clone e fica:

- `Button`, `Field`, `Modal`, `DataGrid`, `MenuBar` já falam **mnemônicos `&`**, taborder, Enter-avança, foco — ver [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md).
- O rebrand **veste** esses componentes (token de cor, foco, espaçamento) mas **não altera o comportamento de teclado** — comportamento é paridade com o Delphi, cor é marca. São eixos ortogonais.
- O **anel de foco** (`--color-focus-ring`) é o token mais sensível: ele é a UI principal de quem opera no teclado. Verde→azul **tem** que cobrir o foco, hover de linha de grid e a célula ativa do `DataGrid`.

> Regra: **rebrand mexe em token; paridade de teclado é intocável.** Quem rebrandear não "melhora" atalho nem taborder (anti-objetivo da missão — ver [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md)).

---

## 5) Fluxo de trabalho do clone (resumo)

1. **Export sem `.git`** do DS de referência (ou `git checkout --orphan`) → árvore limpa no repo do cliente.
2. **Rebrand de token** (seção 2): rampa verde→azul, apontamento semântico, foco coberto.
3. **Strip iGreen** (seção 3): nomes, logos, favicons, fontes, URLs, meta, segredos, histórico.
4. **CI gate** (3.9): `check-no-igreen.sh` obrigatório no pipeline.
5. **Visual regression**: Storybook/Chromatic do cliente, baselines novas (sem marca iGreen).
6. **Smoke de teclado**: Playwright confirma que mnemônicos/taborder seguem intactos pós-rebrand (ver [../06-testing-quality/playwright-e2e.md](../06-testing-quality/playwright-e2e.md)).

---

## Ver também

- [datascience-port.md](datascience-port.md) — o port de IA/DataScience (mesma disciplina de strip iGreen, fase posterior).
- [README.md](README.md) — índice da seção 09.
- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) — a camada de teclado (parte do DS).
- [../02-stack-and-standards/frontend-react-standards.md](../02-stack-and-standards/frontend-react-standards.md) — `shared/ui` / `shared/keyboard`, duas cascas.
- [../07-devops-infra/ci-cd-zero-downtime.md](../07-devops-infra/ci-cd-zero-downtime.md) — onde plugar o CI gate de strip.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-013** e **ADR-010**.
