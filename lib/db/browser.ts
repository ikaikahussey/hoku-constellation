'use client'
/**
 * Browser-side Neon client: Neon Auth (Better Auth API) + Data API with automatic JWT injection.
 * Used by client components for sign-in/sign-up/sign-out and RLS-scoped reads.
 */
import { createClient } from '@neondatabase/neon-js'

type BrowserClient = ReturnType<typeof createClient>

let client: BrowserClient | null = null

/**
 * Neon serves Auth and the Data API on sibling hosts of the same endpoint:
 *   https://<ep>.neonauth.<region>.aws.neon.tech/<db>/auth  →  https://<ep>.apirest.<region>.aws.neon.tech/<db>/rest/v1
 * Used when NEXT_PUBLIC_NEON_DATA_API_URL is not set explicitly.
 */
export function deriveDataApiUrl(authUrl: string): string {
  return authUrl.replace('.neonauth.', '.apirest.').replace(/\/auth\/?$/, '/rest/v1')
}

export function getBrowserClient(): BrowserClient {
  if (client) return client
  const authUrl = process.env.NEXT_PUBLIC_NEON_AUTH_URL
  if (!authUrl) throw new Error('NEXT_PUBLIC_NEON_AUTH_URL is not set')
  const dataApiUrl = process.env.NEXT_PUBLIC_NEON_DATA_API_URL ?? deriveDataApiUrl(authUrl)
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
