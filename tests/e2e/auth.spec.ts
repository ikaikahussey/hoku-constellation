import { test, expect } from '@playwright/test'

/**
 * Auth pages render offline. Full sign-up → sign-in → account → sign-out runs only against a real
 * deployment (BASE_URL) with E2E_AUTH_EMAIL / E2E_AUTH_PASSWORD, because Neon Auth is a hosted service.
 */
test.describe('auth pages', () => {
  test('login form has email, password, Google and reset links', async ({ page }) => {
    await page.goto('/auth/login')
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /log in|sign in/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /forgot|reset/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /sign up|create/i })).toBeVisible()
  })
  test('signup form validates and keeps the plan parameter', async ({ page }) => {
    await page.goto('/auth/signup?plan=individual')
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await page.getByRole('button', { name: /sign up|create/i }).click()
    // HTML5 required validation keeps us on the page
    await expect(page).toHaveURL(/auth\/signup/)
  })
  test('reset-password page renders request and token forms', async ({ page }) => {
    await page.goto('/auth/reset-password')
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await page.goto('/auth/reset-password?token=abc')
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible()
    await expect(page.getByLabel(/confirm new password/i)).toBeVisible()
  })
  test('failed login shows an error, not a crash', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByLabel(/email/i).fill('nobody@example.com')
    await page.getByLabel(/password/i).fill('wrong-password-123')
    await page.getByRole('button', { name: /log in|sign in/i }).click()
    await expect(page.getByText(/⚠|error|invalid|failed|unable/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/auth\/login/)
  })
})

test.describe('auth flows (hosted only)', () => {
  test.skip(!process.env.BASE_URL || !process.env.E2E_AUTH_EMAIL, 'needs BASE_URL, E2E_AUTH_EMAIL, E2E_AUTH_PASSWORD')
  test('sign in, account page, sign out', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByLabel(/email/i).fill(process.env.E2E_AUTH_EMAIL!)
    await page.getByLabel(/password/i).fill(process.env.E2E_AUTH_PASSWORD!)
    await page.getByRole('button', { name: /log in|sign in/i }).click()
    await page.goto('/account')
    await expect(page).toHaveURL(/\/account/)
    await expect(page.getByText(/subscription/i).first()).toBeVisible()
    await page.getByRole('button', { name: /sign out|log out/i }).click()
    await page.goto('/account')
    await expect(page).toHaveURL(/\/auth\/login/)
  })
})
