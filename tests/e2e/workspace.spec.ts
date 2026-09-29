import { test, expect, type Page } from '@playwright/test'
import Stripe from 'stripe'

/**
 * E10 end-to-end: sign up → create team → invite member → create client and watchlist → add bill →
 * receive alert (mock outbox) → generate, edit, approve, and download a report → view a briefing →
 * export CSV → subscribe to the ICS feed.
 *
 * Offline: Neon Auth is hosted, so "sign up" uses the localhost-only test session
 * (E2E_TEST_AUTH_SECRET, see lib/auth.ts). The Pro upgrade arrives through the real signed Stripe
 * webhook route; emails land in the in-process outbox (EMAIL_TRANSPORT=memory).
 */
test.skip(!!process.env.BASE_URL, 'offline flow: runs against the local PGlite server only')

const RUN = Date.now().toString(36)
const OWNER = { id: `e2e-owner-${RUN}`, email: `owner-${RUN}@example.com`, name: 'E2E Owner' }
const MEMBER = { id: `e2e-member-${RUN}`, email: `member-${RUN}@example.com`, name: 'E2E Member' }
const BILL_ID = '00000000-0000-4000-8000-000000000004' // SB1234 (2026), seeded by tests/e2e/db-server.ts
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_e2e_secret'
const CRON = process.env.CRON_SECRET ?? 'e2e-cron-secret'

const signIn = async (page: Page, u: typeof OWNER) => {
  const r = await page.request.post('/api/e2e/login', { data: u })
  expect(r.ok(), await r.text()).toBe(true)
}
const hstParts = (d: Date) => { const h = new Date(d.getTime() - 36e6); return { y: h.getUTCFullYear(), m: h.getUTCMonth() + 1, d: h.getUTCDate() } }
const pad = (n: number) => String(n).padStart(2, '0')

test('professional workflow from sign-up to calendar feed', async ({ page, browser }) => {
  test.setTimeout(240_000)

  // Sign up and land in a personal workspace.
  await signIn(page, OWNER)
  await page.goto('/workspace')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

  // Create a team.
  await page.goto('/workspace/team')
  await page.getByLabel('Organization name').fill('Kaʻōnohi Consulting')
  await page.getByRole('button', { name: 'Create team' }).click()
  await expect(page).toHaveURL(/\/workspace\/team\?created=1$/)
  await expect(page.getByRole('heading', { name: 'Kaʻōnohi Consulting' })).toBeVisible()
  await expect(page.getByLabel('Team', { exact: true })).toHaveValue(/[0-9a-f-]{36}/)
  expect(await page.getByLabel('Team', { exact: true }).locator('option').count()).toBe(2) // personal + new team, no duplicates
  const teamId = await page.locator('[data-team-id]').getAttribute('data-team-id')
  expect(teamId).toMatch(/^[0-9a-f-]{36}$/)

  // Upgrade to Pro (3 seats) through the signed Stripe webhook.
  const payload = JSON.stringify({ id: `evt_${RUN}`, object: 'event', type: 'customer.subscription.updated', data: { object: {
    id: `sub_${RUN}`, object: 'subscription', customer: `cus_${RUN}`, status: 'active', collection_method: 'charge_automatically', metadata: { team_id: teamId },
    items: { object: 'list', data: [{ id: `si_${RUN}`, quantity: 3, price: { id: process.env.STRIPE_PRICE_PRO_YEARLY ?? 'price_e2e_pro_yearly' } }] } } } })
  const hook = await page.request.post('/api/webhook/stripe', { data: payload, headers: { 'content-type': 'application/json', 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) } })
  expect(hook.ok(), await hook.text()).toBe(true)
  await page.goto('/workspace/billing')
  await expect(page.getByText(/billed annually · 3 seats/)).toBeVisible()

  // Invite a member; the member accepts in a separate browser.
  await page.goto('/workspace/team')
  await page.getByLabel('Email', { exact: true }).fill(MEMBER.email)
  await page.getByRole('button', { name: 'Send invitation' }).click()
  const link = await page.getByLabel('Link').inputValue()
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]+$/)
  const memberCtx = await browser.newContext()
  const member = await memberCtx.newPage()
  await signIn(member, MEMBER)
  await member.goto(new URL(link).pathname)
  await member.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(member).toHaveURL(/\/workspace$/)
  await expect(member.getByLabel('Team', { exact: true })).toContainText('Kaʻōnohi Consulting')
  await memberCtx.close()
  await page.goto('/workspace/team')
  await expect(page.getByRole('cell', { name: MEMBER.email })).toBeVisible()

  // Create a client and a watchlist for it; add the bill; create an email alert.
  await page.goto('/workspace/clients')
  await page.locator('#cn-new').fill('Kaiāulu Health Alliance')
  await page.locator('#cr-new').fill('client@example.org')
  await page.getByRole('button', { name: 'Add client' }).click()
  await expect(page.getByText('Added Kaiāulu Health Alliance')).toBeVisible()

  await page.goto('/workspace/watchlists')
  await page.getByLabel('Name', { exact: true }).fill('Energy bills')
  await page.locator('#wl-client').selectOption({ label: 'Kaiāulu Health Alliance' })
  await page.getByRole('button', { name: 'Create watchlist' }).click()
  await expect(page.getByText('Created Energy bills')).toBeVisible()
  await page.goto('/workspace/watchlists')
  const list = page.locator('section', { has: page.getByRole('heading', { name: 'Energy bills' }) })
  await list.getByRole('combobox', { name: 'Add a bill, person, or organization' }).fill('SB1234')
  await list.getByRole('option', { name: /SB1234 \(2026\)/ }).click()
  await list.getByLabel('Position').selectOption('support')
  await list.getByRole('button', { name: 'Add bill, person, or organization' }).click()
  await expect(list.getByText('Added to watchlist')).toBeVisible()
  await list.getByRole('button', { name: 'Create alert' }).click()
  await expect(list.getByText('Alert created')).toBeVisible()

  // Receive an alert: the bill gets a hearing notice upstream; the alert pipeline runs; mail arrives.
  const hearing = hstParts(new Date(Date.now() + 3 * 864e5))
  const today = new Date().toISOString().slice(0, 10)
  const status = `Bill scheduled to be heard by EET on Tuesday, ${pad(hearing.m)}-${pad(hearing.d)}-${String(hearing.y).slice(2)} 9:00AM in conference room 225.`
  expect((await page.request.post('/api/e2e/fixture', { data: { action: 'bill_status', measure: 'SB1234', session: '2026', status, date: today } })).ok()).toBe(true)
  const tick = await page.request.post('/api/cron/alerts', { headers: { authorization: `Bearer ${CRON}` } })
  expect(tick.ok(), await tick.text()).toBe(true)
  await expect.poll(async () => {
    const box = await (await page.request.get('/api/e2e/outbox')).json() as Array<{ to: string[]; subject: string }>
    return box.some(m => m.to.includes(OWNER.email) && /SB1234/.test(m.subject))
  }, { timeout: 30_000 }).toBe(true)
  await page.goto('/workspace')
  await expect(page.getByRole('heading', { name: 'Recent alerts' })).toBeVisible()
  await expect(page.getByText(/Hearing scheduled/).first()).toBeVisible()
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Hearings this week' }) }).getByRole('link', { name: 'SB1234' })).toBeVisible()

  // Generate, edit, approve, and download a report.
  await page.goto('/workspace/reports')
  await page.getByLabel('Client').selectOption({ label: 'Kaiāulu Health Alliance' })
  await page.getByLabel('From').fill(new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10))
  await page.getByLabel('To').fill(today)
  await page.getByRole('button', { name: 'Generate draft' }).click()
  await expect(page).toHaveURL(/\/workspace\/reports\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: 'Kaiāulu Health Alliance' })).toBeVisible()
  await expect(page.getByText('Bill scheduled to be heard by EET').first()).toBeVisible()
  const editor = page.getByRole('textbox', { name: 'Report summary' })
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' Our team will testify in support.')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByText('Draft saved')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('alert').filter({ hasText: 'without a citation' })).toContainText('Our team will testify in support.')
  await page.getByRole('button', { name: 'Approve report' }).click()
  await expect(page.getByText(/approved \d{4}-\d{2}-\d{2}/)).toBeVisible()
  const pdfHref = await page.getByRole('link', { name: 'Download PDF' }).getAttribute('href')
  const pdf = await page.request.get(pdfHref!)
  expect(pdf.headers()['content-type']).toBe('application/pdf')
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-')
  const docx = await page.request.get((await page.getByRole('link', { name: 'Download Word' }).getAttribute('href'))!)
  expect((await docx.body()).subarray(0, 2).toString()).toBe('PK')
  await page.getByRole('button', { name: /Send to 1 recipient/ }).click()
  await expect(page.getByText(/· sent \d{4}-\d{2}-\d{2}/)).toBeVisible()
  const box = await (await page.request.get('/api/e2e/outbox')).json() as Array<{ to: string[]; subject: string; attachments: string[] }>
  const sent = box.find(m => m.to.includes('client@example.org'))!
  expect(sent.attachments).toEqual([expect.stringMatching(/\.pdf$/), expect.stringMatching(/\.docx$/)])

  // View a bill briefing.
  await page.goto(`/briefings/${BILL_ID}`)
  await expect(page.getByRole('heading', { name: 'SB1234 (2026)' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Indicators' })).toBeVisible()
  await expect(page.getByText('This section does not predict an outcome.')).toBeVisible()

  // Export CSV.
  const csv = await page.request.get('/api/export/bills')
  expect(csv.headers()['content-type']).toMatch(/text\/csv/)
  expect(await csv.text()).toContain('SB1234')

  // Subscribe to the ICS feed; rotating the link turns the old one off.
  await page.goto('/workspace/settings')
  await page.getByRole('button', { name: 'Create calendar link' }).click()
  const ics = await page.getByLabel('Link').inputValue()
  const feed = await page.request.get(new URL(ics).pathname)
  expect(feed.headers()['content-type']).toMatch(/text\/calendar/)
  const body = await feed.text()
  expect(body).toMatch(/^BEGIN:VCALENDAR\r\n/)
  expect(body).toContain('EET hearing: SB1234 (2026)')
  await page.getByRole('button', { name: /Create a new link/ }).click()
  await expect(page.getByLabel('Link')).not.toHaveValue(ics)
  const rotated = await page.getByLabel('Link').inputValue()
  expect((await page.request.get(new URL(ics).pathname)).status()).toBe(404)
  expect((await page.request.get(new URL(rotated).pathname)).status()).toBe(200)
})
