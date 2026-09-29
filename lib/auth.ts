/**
 * Neon Auth (Managed Better Auth) server integration.
 *
 * - `getAuth()` returns the singleton created by `createNeonAuth` from @neondatabase/auth/next/server.
 *   It exposes the Better Auth server API (getSession, signIn, signOut, …), `.handler()` for
 *   app/api/auth/[...path]/route.ts, and `.middleware()` for proxy.ts.
 * - `getCurrentUser()` resolves the session and the `user_account` row (created on first sight).
 *
 * Env: NEON_AUTH_BASE_URL (server), NEON_AUTH_COOKIE_SECRET (≥ 32 chars), NEXT_PUBLIC_NEON_AUTH_URL (client).
 */
import { createNeonAuth, type NeonAuth } from '@neondatabase/auth/next/server'
import { getServiceDb } from '@/lib/db/service'
import { ensureUserAccount } from '@/lib/db/queries/accounts'
import { canAccessGatedContent, canAccessApi, canExportCsv } from '@/lib/db/gating'
import { getEntitlements, type Entitlements } from '@/lib/entitlements'
import type { UserAccountRow } from '@/lib/db/types'

export type SubscriptionTier = UserAccountRow['subscription_tier']

let instance: NeonAuth | null = null

export function getAuth(): NeonAuth {
  if (instance) return instance
  const baseUrl = process.env.NEON_AUTH_BASE_URL
  const secret = process.env.NEON_AUTH_COOKIE_SECRET
  if (!baseUrl || !secret) {
    throw new Error('NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET must be set')
  }
  instance = createNeonAuth({
    baseUrl,
    cookies: { secret, sessionDataTtl: 300 },
    logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
  })
  return instance
}

export interface SessionUser {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
}

// ------------------------------------------------------------------------------------------------
// Test-only sessions for offline end-to-end runs (Playwright against PGlite). Enabled only when
// E2E_TEST_AUTH_SECRET is set, the site URL is localhost, and the process is not on Vercel, so it
// can never be active in production. Neon Auth is a hosted service and cannot run offline.
// ------------------------------------------------------------------------------------------------
export const TEST_SESSION_COOKIE = 'hoku_e2e_session'

export function testAuthEnabled(): boolean {
  const secret = process.env.E2E_TEST_AUTH_SECRET
  if (!secret || secret.length < 16 || process.env.VERCEL) return false
  try {
    const host = new URL((process.env.NEXT_PUBLIC_SITE_URL ?? '').trim()).hostname
    return host === '127.0.0.1' || host === 'localhost'
  } catch { return false }
}

export async function signTestSession(user: { id: string; email: string; name?: string | null }): Promise<string> {
  const { createHmac } = await import('node:crypto')
  const body = Buffer.from(JSON.stringify({ id: user.id, email: user.email, name: user.name ?? null })).toString('base64url')
  return `${body}.${createHmac('sha256', process.env.E2E_TEST_AUTH_SECRET!).update(body).digest('base64url')}`
}

async function readTestSession(): Promise<SessionUser | null> {
  if (!testAuthEnabled()) return null
  const { cookies } = await import('next/headers')
  const raw = (await cookies()).get(TEST_SESSION_COOKIE)?.value
  if (!raw) return null
  const [body, sig] = raw.split('.')
  const { createHmac, timingSafeEqual } = await import('node:crypto')
  const expected = Buffer.from(createHmac('sha256', process.env.E2E_TEST_AUTH_SECRET!).update(body ?? '').digest('base64url'))
  if (!sig || expected.length !== Buffer.from(sig).length || !timingSafeEqual(expected, Buffer.from(sig))) return null
  const u = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { id: string; email: string; name: string | null }
  return { id: u.id, email: u.email, name: u.name, emailVerified: true }
}

/** Session user from the Neon Auth cookie, or null. Safe in server components, route handlers, actions. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const testUser = await readTestSession().catch(() => null)
  if (testUser) return testUser
  try {
    const { data } = await getAuth().getSession()
    const user = data?.user
    if (!user) return null
    return {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      emailVerified: Boolean(user.emailVerified),
    }
  } catch {
    return null
  }
}

/**
 * JWT for the current session, used to call the Neon Data API as the user. Returns null when signed
 * out (callers fall back to the anonymous token or the public read path).
 */
export async function getSessionJwt(): Promise<string | null> {
  try {
    const auth = getAuth() as unknown as { token?: () => Promise<{ data?: { token?: string } | null }> }
    if (typeof auth.token !== 'function') return null
    const res = await auth.token()
    return res?.data?.token ?? null
  } catch {
    return null
  }
}

export interface UserWithAccount {
  id: string
  email: string
  name: string | null
  account: UserAccountRow
  /** From app.entitlements(user_id): team membership, then legacy individual subscriptions. */
  entitlements: Entitlements
  isStaff: boolean
  canAccessGated: boolean
  canAccessApi: boolean
  canExportCsv: boolean
}

/** Access flags derived from entitlements (never from user_account.subscription_tier directly). */
export function accessFromEntitlements(e: Entitlements) {
  return {
    isStaff: e.is_staff,
    canAccessGated: e.paid_content || e.is_staff,
    canAccessApi: e.api || e.is_staff,
    canExportCsv: e.exports || e.is_staff,
  }
}

/** Session + user_account + entitlements. Creates the account row on first sight. */
export async function getCurrentUser(): Promise<UserWithAccount | null> {
  const user = await getSessionUser()
  if (!user) return null
  const db = await getServiceDb()
  const account = await ensureUserAccount(db, user.id)
  const entitlements = await getEntitlements(db, user.id)
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    account,
    entitlements,
    ...accessFromEntitlements(entitlements),
  }
}

export { canAccessGatedContent, canAccessApi, canExportCsv }
