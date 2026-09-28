/**
 * Single HTTP entry point for every importer.
 *   - User-Agent: HokuInsiderBot/1.0 (+<NEXT_PUBLIC_SITE_URL>)
 *   - per-host rate limit (default 1 req/s; overridable per host)
 *   - exponential backoff on 429 and 5xx (respects Retry-After)
 *   - robots.txt check per host (cached), never bypassed
 *   - dev cache in .cache/ingest/ keyed by sha256(method+url+body) when HOKU_INGEST_CACHE=1 or NODE_ENV!=='production'
 */
import { createHash } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Env values are trimmed: a trailing newline in a dashboard-pasted value makes the header invalid. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://constellation.hoku.fm').trim()
export const USER_AGENT = `HokuInsiderBot/1.0 (+${SITE_URL})`

export interface FetchOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string | URLSearchParams
  /** Override per-host minimum interval in ms (default 1000). */
  minIntervalMs?: number
  /** Max attempts including the first (default 4). */
  retries?: number
  /** Skip the dev cache for this call. */
  noCache?: boolean
  /** Accept binary (returns Buffer via .buffer()). */
  timeoutMs?: number
}

export interface HttpResponse {
  status: number
  ok: boolean
  headers: Record<string, string>
  url: string
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
  buffer(): Promise<Buffer>
}

export class HttpError extends Error {
  constructor(public status: number, public url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`)
  }
}

export class RobotsDisallowedError extends Error {
  constructor(public url: string) { super(`robots.txt disallows ${url}`) }
}

const CACHE_DIR = join(process.cwd(), '.cache', 'ingest')
const HOST_INTERVALS: Record<string, number> = {
  'data.sec.gov': 120,           // SEC permits 10 req/s
  'www.sec.gov': 120,
  'api.usaspending.gov': 500,
  'api.open.fec.gov': 1000,
  'opendata.hawaii.gov': 500,
}

const lastRequestAt = new Map<string, number>()
const robotsCache = new Map<string, RobotsRules>()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export function cacheEnabled(): boolean {
  if (process.env.HOKU_INGEST_CACHE === '0') return false
  return process.env.HOKU_INGEST_CACHE === '1' || process.env.NODE_ENV !== 'production'
}

function cacheKey(method: string, url: string, body?: string): string {
  return createHash('sha256').update(`${method} ${url}\n${body ?? ''}`).digest('hex')
}

interface CachedEntry { status: number; headers: Record<string, string>; url: string; bodyBase64: string }

async function throttle(host: string, minInterval: number) {
  const last = lastRequestAt.get(host) ?? 0
  const wait = last + minInterval - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt.set(host, Date.now())
}

// ---------------------------------------------------------------- robots.txt

export interface RobotsRules { allow: string[]; disallow: string[]; crawlDelay?: number }

export function parseRobots(text: string, agent = 'hokuinsiderbot'): RobotsRules {
  const groups: Array<{ agents: string[]; allow: string[]; disallow: string[]; crawlDelay?: number }> = []
  let current: (typeof groups)[number] | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (key === 'user-agent') {
      if (!current || current.allow.length || current.disallow.length || current.crawlDelay !== undefined) {
        current = { agents: [], allow: [], disallow: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
    } else if (current) {
      if (key === 'allow') current.allow.push(value)
      else if (key === 'disallow') current.disallow.push(value)
      else if (key === 'crawl-delay') current.crawlDelay = Number(value) || undefined
    }
  }
  const specific = groups.find(g => g.agents.some(a => a === agent || (a !== '*' && agent.includes(a))))
  const star = groups.find(g => g.agents.includes('*'))
  const g = specific ?? star
  return g ? { allow: g.allow, disallow: g.disallow, crawlDelay: g.crawlDelay } : { allow: [], disallow: [] }
}

function ruleMatches(rule: string, path: string): boolean {
  if (!rule) return false
  const re = new RegExp('^' + rule.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$'))
  return re.test(path)
}

export function isAllowed(rules: RobotsRules, path: string): boolean {
  let best: { allow: boolean; len: number } | null = null
  for (const r of rules.allow) if (ruleMatches(r, path) && (!best || r.length > best.len)) best = { allow: true, len: r.length }
  for (const r of rules.disallow) if (ruleMatches(r, path) && (!best || r.length > best.len)) best = { allow: false, len: r.length }
  return best ? best.allow : true
}

export async function robotsFor(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin)
  if (cached) return cached
  let rules: RobotsRules = { allow: [], disallow: [] }
  try {
    const res = await rawFetch(`${origin}/robots.txt`, { method: 'GET' }, 10_000)
    if (res.ok) rules = parseRobots(await res.text())
  } catch { /* unreachable robots.txt → treat as allow-all */ }
  robotsCache.set(origin, rules)
  return rules
}

/** Test hook. */
export function _setRobotsForTests(origin: string, rules: RobotsRules | null) {
  if (rules) robotsCache.set(origin, rules); else robotsCache.delete(origin)
}

// ---------------------------------------------------------------- fetch

async function rawFetch(url: string, init: { method: string; headers?: Record<string, string>; body?: string | URLSearchParams }, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, headers: { 'user-agent': USER_AGENT, accept: 'application/json, text/html;q=0.9, */*;q=0.8', ...(init.headers ?? {}) }, signal: ctrl.signal, redirect: 'follow' })
  } finally {
    clearTimeout(t)
  }
}

function wrap(status: number, headers: Record<string, string>, url: string, body: Buffer): HttpResponse {
  return {
    status, ok: status >= 200 && status < 300, headers, url,
    async text() { return body.toString('utf8') },
    async json<T>() { return JSON.parse(body.toString('utf8')) as T },
    async buffer() { return body },
  }
}

/**
 * Fetch through the shared pipeline. Throws HttpError after retries are exhausted on 429/5xx, and
 * RobotsDisallowedError when robots.txt forbids the path. 4xx other than 429 are returned (ok=false).
 */
export async function httpFetch(url: string, opts: FetchOptions = {}): Promise<HttpResponse> {
  const method = opts.method ?? 'GET'
  const u = new URL(url)
  const bodyStr = opts.body instanceof URLSearchParams ? opts.body.toString() : opts.body
  const key = cacheKey(method, url, bodyStr)
  const useCache = cacheEnabled() && !opts.noCache
  if (useCache) {
    const file = join(CACHE_DIR, `${key}.json`)
    if (existsSync(file)) {
      const c = JSON.parse(readFileSync(file, 'utf8')) as CachedEntry
      return wrap(c.status, c.headers, c.url, Buffer.from(c.bodyBase64, 'base64'))
    }
  }

  if (!u.pathname.endsWith('/robots.txt')) {
    const rules = await robotsFor(u.origin)
    if (!isAllowed(rules, u.pathname + u.search)) throw new RobotsDisallowedError(url)
    if (rules.crawlDelay && rules.crawlDelay * 1000 > (opts.minIntervalMs ?? HOST_INTERVALS[u.host] ?? 1000)) {
      HOST_INTERVALS[u.host] = rules.crawlDelay * 1000
    }
  }

  const minInterval = opts.minIntervalMs ?? HOST_INTERVALS[u.host] ?? 1000
  const retries = opts.retries ?? 4
  let attempt = 0
  for (;;) {
    attempt++
    await throttle(u.host, minInterval)
    let res: Response
    try {
      res = await rawFetch(url, { method, headers: opts.headers, body: bodyStr }, opts.timeoutMs ?? 30_000)
    } catch (e) {
      if (attempt >= retries) throw e
      await sleep(Math.min(30_000, 1000 * 2 ** attempt))
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries) throw new HttpError(res.status, url)
      const ra = Number(res.headers.get('retry-after'))
      await sleep(ra ? ra * 1000 : Math.min(60_000, 1000 * 2 ** attempt))
      continue
    }
    const body = Buffer.from(await res.arrayBuffer())
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => { headers[k] = v })
    if (useCache && res.ok) {
      mkdirSync(CACHE_DIR, { recursive: true })
      const entry: CachedEntry = { status: res.status, headers, url: res.url, bodyBase64: body.toString('base64') }
      writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify(entry))
    }
    return wrap(res.status, headers, res.url || url, body)
  }
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await httpFetch(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers ?? {}) } })
  if (!res.ok) throw new HttpError(res.status, url)
  return res.json<T>()
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await httpFetch(url, opts)
  if (!res.ok) throw new HttpError(res.status, url)
  return res.text()
}

export async function fetchBuffer(url: string, opts: FetchOptions = {}): Promise<Buffer> {
  const res = await httpFetch(url, { ...opts, headers: { accept: '*/*', ...(opts.headers ?? {}) } })
  if (!res.ok) throw new HttpError(res.status, url)
  return res.buffer()
}
