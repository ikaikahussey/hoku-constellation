/**
 * Source probe: checks that importer and news-feed URLs are reachable and crawlable from production,
 * and records enough of each response to repair a broken source (status, final URL, content type,
 * a text snippet, feed/sitemap links found on HTML pages, and the host's robots.txt rules).
 *
 * Runs from /api/cron/probe; results are merged into import_cursor.metadata.probe for each source key,
 * so they can be read with a plain SQL query. Uses lib/import/http.ts (identifying UA, rate limit,
 * robots.txt honored: a disallowed URL is reported, never fetched).
 */
import { load } from 'cheerio'
import type { Db } from '@/lib/db/types'
import { httpFetch, robotsFor, isAllowed, type RobotsRules } from './http'
import { SOURCE_REGISTRY } from './source-registry'

export interface ProbeResult {
  url: string
  robots: 'allowed' | 'disallowed' | 'unknown'
  status: number | null
  finalUrl: string | null
  contentType: string | null
  bytes: number | null
  ms: number
  /** 'rss' | 'atom' | 'html' | 'json' | 'other' — sniffed from the body. */
  kind: string | null
  /** RSS/Atom item count when kind is a feed. */
  items: number | null
  snippet: string | null
  /** Feed, sitemap, and same-site links found on an HTML page (max 40). */
  links: string[]
  error: string | null
}

export interface ProbeTarget { source: string; urls: string[] }

/** Extra URLs worth checking when repairing sources that are currently failing. */
const CANDIDATES: Record<string, string[]> = {
  boards: [
    'https://boards.hawaii.gov/boards-directory/',
    'https://boards.hawaii.gov/sitemap.xml',
    'https://boards.hawaii.gov/wp-json/wp/v2/types',
  ],
  puc: [
    'https://dms.puc.hawaii.gov/dms/',
    'http://dms.puc.hawaii.gov/dms/',
    'https://puc.hawaii.gov/dockets/',
    'https://puc.hawaii.gov/sitemap.xml',
  ],
  ethics_lobbyists: [
    'https://opendata.hawaii.gov/dataset/hawaii-state-ethics-commission-s-lobbyist-registration-statements',
    'https://opendata.hawaii.gov/dataset/hawaii-state-ethics-commission-s-lobbyists-expenditure-statements',
    'https://ethics.hawaii.gov/lobbying-e-filing/',
  ],
  csc: [
    'https://hicscdata.hawaii.gov/',
    'https://hicscdata.hawaii.gov/browse?limit=50',
    'https://hicscdata.hawaii.gov/api/catalog/v1?domains=hicscdata.hawaii.gov&limit=50',
    'https://opendata.hawaii.gov/dataset/?q=campaign+spending',
  ],
  fec: [
    'https://www.fec.gov/data/browse-data/?tab=bulk-data',
  ],
  capitol_measures: [
    'https://data.capitol.hawaii.gov/sessions/session2026/bills/HB1_.HTM',
    'https://data.capitol.hawaii.gov/sessions/session2026/bills/HB1_.htm',
    'https://data.capitol.hawaii.gov/sessions/session2026/bills/HB1_.PDF',
    'https://data.capitol.hawaii.gov/sessions/session2026/Testimony/',
    'https://data.capitol.hawaii.gov/rss.aspx',
  ],
  news: [
    'https://www.lahainanews.com/',
    'https://themolokaidispatch.com/',
    'https://themolokaidispatch.com/?feed=rss2',
  ],
}

/** Sources probed by default: the ones with repair candidates (currently failing, or the news feeds). */
export const DEFAULT_PROBE_SOURCES = Object.keys(CANDIDATES)

/** Every live source's registry URLs plus the repair candidates above, restricted to `only` when given. */
export function probeTargets(only?: string[]): ProbeTarget[] {
  const out = new Map<string, Set<string>>()
  const add = (source: string, urls: string[]) => {
    const set = out.get(source) ?? new Set<string>()
    for (const u of urls) set.add(u)
    out.set(source, set)
  }
  for (const s of SOURCE_REGISTRY) {
    if (s.status !== 'live') continue
    // News feeds report their own status in import_cursor.metadata.feeds; only candidates are probed for news.
    if (s.key !== 'news') add(s.key, [s.baseUrl, ...(s.urls ?? [])])
  }
  for (const [source, urls] of Object.entries(CANDIDATES)) add(source, urls)
  return [...out]
    .filter(([source]) => !only?.length || only.includes(source))
    .map(([source, urls]) => ({ source, urls: [...urls] }))
}

export function sniff(body: string, contentType: string | null): { kind: string; items: number | null } {
  const head = body.slice(0, 2000).toLowerCase()
  if (/<rss[\s>]/.test(head)) return { kind: 'rss', items: (body.match(/<item[\s>]/gi) ?? []).length }
  if (/<feed[\s>]/.test(head) && head.includes('atom')) return { kind: 'atom', items: (body.match(/<entry[\s>]/gi) ?? []).length }
  if (/<urlset|<sitemapindex/.test(head)) return { kind: 'sitemap', items: (body.match(/<loc>/gi) ?? []).length }
  if (/json/.test(contentType ?? '') || /^\s*[[{]/.test(body)) return { kind: 'json', items: null }
  if (/<html|<!doctype html/.test(head)) return { kind: 'html', items: null }
  return { kind: 'other', items: null }
}

/** <loc> entries of a sitemap or sitemap index. */
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].replace(/&amp;/g, '&'))
}

/** Feed, sitemap, and relevant links on an HTML page, then other same-host links (max 80). */
export function discoverLinks(html: string, base: string): string[] {
  const $ = load(html)
  const host = new URL(base).host
  const out = new Set<string>()
  $('link[type="application/rss+xml"], link[type="application/atom+xml"]').each((_, el) => {
    const href = $(el).attr('href')
    if (href) out.add(new URL(href, base).toString())
  })
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    let u: URL
    try { u = new URL(href, base) } catch { return }
    if (/rss|feed|atom|sitemap|board|commission|docket|lobby|bulk|download|\.csv|resource/i.test(u.pathname + u.search) && (u.host === host || /rss|feed/i.test(u.pathname))) out.add(u.toString())
  })
  const rest = new Set<string>()
  $('a[href]').each((_, el) => {
    try {
      const u = new URL($(el).attr('href') ?? '', base)
      u.hash = ''
      if (u.host === host && !out.has(u.toString())) rest.add(u.toString())
    } catch { /* ignore */ }
  })
  return [...out, ...rest].slice(0, 80)
}

function robotsSummary(rules: RobotsRules): string {
  return [...rules.disallow.map(d => `Disallow: ${d}`), ...rules.allow.map(a => `Allow: ${a}`), rules.crawlDelay ? `Crawl-delay: ${rules.crawlDelay}` : '']
    .filter(Boolean).slice(0, 30).join('\n')
}

export async function probeUrl(url: string): Promise<ProbeResult & { robotsRules: string }> {
  const started = Date.now()
  const empty = { status: null, finalUrl: null, contentType: null, bytes: null, kind: null, items: null, snippet: null, links: [] as string[] }
  let robots: ProbeResult['robots'] = 'unknown'
  let robotsRules = ''
  try {
    const u = new URL(url)
    const rules = await robotsFor(u.origin)
    robotsRules = robotsSummary(rules)
    robots = isAllowed(rules, u.pathname + u.search) ? 'allowed' : 'disallowed'
  } catch { /* unknown */ }
  if (robots === 'disallowed') return { url, robots, robotsRules, ...empty, ms: Date.now() - started, error: 'robots.txt disallows' }
  try {
    const res = await httpFetch(url, { retries: 1, noCache: true, timeoutMs: 20_000, headers: { accept: 'application/rss+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5' } })
    const body = (await res.buffer()).toString('utf8')
    const contentType = res.headers['content-type'] ?? null
    const { kind, items } = sniff(body, contentType)
    const text = kind === 'html' ? load(body)('title').first().text().trim() + ' | ' + load(body)('body').text().replace(/\s+/g, ' ').trim() : body.replace(/\s+/g, ' ')
    return {
      url, robots, robotsRules, status: res.status, finalUrl: res.url, contentType, bytes: body.length, ms: Date.now() - started,
      kind, items, snippet: text.slice(0, kind === 'html' ? 300 : 1200),
      links: kind === 'html' ? discoverLinks(body, res.url || url) : kind === 'sitemap' ? sitemapLocs(body).slice(0, 250) : [],
      error: res.ok ? null : `HTTP ${res.status}`,
    }
  } catch (e) {
    return { url, robots, robotsRules, ...empty, ms: Date.now() - started, error: (e as Error).message.slice(0, 300) }
  }
}

/** Probe targets until the deadline; merge results into import_cursor.metadata.probe per source. */
export async function runProbe(db: Db, opts: { only?: string[]; deadlineMs?: number } = {}): Promise<{ probed: number; sources: number; skipped: number }> {
  let probed = 0, skipped = 0
  const targets = probeTargets(opts.only)
  for (const t of targets) {
    const results: Array<ProbeResult & { robotsRules: string }> = []
    for (const url of t.urls) {
      if (opts.deadlineMs && Date.now() >= opts.deadlineMs) { skipped++; continue }
      results.push(await probeUrl(url))
      probed++
    }
    if (!results.length) continue
    const probe = { at: new Date().toISOString(), results }
    await db.query(
      `insert into import_cursor(source, metadata) values ($1, jsonb_build_object('probe', $2::jsonb))
       on conflict (source) do update set metadata = coalesce(import_cursor.metadata, '{}'::jsonb) || jsonb_build_object('probe', $2::jsonb)`,
      [t.source, JSON.stringify(probe)])
  }
  return { probed, sources: targets.length, skipped }
}
