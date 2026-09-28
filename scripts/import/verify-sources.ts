#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * Verifies every source in lib/import/source-registry.ts is reachable and crawlable:
 *   - robots.txt at the host root (fetched and parsed; the importer path must be allowed)
 *   - baseUrl and each `urls` entry respond (status < 400, or 401/403 recorded as "blocked")
 *   - secrets named in `secrets` are present in the environment
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/import/verify-sources.ts [--tier=1] [--status=live] [--json] [--markdown docs/INGESTION_REPORT.md]
 *
 * Uses lib/import/http.ts (identifying UA, 1 req/s per host). Exit code 1 when a `live` source fails.
 */
import { SOURCE_REGISTRY, type SourceDefinition } from '@/lib/import/source-registry'
import { httpFetch, robotsFor, isAllowed, HttpError, RobotsDisallowedError } from '@/lib/import/http'
import { writeFileSync } from 'node:fs'

export interface UrlCheck { url: string; status: number | null; ok: boolean; robots: 'allowed' | 'disallowed' | 'unknown'; ms: number; error?: string }
export interface SourceCheck { key: string; name: string; tier: number; status: SourceDefinition['status']; cadence: string; checks: UrlCheck[]; missingSecrets: string[]; verdict: 'ok' | 'blocked' | 'error' | 'skipped' }

async function checkUrl(url: string): Promise<UrlCheck> {
  const started = Date.now()
  let robots: UrlCheck['robots'] = 'unknown'
  try {
    const u = new URL(url)
    const rules = await robotsFor(u.origin)
    robots = isAllowed(rules, u.pathname + u.search) ? 'allowed' : 'disallowed'
  } catch { robots = 'unknown' }
  try {
    const res = await httpFetch(url, { retries: 2, noCache: true, headers: { accept: 'text/html,application/json;q=0.9,*/*;q=0.8' } })
    return { url, status: res.status, ok: res.status < 400, robots, ms: Date.now() - started }
  } catch (e) {
    if (e instanceof RobotsDisallowedError) return { url, status: null, ok: false, robots: 'disallowed', ms: Date.now() - started, error: 'robots.txt disallows' }
    if (e instanceof HttpError) return { url, status: e.status, ok: false, robots, ms: Date.now() - started, error: e.message }
    return { url, status: null, ok: false, robots, ms: Date.now() - started, error: (e as Error).message }
  }
}

export async function verify(sources: SourceDefinition[], log: (m: string) => void = () => {}): Promise<SourceCheck[]> {
  const out: SourceCheck[] = []
  for (const s of sources) {
    if (s.status === 'manual' || s.status === 'retired') { out.push({ key: s.key, name: s.name, tier: s.tier, status: s.status, cadence: s.cadence, checks: [], missingSecrets: [], verdict: 'skipped' }); continue }
    const urls = [...new Set([s.baseUrl, ...(s.urls ?? [])])]
    const checks: UrlCheck[] = []
    for (const u of urls) { const c = await checkUrl(u); checks.push(c); log(`${s.key} ${c.status ?? 'ERR'} ${c.robots} ${u}`) }
    const missingSecrets = (s.secrets ?? []).filter(k => !process.env[k])
    const anyAuthWall = checks.some(c => c.status === 401 || c.status === 403 || c.robots === 'disallowed')
    const allOk = checks.every(c => c.ok && c.robots !== 'disallowed')
    out.push({ key: s.key, name: s.name, tier: s.tier, status: s.status, cadence: s.cadence, checks, missingSecrets, verdict: allOk ? 'ok' : anyAuthWall ? 'blocked' : 'error' })
  }
  return out
}

export function toMarkdown(results: SourceCheck[], generatedAt = new Date().toISOString()): string {
  const lines = [`# Source verification`, ``, `Generated ${generatedAt} by scripts/import/verify-sources.ts.`, ``, `| Source | Tier | Registry status | Verdict | URLs | robots | Missing secrets |`, `|---|---|---|---|---|---|---|`]
  for (const r of results) {
    const urls = r.checks.map(c => `${c.status ?? 'ERR'}`).join(', ') || '—'
    const robots = r.checks.map(c => c.robots[0]).join('') || '—'
    lines.push(`| \`${r.key}\` | ${r.tier} | ${r.status} | ${r.verdict} | ${urls} | ${robots} | ${r.missingSecrets.join(', ') || '—'} |`)
  }
  const failing = results.filter(r => r.status === 'live' && r.verdict !== 'ok')
  lines.push(``, `Live sources not verified: ${failing.length ? failing.map(f => `\`${f.key}\``).join(', ') : 'none'}.`)
  return lines.join('\n') + '\n'
}

async function main() {
  const args = process.argv.slice(2)
  const get = (f: string) => { const a = args.find(x => x.startsWith(`--${f}=`)); return a ? a.split('=')[1] : undefined }
  const tier = get('tier'); const status = get('status')
  const sources = SOURCE_REGISTRY.filter(s => (!tier || String(s.tier) === tier) && (!status || s.status === status))
  const results = await verify(sources, m => console.error(m))
  const mdIdx = args.indexOf('--markdown')
  if (args.includes('--json')) console.log(JSON.stringify(results, null, 2))
  else console.log(toMarkdown(results))
  if (mdIdx >= 0 && args[mdIdx + 1]) writeFileSync(args[mdIdx + 1], toMarkdown(results))
  process.exit(results.some(r => r.status === 'live' && r.verdict !== 'ok') ? 1 : 0)
}

if (process.argv[1]?.endsWith('verify-sources.ts')) main().catch(e => { console.error(e); process.exit(1) })
