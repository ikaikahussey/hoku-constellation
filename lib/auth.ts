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
import { canAccessGatedContent, canAccessApi, canExportCsv, isStaff } from '@/lib/db/gating'
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

/** Session user from the Neon Auth cookie, or null. Safe in server components, route handlers, actions. */
export async function getSessionUser(): Promise<SessionUser | null> {
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
  isStaff: boolean
  canAccessGated: boolean
  canAccessApi: boolean
  canExportCsv: boolean
}

/** Session + user_account. Creates the account row on first sight. */
export async function getCurrentUser(): Promise<UserWithAccount | null> {
  const user = await getSessionUser()
  if (!user) return null
  const db = await getServiceDb()
  const account = await ensureUserAccount(db, user.id)
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    account,
    isStaff: isStaff(account),
    canAccessGated: canAccessGatedContent(account),
    canAccessApi: canAccessApi(account),
    canExportCsv: canExportCsv(account),
  }
}

export { canAccessGatedContent, canAccessApi, canExportCsv }
