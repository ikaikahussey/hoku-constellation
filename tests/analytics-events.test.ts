import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { EVENTS, sanitizeIdentifyProperties } from '@/lib/analytics-events'
import { DASHBOARDS } from '@/scripts/analytics/create-dashboards'

const ROOT = new URL('..', import.meta.url).pathname
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?)$/.test(name)) out.push(p)
  }
  return out
}

describe('analytics events', () => {
  it('event names are snake_case and unique', () => {
    const names = Object.values(EVENTS)
    for (const n of names) expect(n).toMatch(/^[a-z]+(_[a-z]+)*$/)
    expect(new Set(names).size).toBe(names.length)
  })
  it('every event is documented in docs/ANALYTICS_EVENTS.md', () => {
    const doc = readFileSync(join(ROOT, 'docs/ANALYTICS_EVENTS.md'), 'utf8')
    for (const n of Object.values(EVENTS)) expect(doc, n).toContain(`\`${n}\``)
  })
  it('no hard-coded event names outside lib/analytics-events.ts', () => {
    const files = ['app', 'components', 'lib'].flatMap(d => walk(join(ROOT, d))).filter(f => !f.endsWith('lib/analytics-events.ts'))
    const hits: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const n of Object.values(EVENTS)) if (new RegExp(`['"\`]${n}['"\`]`).test(src)) hits.push(`${relative(ROOT, f)}: '${n}'`)
      if (/\btrack\(\s*['"`]/.test(src) || /posthog\.capture\(\s*['"`](?!\$)/.test(src)) hits.push(`${relative(ROOT, f)}: literal event name in track/capture`)
    }
    expect(hits, hits.join('\n')).toEqual([])
  })
  it('identify never carries email or name', () => {
    const clean = sanitizeIdentifyProperties({ email: 'a@b.c', name: 'X', subscription_tier: 'individual', is_staff: false, signup_date: '2026-01-01' })
    expect(clean).toEqual({ subscription_tier: 'individual', is_staff: false, signup_date: '2026-01-01' })
    expect(Object.keys(clean)).not.toContain('email')
  })
  it('provider config: /ingest proxy, DNT, masked replay, excluded routes, reset on sign-out', () => {
    const providers = readFileSync(join(ROOT, 'app/providers.tsx'), 'utf8')
    expect(providers).toMatch(/api_host:\s*'\/ingest'/)
    expect(providers).toMatch(/respect_dnt:\s*true/)
    expect(providers).toMatch(/maskAllInputs:\s*true/)
    expect(providers).toMatch(/autocapture:\s*false/)
    for (const route of ['admin', 'auth', 'account']) expect(providers).toMatch(new RegExp(`\\^\\\\/${route}`))
    expect(providers).toMatch(/resetAnalytics\(\)/)
    const nextConfig = readFileSync(join(ROOT, 'next.config.ts'), 'utf8')
    expect(nextConfig).toMatch(/source: '\/ingest\/:path\*'.*us\.i\.posthog\.com/)
    expect(nextConfig).toMatch(/skipTrailingSlashRedirect:\s*true/)
    const signOut = readFileSync(join(ROOT, 'components/account/SignOutButton.tsx'), 'utf8')
    expect(signOut).toMatch(/resetAnalytics\(\)/)
  })
  it('dashboards reference only known events', () => {
    const known = new Set<string>([...Object.values(EVENTS), '$pageview'])
    for (const d of DASHBOARDS) for (const i of d.insights) for (const s of i.series) expect(known.has(s.event), s.event).toBe(true)
  })
})
