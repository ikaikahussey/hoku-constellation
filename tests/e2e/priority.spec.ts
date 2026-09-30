import { test, expect } from '@playwright/test'

/**
 * Priority entities in the admin: match review lists edges naming a priority person first (above a far
 * larger unrelated amount) and can filter to them; the person form shows and saves the Priority flag.
 * Offline only: uses the localhost test session and the e2e fixture route.
 */
test.skip(!!process.env.BASE_URL, 'offline flow: runs against the local PGlite server only')

const RUN = Date.now().toString(36)
const STAFF = { id: `e2e-staff-${RUN}`, email: `staff-${RUN}@example.com`, name: 'E2E Staff' }
const NAME = `Keo Makanani ${RUN}`
const ALIAS = `Keola Makanani${RUN}`

test('priority names come first in match review and the flag is editable', async ({ page }) => {
  const login = await page.request.post('/api/e2e/login', { data: STAFF })
  expect(login.ok(), await login.text()).toBe(true)
  const fx = await page.request.post('/api/e2e/fixture', { data: { action: 'priority_review', user_id: STAFF.id, name: NAME, alias: ALIAS } })
  expect(fx.ok(), await fx.text()).toBe(true)
  const { entity_id: id } = await fx.json() as { entity_id: string }
  try {
    await page.goto('/admin/match-review')
    await expect(page.getByRole('heading', { name: 'Match review' })).toBeVisible()
    await expect(page.locator('p', { hasText: 'Priority:' }).getByRole('link', { name: NAME })).toBeVisible()
    const first = page.locator('ol > li').first()
    await expect(first.getByText('Priority', { exact: true })).toBeVisible()
    await expect(first).toContainText(`MAKANANI${RUN.toUpperCase()}, KEOLA K`)
    // The alias makes the person the top suggested match for the raw filing name.
    await expect(first.getByRole('link', { name: NAME })).toBeVisible()

    await page.getByLabel('Priority only').check()
    await page.getByRole('button', { name: 'Filter' }).click()
    await expect(page).toHaveURL(/priority=1/)
    await expect(page.getByText('E2E Large Donor Group')).toHaveCount(0)
    await expect(page.locator('ol > li').first()).toContainText(`MAKANANI${RUN.toUpperCase()}, KEOLA K`)

    await page.goto(`/admin/person/${id}/edit`)
    const box = page.getByRole('checkbox', { name: 'Priority' })
    await expect(box).toBeChecked()
    await box.uncheck()
    await page.getByRole('button', { name: 'Update person' }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/person/${id}$`))
    await page.goto(`/admin/person/${id}/edit`)
    await expect(page.getByRole('checkbox', { name: 'Priority' })).not.toBeChecked()
  } finally {
    // Remove the fixture so later specs (document counts, snapshots) see the seed data only.
    const clean = await page.request.post('/api/e2e/fixture', { data: { action: 'priority_cleanup', entity_id: id } })
    expect(clean.ok(), await clean.text()).toBe(true)
  }
})
