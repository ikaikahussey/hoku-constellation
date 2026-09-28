import { test, expect } from '@playwright/test'

// Baselines live in tests/e2e/__screenshots__ (Linux Chromium). Regenerate with --update-snapshots.
const VIEWS = [['home', '/'], ['pricing', '/pricing'], ['person', '/person/josh-green'], ['org', '/org/hawaiian-electric-industries'], ['login', '/auth/login']] as const

for (const [name, path] of VIEWS) {
  test(`visual: ${name}`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, mask: [page.locator('[data-ph-mask]'), page.locator('time')] })
  })
}
