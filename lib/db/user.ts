/**
 * User-facing data access through the Neon Data API (PostgREST-compatible), with RLS enforced by the
 * caller's Neon Auth JWT. Server-side variant: reads the session JWT from the request cookies.
 *
 * Anonymous requests use Neon's anonymous token so `anonymous`-role policies apply.
 *
 * Env: NEXT_PUBLIC_NEON_DATA_API_URL, NEXT_PUBLIC_NEON_AUTH_URL
 */
import { NeonPostgrestClient, fetchWithToken } from '@neondatabase/postgrest-js'
import { getSessionJwt } from '@/lib/auth'

export type UserClient = NeonPostgrestClient

export function getDataApiUrl(): string {
  const url = process.env.NEXT_PUBLIC_NEON_DATA_API_URL
  if (!url) throw new Error('NEXT_PUBLIC_NEON_DATA_API_URL is not set')
  return url
}

export function getAuthUrl(): string {
  const url = process.env.NEXT_PUBLIC_NEON_AUTH_URL ?? process.env.NEON_AUTH_BASE_URL
  if (!url) throw new Error('NEXT_PUBLIC_NEON_AUTH_URL is not set')
  return url
}

let anonymousToken: { token: string; exp: number } | null = null

/** Anonymous JWT from Neon Auth (`GET /token/anonymous`), cached until shortly before expiry. */
export async function getAnonymousToken(): Promise<string | null> {
  const now = Date.now()
  if (anonymousToken && anonymousToken.exp - 30_000 > now) return anonymousToken.token
  try {
    const res = await fetch(`${getAuthUrl().replace(/\/$/, '')}/token/anonymous`, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const json = (await res.json()) as { token?: string }
    if (!json.token) return null
    const exp = decodeExp(json.token) ?? now + 10 * 60_000
    anonymousToken = { token: json.token, exp }
    return json.token
  } catch {
    return null
  }
}

function decodeExp(jwt: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) as { exp?: number }
    return payload.exp ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

/**
 * Data API client bound to the current session (server components, route handlers, actions).
 * Signed-out callers get the anonymous token.
 */
export async function getUserClient(): Promise<UserClient> {
  const getToken = async () => (await getSessionJwt()) ?? (await getAnonymousToken()) ?? ''
  return new NeonPostgrestClient({
    dataApiUrl: getDataApiUrl(),
    options: { global: { fetch: fetchWithToken(getToken) } },
  })
}

/** Data API client for a specific JWT (tests, server-to-server on behalf of a user). */
export function getUserClientForToken(token: string): UserClient {
  return new NeonPostgrestClient({
    dataApiUrl: getDataApiUrl(),
    options: { global: { fetch: fetchWithToken(async () => token) } },
  })
}
