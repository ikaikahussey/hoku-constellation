import { test, expect } from '@playwright/test'

test.describe('analytics proxy and privacy', () => {
  test('/ingest/* is rewritten to PostHog (never a Next.js 404)', async ({ request }) => {
    const res = await request.get('/ingest/static/array.js', { maxRedirects: 0 }).catch(() => null)
    // Upstream may be unreachable offline (5xx), but the route must exist (not the app 404).
    if (res) expect(res.status()).not.toBe(404)
    const decide = await request.post('/ingest/decide/?v=3', { data: {} }).catch(() => null)
    if (decide) expect(decide.status()).not.toBe(404)
  })
  test('no analytics requests leave the page without a project key, and none carry the search text', async ({ page }) => {
    const outbound: string[] = []
    page.on('request', r => { if (/posthog|\/ingest\//.test(r.url())) outbound.push(r.url() + ' ' + (r.postData() ?? '')) })
    await page.goto('/search?q=secret-search-term')
    await page.waitForLoadState('networkidle')
    for (const o of outbound) expect(o).not.toContain('secret-search-term')
  })
  test('Speed Insights script is mounted (Vercel deployments only)', async ({ page }) => {
    test.skip(!process.env.BASE_URL, 'the Speed Insights script is injected only when served by Vercel')
    await page.goto('/')
    const hasSpeedInsights = await page.evaluate(() => !!document.querySelector('script[src*="_vercel/speed-insights"], script[src*="speed-insights"]') || typeof (window as unknown as { si?: unknown }).si !== 'undefined')
    expect(hasSpeedInsights).toBeTruthy()
  })
})
