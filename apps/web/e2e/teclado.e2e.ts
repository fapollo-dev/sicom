import { test, expect, type Page } from '@playwright/test';

/**
 * Paridade de teclado (ADR-010) contra o mapa extraído do legado (docs/04-screen-dossier/mapa-de-teclado.md): as teclas do
 * form-base TfrmMaster/TfrmCadMaster no app real, com login real.
 */
async function entrar(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill('SMOKE');
  await page.getByLabel('Senha').fill('smoke123');
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test.describe('teclas da base (TfrmMaster)', () => {
  test('Esc fecha a tela e volta ao Início', async ({ page }) => {
    await entrar(page);
    await page.goto('/relatorios/entradas-financeiro');
    await page.getByRole('button', { name: /Consultar/ }).waitFor();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/inicio$/);
  });

  test('Enter avança campo (não submete) e Alt+← volta', async ({ page }) => {
    await entrar(page);
    await page.goto('/relatorios/entradas-financeiro');
    const de = page.getByLabel('De', { exact: true });
    await de.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Até', { exact: true })).toBeFocused();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(de).toBeFocused();
  });

  test('Ctrl+E abre a troca de empresa', async ({ page }) => {
    await entrar(page);
    await page.goto('/inicio');
    await page.getByRole('heading', { name: 'Apollo ERP' }).waitFor();
    await page.keyboard.press('Control+e');
    await expect(page.getByRole('dialog').getByText('Empresas', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/inicio$/);
  });
});

test.describe('teclas do cadastro (TfrmCadMaster)', () => {
  test('F3 abre a Pesquisa; Esc fecha a Pesquisa sem sair da tela', async ({ page }) => {
    await entrar(page);
    await page.goto('/cadastro/bancos');
    await page.getByRole('button', { name: /Pesquisar/ }).waitFor();
    await page.keyboard.press('F3');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/cadastro\/bancos$/);
  });

  test('Esc em inclusão não sai da tela', async ({ page }) => {
    await entrar(page);
    await page.goto('/cadastro/bancos');
    await page.getByRole('button', { name: /Adicionar/ }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/cadastro\/bancos$/);
  });
});
