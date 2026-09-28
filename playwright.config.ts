import { defineConfig, devices } from '@playwright/test'

/**
 * E2E against a local production build backed by PGlite (no network, no Neon account), or against a
 * deployment when BASE_URL is set (auth flows then run for real if E2E_AUTH_EMAIL/PASSWORD are set).
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100)
const PG_PORT = Number(process.env.E2E_PG_PORT ?? 54329)
const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${WEB_PORT}`

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' } },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL, trace: 'retain-on-failure', ...devices['Desktop Chrome'], launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' } },
  webServer: process.env.BASE_URL ? undefined : [
    { command: `npx tsx --tsconfig tsconfig.scripts.json tests/e2e/db-server.ts`, port: PG_PORT, timeout: 120_000, reuseExistingServer: false, env: { E2E_PG_PORT: String(PG_PORT) } },
    { command: `bash tests/e2e/web.sh`, url: `${baseURL}/pricing`, timeout: 600_000, reuseExistingServer: false, env: { E2E_PG_PORT: String(PG_PORT), E2E_WEB_PORT: String(WEB_PORT) } },
  ],
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
})
