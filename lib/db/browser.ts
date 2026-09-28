'use client'
/**
 * Browser-side Neon client: Neon Auth (Better Auth API) + Data API with automatic JWT injection.
 * Used by client components for sign-in/sign-up/sign-out and RLS-scoped reads.
 */
import { createClient } from '@neondatabase/neon-js'

type BrowserClient = ReturnType<typeof createClient>

let client: BrowserClient | null = null

export function getBrowserClient(): BrowserClient {
  if (client) return client
  const authUrl = process.env.NEXT_PUBLIC_NEON_AUTH_URL
  const dataApiUrl = process.env.NEXT_PUBLIC_NEON_DATA_API_URL
  if (!authUrl || !dataApiUrl) throw new Error('NEXT_PUBLIC_NEON_AUTH_URL / NEXT_PUBLIC_NEON_DATA_API_URL are not set')
  client = createClient({
    auth: { url: authUrl, allowAnonymous: true },
    dataApi: { url: dataApiUrl },
  })
  return client
}

/** Better Auth client API for sign-in / sign-up / sign-out / password reset in client components. */
export function getAuthClient() {
  return getBrowserClient().auth
}
