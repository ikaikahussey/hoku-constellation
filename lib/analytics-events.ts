/**
 * Product analytics event vocabulary (PostHog). Every event name in the codebase must come from
 * this file — tests/analytics-events.test.ts enforces it. Documented in docs/ANALYTICS_EVENTS.md.
 *
 * Privacy: never send raw search queries, emails, or names. identify() carries only
 * subscription_tier, is_staff, signup_date.
 */

export const EVENTS = {
  SEARCH_PERFORMED: 'search_performed',
  ENTITY_VIEWED: 'entity_viewed',
  NETWORK_GRAPH_OPENED: 'network_graph_opened',
  NETWORK_GRAPH_NODE_CLICKED: 'network_graph_node_clicked',
  CONNECTION_PATH_REQUESTED: 'connection_path_requested',
  POWER_MAP_VIEWED: 'power_map_viewed',
  MONEY_FLOW_VIEWED: 'money_flow_viewed',
  DOCUMENT_OPENED: 'document_opened',
  SUMMARY_VIEWED: 'summary_viewed',
  ALERT_CREATED: 'alert_created',
  ALERT_OPENED: 'alert_opened',
  PAYWALL_SHOWN: 'paywall_shown',
  PRICING_VIEWED: 'pricing_viewed',
  CHECKOUT_STARTED: 'checkout_started',
  CHECKOUT_COMPLETED: 'checkout_completed',
  SUBSCRIPTION_CANCELLED: 'subscription_cancelled',
  EDITORIAL_MAP_VIEWED: 'editorial_map_viewed',
  EXPORT_CLICKED: 'export_clicked',
} as const

export type EventName = (typeof EVENTS)[keyof typeof EVENTS]

export interface EventProperties {
  search_performed: { query_length: number; result_count: number; kind?: string }
  entity_viewed: { kind: string; entity_id: string; gate_hit: boolean }
  network_graph_opened: { entity_id?: string }
  network_graph_node_clicked: { kind?: string }
  connection_path_requested: { hops?: number }
  power_map_viewed: { dimension?: string }
  money_flow_viewed: { entity_id?: string }
  document_opened: { source: string; doc_type?: string }
  summary_viewed: { tier: 'free' | 'paid' }
  alert_created: { alert_type?: string }
  alert_opened: { alert_type?: string }
  paywall_shown: { location: string }
  pricing_viewed: Record<string, never>
  checkout_started: { tier: string; interval?: 'monthly' | 'yearly' }
  checkout_completed: { tier: string; amount: number; currency?: string }
  subscription_cancelled: { previous_tier?: string }
  editorial_map_viewed: Record<string, never>
  export_clicked: { format?: string; location?: string }
}

/** Person properties allowed on identify(). No email, no name. */
export interface IdentifyProperties {
  subscription_tier: string
  is_staff: boolean
  signup_date: string
}

const FORBIDDEN_IDENTIFY_KEYS = ['email', 'name', 'full_name', 'first_name', 'last_name', 'phone']

export function sanitizeIdentifyProperties(props: Record<string, unknown>): IdentifyProperties {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    if (FORBIDDEN_IDENTIFY_KEYS.includes(k.toLowerCase())) continue
    clean[k] = v
  }
  return {
    subscription_tier: String(clean.subscription_tier ?? 'free'),
    is_staff: Boolean(clean.is_staff),
    signup_date: String(clean.signup_date ?? ''),
  }
}

// ---------------------------------------------------------------- browser capture

type PostHogLike = {
  capture: (event: string, props?: Record<string, unknown>) => void
  identify: (id: string, props?: Record<string, unknown>) => void
  reset: () => void
}

function browserPosthog(): PostHogLike | null {
  if (typeof window === 'undefined') return null
  const ph = (window as unknown as { posthog?: PostHogLike }).posthog
  return ph ?? null
}

export function track<E extends EventName>(event: E, properties: EventProperties[E]): void {
  browserPosthog()?.capture(event, properties as Record<string, unknown>)
}

export function identifyUser(userId: string, props: Record<string, unknown>): void {
  browserPosthog()?.identify(userId, sanitizeIdentifyProperties(props) as unknown as Record<string, unknown>)
}

export function resetAnalytics(): void {
  browserPosthog()?.reset()
}
