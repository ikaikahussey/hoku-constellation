import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const PAGES = ['/', '/search?q=green', '/explore', '/pricing', '/person/josh-green', '/org/hawaiian-electric-industries', '/auth/login', '/privacy']

for (const path of PAGES) {
  test(`axe: ${path} has no serious or critical violations`, async ({ page }) => {
    await page.goto(path)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')}`), JSON.stringify(serious, null, 2)).toEqual([])
  })
}

test('links are red and underlined in running text; body is black on white', async ({ page }) => {
  await page.goto('/privacy')
  const body = await page.evaluate(() => { const s = getComputedStyle(document.body); return { color: s.color, bg: s.backgroundColor } })
  expect(body).toEqual({ color: 'rgb(0, 0, 0)', bg: 'rgb(255, 255, 255)' })
  const link = page.locator('main a[href]').first()
  const style = await link.evaluate(el => { const s = getComputedStyle(el); return { color: s.color, deco: s.textDecorationLine } })
  expect(style.color).toBe('rgb(204, 0, 0)')
  expect(style.deco).toContain('underline')
})
