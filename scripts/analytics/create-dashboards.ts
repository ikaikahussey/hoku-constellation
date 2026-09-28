#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * Creates or updates HOKU Insider dashboards in PostHog through the REST API.
 *
 * Env: POSTHOG_PERSONAL_API_KEY (phx_…), POSTHOG_PROJECT_ID, optional POSTHOG_API_HOST
 * (default https://us.posthog.com). Idempotent: dashboards and insights are matched by name.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/analytics/create-dashboards.ts [--dry]
 */
import { EVENTS } from '@/lib/analytics-events'

const HOST = process.env.POSTHOG_API_HOST ?? 'https://us.posthog.com'
const KEY = process.env.POSTHOG_PERSONAL_API_KEY
const PROJECT = process.env.POSTHOG_PROJECT_ID
const DRY = process.argv.includes('--dry')

type Series = { event: string; math?: 'total' | 'dau' | 'unique_session'; name?: string }
interface InsightSpec { name: string; description: string; kind: 'trend' | 'funnel'; series: Series[]; breakdown?: string; interval?: 'day' | 'week' }
interface DashboardSpec { name: string; description: string; insights: InsightSpec[] }

export const DASHBOARDS: DashboardSpec[] = [
  {
    name: 'HOKU Insider — Acquisition & conversion',
    description: 'Pricing → checkout funnel, paywall pressure, sign-ups.',
    insights: [
      { name: 'Pricing → checkout funnel', description: 'pricing_viewed → checkout_started → checkout_completed', kind: 'funnel', series: [{ event: EVENTS.PRICING_VIEWED }, { event: EVENTS.CHECKOUT_STARTED }, { event: EVENTS.CHECKOUT_COMPLETED }] },
      { name: 'Paywall shown by location', description: 'Where free users hit the gate', kind: 'trend', series: [{ event: EVENTS.PAYWALL_SHOWN }], breakdown: 'location' },
      { name: 'Checkout started by tier', description: '', kind: 'trend', series: [{ event: EVENTS.CHECKOUT_STARTED }], breakdown: 'tier' },
      { name: 'Subscriptions cancelled', description: '', kind: 'trend', series: [{ event: EVENTS.SUBSCRIPTION_CANCELLED }], interval: 'week' },
    ],
  },
  {
    name: 'HOKU Insider — Engagement',
    description: 'What subscribers and visitors do.',
    insights: [
      { name: 'Searches per day', description: '', kind: 'trend', series: [{ event: EVENTS.SEARCH_PERFORMED }] },
      { name: 'Entity views by kind', description: '', kind: 'trend', series: [{ event: EVENTS.ENTITY_VIEWED }], breakdown: 'kind' },
      { name: 'Graph opens and node clicks', description: '', kind: 'trend', series: [{ event: EVENTS.NETWORK_GRAPH_OPENED }, { event: EVENTS.NETWORK_GRAPH_NODE_CLICKED }] },
      { name: 'Documents opened by source', description: '', kind: 'trend', series: [{ event: EVENTS.DOCUMENT_OPENED }], breakdown: 'source' },
      { name: 'Weekly active users by tier', description: '', kind: 'trend', series: [{ event: '$pageview', math: 'dau' }], breakdown: 'subscription_tier', interval: 'week' },
      { name: 'Exports clicked', description: '', kind: 'trend', series: [{ event: EVENTS.EXPORT_CLICKED }], breakdown: 'format' },
    ],
  },
  {
    name: 'HOKU Insider — Performance & health',
    description: 'Traffic shape and replay volume. Web vitals live in Vercel Speed Insights.',
    insights: [
      { name: 'Pageviews by path', description: '', kind: 'trend', series: [{ event: '$pageview' }], breakdown: '$pathname' },
      { name: 'Pageviews with a query string', description: 'Search/filter usage without recording the text', kind: 'trend', series: [{ event: '$pageview' }], breakdown: 'has_query' },
      { name: 'Sessions recorded', description: '', kind: 'trend', series: [{ event: '$pageview', math: 'unique_session' }] },
    ],
  },
]

function filters(spec: InsightSpec) {
  const events = spec.series.map((s, i) => ({ id: s.event, type: 'events', order: i, math: s.math ?? 'total', name: s.name ?? s.event }))
  if (spec.kind === 'funnel') return { insight: 'FUNNELS', events, funnel_viz_type: 'steps', date_from: '-30d' }
  return { insight: 'TRENDS', events, interval: spec.interval ?? 'day', date_from: '-30d', display: spec.breakdown ? 'ActionsBar' : 'ActionsLineGraph', ...(spec.breakdown ? { breakdown: spec.breakdown, breakdown_type: spec.breakdown === 'subscription_tier' ? 'person' : 'event' } : {}) }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${HOST}/api/projects/${PROJECT}${path}`, { ...init, headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.json() as Promise<T>
}

async function findByName<T extends { name: string }>(path: string, name: string): Promise<T | null> {
  const page = await api<{ results: T[] }>(`${path}?search=${encodeURIComponent(name)}&limit=100`)
  return page.results.find(r => r.name === name) ?? null
}

async function main() {
  if (!DRY && (!KEY || !PROJECT)) throw new Error('POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID are required (or pass --dry)')
  for (const d of DASHBOARDS) {
    console.log(`${DRY ? '[dry] ' : ''}dashboard: ${d.name} (${d.insights.length} insights)`)
    if (DRY) { for (const i of d.insights) console.log(`  - ${i.name}: ${JSON.stringify(filters(i))}`); continue }
    let dash = await findByName<{ id: number; name: string }>('/dashboards/', d.name)
    if (!dash) dash = await api<{ id: number; name: string }>('/dashboards/', { method: 'POST', body: JSON.stringify({ name: d.name, description: d.description, pinned: true }) })
    else await api(`/dashboards/${dash.id}/`, { method: 'PATCH', body: JSON.stringify({ description: d.description }) })
    for (const i of d.insights) {
      const body = { name: i.name, description: i.description, filters: filters(i), dashboards: [dash.id], saved: true }
      const existing = await findByName<{ id: number; name: string; dashboards?: number[] }>('/insights/', i.name)
      if (existing) {
        await api(`/insights/${existing.id}/`, { method: 'PATCH', body: JSON.stringify({ ...body, dashboards: [...new Set([...(existing.dashboards ?? []), dash.id])] }) })
        console.log(`  updated ${i.name}`)
      } else {
        await api('/insights/', { method: 'POST', body: JSON.stringify(body) })
        console.log(`  created ${i.name}`)
      }
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1) })
