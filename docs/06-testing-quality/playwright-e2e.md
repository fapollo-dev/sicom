# Playwright E2E

> E2E estruturado em Playwright: page objects; **fluxos de teclado como teste de primeira classe** (taborder, F-keys, Enter-avança-campo, mnemônicos `&`); as **duas cascas** (browser e Electron); fluxos fiscais/PDV ponta-a-ponta. A memória muscular do operador é critério de aceite (ADR-010) — então o teclado é testado, não só implementado.

## Pré-requisitos de leitura

- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — Playwright é o padrão de teste de UI/fluxo, **inclusive teclado**.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-010** (teclado primeira classe; mnemônicos do `.dfm`) e **ADR-008** (duas cascas: browser/Electron).
- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) — a camada que estes testes verificam (taborder, Enter-avança, atalhos, mnemônicos).
- [../04-screen-dossier/dossier-template.md](../04-screen-dossier/dossier-template.md) — o mapa de teclado (§8) e os golden (§9) que viram caso de teste.
- [testing-strategy.md](testing-strategy.md) — onde o E2E e o teclado entram na pirâmide.

---

## Estrutura: page objects (não selectors soltos no teste)

Cada tela tem um **page object** que encapsula seletores e ações. O teste fala a linguagem do operador ("digita o EAN", "aperta F2"), não a do DOM. Seletores por **role/label** (espelham os mnemônicos `&` e a acessibilidade), nunca por CSS frágil.

```ts
// e2e/pages/CadProdutoPage.ts — page object da tela de cadastro de produto
import { Page, expect } from '@playwright/test';

export class CadProdutoPage {
  constructor(private page: Page) {}

  // seletores por role/label — espelham os mnemônicos do .dfm (§8 do dossiê)
  get codigo()    { return this.page.getByLabel('Código'); }     // &Código → Alt+C
  get descricao() { return this.page.getByLabel('Descrição'); }  // &Descrição
  get preco()     { return this.page.getByLabel('Preço'); }
  get ean()       { return this.page.getByLabel('EAN'); }
  get salvar()    { return this.page.getByRole('button', { name: 'Salvar' }); } // &Salvar

  async goto(id = 'novo') { await this.page.goto(`/cadastro/produto/${id}`); }

  // taborder esperada (capturada do .dfm — §8 do dossiê)
  readonly tabOrder = ['Código', 'Descrição', 'EAN', 'Preço'];
}
```

```ts
// e2e/fixtures.ts — fixtures compartilhadas (tenant de teste, login, seed)
import { test as base } from '@playwright/test';
export const test = base.extend<{ cadProduto: CadProdutoPage }>({
  cadProduto: async ({ page }, use) => { await use(new CadProdutoPage(page)); },
});
```

---

## Fluxos de teclado — teste de PRIMEIRA classe

Não é "nice-to-have". Quebrar a taborder reprova a tela igual a quebrar um cálculo. Os casos derivam do **mapa de teclado do dossiê** (§8), que é extraído do `.dfm` ([../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md)).

### TabOrder — `keyboard.press('Tab')` na ordem do `.dfm`

```ts
test('taborder segue a ordem do .dfm (§8 do dossiê)', async ({ page, cadProduto }) => {
  await cadProduto.goto();
  await expect(cadProduto.codigo).toBeFocused();          // ActiveControl: 1º campo recebe foco

  for (const label of cadProduto.tabOrder.slice(1)) {
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(label)).toBeFocused();   // cada Tab cai no campo certo
  }
  // Shift+Tab volta na ordem inversa
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByLabel('EAN')).toBeFocused();
});
```

### Enter-avança-campo — Enter move foco, não submete

```ts
test('Enter avança campo; confirma no botão Default', async ({ page, cadProduto }) => {
  await cadProduto.goto();
  await cadProduto.codigo.fill('1011');
  await page.keyboard.press('Enter');
  await expect(cadProduto.descricao).toBeFocused();       // Enter avançou (SelectNext do Delphi)
  await expect(page).toHaveURL(/produto\/novo/);          // NÃO submeteu

  // no botão Default (§8: btnSalvar Default=True), Enter confirma
  await cadProduto.salvar.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Produto salvo')).toBeVisible();
});
```

### F-keys — `keyboard.press('F2')`, escopo do painel ativo

```ts
test('F2 abre busca de produto; F4 abre busca de NCM (escopo da tela)', async ({ page, cadProduto }) => {
  await cadProduto.goto();
  await page.keyboard.press('F2');
  await expect(page.getByRole('dialog', { name: /Buscar produto/i })).toBeVisible();
  await page.keyboard.press('Escape');                    // Esc fecha (Cancel=True)
  await expect(page.getByRole('dialog')).toBeHidden();

  await cadProduto.ean.focus();
  await page.keyboard.press('F4');
  await expect(page.getByRole('dialog', { name: /NCM/i })).toBeVisible();
});
```

### Mnemônicos `&` — Alt+letra (aciona OU foca)

```ts
test('mnemônicos: Alt+S aciona Salvar; Alt+N foca o campo Nome', async ({ page, cadProduto }) => {
  await cadProduto.goto();

  // papel 1: ação — Alt+S clica Salvar (&Salvar)
  await cadProduto.codigo.fill('1011');
  await cadProduto.descricao.fill('ARROZ TIPO 1 5KG');
  await page.keyboard.press('Alt+s');
  await expect(page.getByText('Produto salvo')).toBeVisible();

  // papel 2: foco — Alt+N foca o campo associado (label &Nome com FocusControl)
  await page.keyboard.press('Alt+n');
  await expect(page.getByLabel('Nome')).toBeFocused();

  // affordance: o sublinhado aparece enquanto Alt está pressionado (clona o Windows)
  await page.keyboard.down('Alt');
  await expect(page.locator('u.mnem-on')).toBeVisible();
  await page.keyboard.up('Alt');
});
```

### Grid teclado-first — setas, Enter edita, Tab entre células

```ts
test('grid: setas movem célula, Enter edita, Esc cancela (espelha TDBGrid)', async ({ page }) => {
  await page.goto('/estoque/inventario');
  const grid = page.getByRole('grid');
  await grid.getByRole('gridcell').first().focus();       // grid é UM stop de Tab (roving tabindex)
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');                     // entra em edição
  await page.keyboard.type('42');
  await page.keyboard.press('Enter');                     // confirma e desce
  await expect(grid.getByRole('gridcell', { name: '42' })).toBeVisible();
});
```

---

## As duas cascas: browser E Electron (mesma app)

ADR-008: a **mesma** app React roda em browser (casual) e Electron (PDV/power-user). Os testes rodam nas **duas** — e a diferença que mais importa é o teclado: o browser **reserva** teclas (F5, Ctrl+W, F11) que o Electron **assume**. Logo, atalhos reservados **só** são testáveis na casca Electron.

```ts
// playwright.config.ts — dois projetos: browser e Electron
export default defineConfig({
  projects: [
    { name: 'browser',  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' } },
    { name: 'electron', testMatch: /.*\.electron\.spec\.ts/ },  // usa _electron launcher
  ],
});
```

```ts
// e2e/pdv-venda.electron.spec.ts — fluxo PDV na casca Electron (devices + teclas reservadas)
import { test, expect, _electron as electron } from '@playwright/test';

test('PDV em Electron: F5 não recarrega — é atalho do app', async () => {
  const app = await electron.launch({ args: ['dist-electron/main.js'] });
  const page = await app.firstWindow();

  // numa aba de browser F5 recarregaria; no Electron a app assume a tecla (keyboard-ux-layer §3)
  await page.getByLabel('Código do produto').fill('789100');
  await page.keyboard.press('F5');                         // atalho do app (ex.: atualizar preço)
  await expect(page.getByText('Preços atualizados')).toBeVisible();
  await expect(page).not.toHaveURL(/reloaded/);            // NÃO foi reload do Chromium

  await app.close();
});
```

```ts
// teste que roda nas DUAS cascas — mesma asserção de fluxo, casca diferente
test('Alt+S salva em ambas as cascas', async ({ page }, testInfo) => {
  // testInfo.project.name ∈ {browser, electron}; o comportamento de Alt+S tem de ser idêntico
  await page.goto('/cadastro/produto/novo');
  await page.getByLabel('Descrição').fill('TESTE');
  await page.keyboard.press('Alt+s');
  await expect(page.getByText('Produto salvo')).toBeVisible();
});
```

---

## Fluxos fiscais / PDV ponta-a-ponta

O E2E cobre o caminho do operador inteiro — e no PDV/fiscal isso inclui **offline** e **contingência** ([../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md)). Estes são E2E sobre a casca Electron (o motor fiscal e o banco local vivem nela).

```ts
test('venda offline → cupom emitido local → reconcilia sem duplicar', async () => {
  const app = await electron.launch({ args: ['dist-electron/main.js'] });
  const page = await app.firstWindow();

  await app.evaluate(({ app }) => app.emit('test:network', 'offline')); // derruba a rede no main process
  // venda toda por teclado (como o caixa faz): EAN, Enter insere item, F2 finaliza
  await page.getByLabel('Código / EAN').fill('7891000100103');
  await page.keyboard.press('Enter');                      // Enter no PDV INSERE o item (não avança)
  await expect(page.getByText('LEITE INTEGRAL 1L')).toBeVisible();
  await page.keyboard.press('F2');                         // finalizar venda
  await page.getByRole('button', { name: 'Dinheiro' }).click();
  await expect(page.getByText(/Cupom .* emitido/)).toBeVisible();  // emitiu offline

  // volta a rede → reconcilia; reenvio do mesmo cupom NÃO duplica (idempotência)
  await app.evaluate(({ app }) => app.emit('test:network', 'online'));
  await expect(page.getByText('Sincronizado')).toBeVisible();
  const dup = await app.evaluate(() => globalThis.syncMetrics.duplicateCoupons);
  expect(dup).toBe(0);

  await app.close();
});
```

> Os **valores** fiscais (imposto, total) não se conferem aqui no nível de centavo — isso é trabalho do harness de paridade contra o golden ([parity-harness.md](parity-harness.md)). O E2E prova o **fluxo** (emitiu, imprimiu, reconciliou sem duplicar); a paridade prova os **números**. Os dois juntos.

---

## Boas práticas (e armadilhas)

- **Seletor por role/label**, não CSS — casa com mnemônico e acessibilidade, e não quebra com refactor visual.
- **Sem `waitForTimeout`**; espere por estado (`toBeVisible`/`toBeFocused`).
- **Foco é asserção de primeira classe** (`toBeFocused`) — é o coração do teste de teclado.
- **Teclado real, não cliques** onde o operador usa teclado — `keyboard.press`, não `.click()`, senão o teste não prova a paridade de UX.
- **Modificadores variam por SO** (`Alt` vs `Alt+Shift` no Firefox) — a camada própria de mnemônicos resolve, mas fixe o browser/casca no projeto.
- **Caso de teclado rastreia o §8 do dossiê**; caso de fluxo fiscal/PDV rastreia o §9/§10 — cobertura derivada do dossiê ([testing-strategy.md](testing-strategy.md)).

---

## Ver também

- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) — a camada de teclado que estes testes verificam.
- [parity-harness.md](parity-harness.md) — os números (paridade de dados/cálculo); o E2E cobre o fluxo.
- [testing-strategy.md](testing-strategy.md) — onde o E2E e o teclado entram na pirâmide.
- [README.md](README.md) — índice da seção 06.
- [../04-screen-dossier/dossier-template.md](../04-screen-dossier/dossier-template.md) — mapa de teclado (§8) e golden (§9).
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — offline/contingência (base dos E2E de PDV).
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-010, ADR-008.
