/**
 * Server-side PostHog capture (posthog-node). Kept out of lib/analytics-events.ts so client bundles
 * never import Node-only code. Used by the Stripe webhook and cron routes.
 */
import 'server-only'
import type { EventName, EventProperties } from './analytics-events'

let serverClient: { capture: (args: { distinctId: string; event: string; properties?: Record<string, unknown> }) => void; shutdown: () => Promise<void> } | null = null

async function getServerClient() {
  if (serverClient) return serverClient
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return null
  const { PostHog } = await import('posthog-node')
  serverClient = new PostHog(key, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com', flushAt: 1, flushInterval: 0 })
  return serverClient
}

/** Server-side event (Stripe webhook, cron). Flushes immediately so serverless functions do not drop events. */
export async function captureServerEvent<E extends EventName>(distinctId: string, event: E, properties: EventProperties[E]): Promise<void> {
  const client = await getServerClient()
  if (!client) return
  client.capture({ distinctId, event, properties: properties as Record<string, unknown> })
  await client.shutdown().catch(() => {})
  serverClient = null
}
