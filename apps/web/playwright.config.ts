import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Testes de PARIDADE DE TECLADO ponta a ponta (ADR-010; docs/06-testing-quality/playwright-e2e.md): a API real (dev-embedded com o
 * Postgres embarcado e o seed) e o web real, cada um numa porta própria — não colide com o dev-embedded (3000/5433) nem com o Vite
 * (5173) de quem estiver desenvolvendo, nem com o smoke.
 *   pnpm --filter @apollo/web exec playwright test
 */
const API = 3100;
const WEB = 5174;
const NODE = dirname(process.execPath); // o mesmo Node que roda o Playwright

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts/,
  timeout: 60_000,
  workers: 1,
  use: { baseURL: `http://localhost:${WEB}`, headless: true },
  webServer: [
    {
      command: `cd ../api && PATH=${NODE}:$PATH PORT=${API} APOLLO_PG_PORT=5435 APOLLO_PG_DATA=${join(tmpdir(), 'apollo-pgdata-e2e')} ./node_modules/.bin/ts-node --transpile-only scripts/dev-embedded.ts`,
      url: `http://localhost:${API}/auth/me`,
      timeout: 300_000,
      reuseExistingServer: false,
    },
    {
      command: `PATH=${NODE}:$PATH VITE_API_URL=http://localhost:${API} ./node_modules/.bin/vite --port ${WEB} --strictPort`,
      url: `http://localhost:${WEB}`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
