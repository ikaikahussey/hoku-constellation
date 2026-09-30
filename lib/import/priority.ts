/**
 * Priority entities: staff-flagged people and organizations (`entity.attributes.is_priority`) whose
 * records are collected ahead of the regular sweeps.
 *
 * The regular importers walk whole datasets by offset, so a given person's records arrive whenever the
 * sweep reaches them. The priority pass instead asks each name-searchable source for the entity's
 * names directly:
 *   - csc: CKAN datastore full-text search (q = surname) on every Campaign Spending Commission resource
 *   - fec: OpenFEC Schedule A by contributor_name (all committees, not only Hawaiʻi committees)
 * Records are written through the same per-record functions as the sweeps (identical source_record_ids),
 * so the pass is idempotent and the later sweep inserts nothing twice. Only rows whose name matches one
 * of the entity's names or aliases are kept; matching to the entity itself still goes through
 * resolveRef, so an ambiguous name lands in match review instead of being linked automatically.
 */
import type { Db } from '@/lib/db/types'
import { canonicalPersonName, normalize, normalizeOrg } from '@/lib/entity-match'
import { fetchJson } from './http'
import { CkanClient, HAWAII_OPEN_DATA } from './clients/ckan'
import { emptyResult, getCursor, setCursor, type BatchResult } from './pipeline'
import { discoverResources, parseCscRecord, processCscRecord, type CscResource } from './sources/csc'
import { FEC_BASE, fecKey, parseScheduleA, processScheduleA, type ScheduleA } from './sources/fec'

export const PRIORITY_SOURCE_KEY = 'priority'
export const PRIORITY_SOURCES = ['csc', 'fec'] as const
export type PrioritySource = (typeof PRIORITY_SOURCES)[number]

/** Hours between automatic priority passes (ingest cron / worker). */
export const PRIORITY_CADENCE_HOURS = 24

export interface PriorityTarget { id: string; kind: 'person' | 'org'; name: string; aliases: string[] }

export async function listPriorityTargets(db: Db): Promise<PriorityTarget[]> {
  return db.many<PriorityTarget>(
    `select id, kind, name, aliases from entity
      where merged_into_id is null and kind in ('person','org') and coalesce((attributes ->> 'is_priority')::boolean, false)
      order by name`)
}

/** Every normalized name a target is known by (name plus aliases; "Last, First" folded). */
export function targetNames(t: Pick<PriorityTarget, 'kind' | 'name' | 'aliases'>): string[] {
  const norm = t.kind === 'org' ? normalizeOrg : normalize
  const out = new Set<string>()
  for (const n of [t.name, ...(t.aliases ?? [])]) {
    const v = norm(t.kind === 'person' ? canonicalPersonName(n) : n)
    if (v) out.add(v)
  }
  return [...out]
}

const tokens = (s: string) => s.split(' ').filter(Boolean)

/**
 * True when a raw source name refers to the target by one of its known names. Persons match on
 * first and last token (middle names and initials are ignored: "WINER, ANDREW K" ≈ "Andrew Winer");
 * organizations match on the suffix-insensitive normalized name. Nicknames are not guessed: add them
 * as aliases.
 */
export function matchesTarget(rawName: string | null | undefined, t: Pick<PriorityTarget, 'kind' | 'name' | 'aliases'>): boolean {
  if (!rawName) return false
  if (t.kind === 'org') return targetNames(t).includes(normalizeOrg(rawName))
  const raw = tokens(normalize(canonicalPersonName(rawName)).replace(/\b(jr|sr|ii|iii|iv|mr|mrs|ms|dr|esq)\b/g, ' '))
  if (raw.length < 2) return false
  return targetNames(t).some(n => {
    const k = tokens(n)
    return k.length >= 2 && k[0] === raw[0] && k[k.length - 1] === raw[raw.length - 1]
  })
}

/** Query strings to send to the sources: surnames for persons (full-text), full names for FEC. */
export function searchTerms(t: PriorityTarget): { surnames: string[]; fullNames: string[] } {
  const names = targetNames(t)
  if (t.kind === 'org') return { surnames: names, fullNames: names }
  const surnames = new Set(names.map(n => tokens(n).at(-1)!).filter(s => s.length >= 3))
  // OpenFEC contributor_name is a full-text match on "LAST, FIRST".
  const fullNames = new Set(names.map(n => { const k = tokens(n); return `${k.at(-1)}, ${k[0]}` }))
  return { surnames: [...surnames], fullNames: [...fullNames] }
}

/** Network seams, replaced by fixtures in tests. */
export interface PriorityFetchers {
  cscResources?: (log: (m: string) => void) => Promise<CscResource[]>
  cscSearch?: (resourceId: string, q: string, offset: number, limit: number) => Promise<{ records: Record<string, unknown>[]; total: number }>
  fecSearch?: (contributorName: string, state: string | null, cursor: { last_index: string; last_date: string } | null) => Promise<{ results: ScheduleA[]; next: { last_index: string; last_date: string } | null }>
}

const defaultFetchers = (): Required<PriorityFetchers> => {
  const ckan = new CkanClient(HAWAII_OPEN_DATA)
  return {
    cscResources: log => discoverResources(ckan, log),
    cscSearch: async (id, q, offset, limit) => {
      const r = await ckan.datastoreSearch(id, { q, offset, limit, sort: '_id asc' })
      return { records: r.records, total: r.total }
    },
    fecSearch: async (name, state, cursor) => {
      let url = `${FEC_BASE}/schedules/schedule_a/?contributor_name=${encodeURIComponent(name)}&sort=-contribution_receipt_date&per_page=100&api_key=${fecKey()}`
      if (state) url += `&contributor_state=${state}`
      if (cursor) url += `&last_index=${cursor.last_index}&last_contribution_receipt_date=${cursor.last_date}`
      const json = await fetchJson<{ results: ScheduleA[]; pagination: { last_indexes?: { last_index?: string; last_contribution_receipt_date?: string } | null } }>(url)
      const li = json.pagination?.last_indexes
      return { results: json.results, next: li?.last_index && li.last_contribution_receipt_date && json.results.length === 100 ? { last_index: li.last_index, last_date: li.last_contribution_receipt_date } : null }
    },
  }
}

export interface PriorityOptions {
  targets?: PriorityTarget[]
  sources?: PrioritySource[]
  /** FEC contributor_state filter (default HI; pass null for all states). */
  fecState?: string | null
  /** Page cap per query, to bound one pass. */
  maxPages?: number
  deadlineMs?: number
  fetchers?: PriorityFetchers
  log?: (m: string) => void
}

export interface PriorityTargetResult { entityId: string; name: string; source: PrioritySource; matched: number; documents: number; edges: number; entitiesCreated: number; errors: number }
export interface PrioritySummary extends BatchResult { targets: number; perTarget: PriorityTargetResult[] }

export async function importPriorityTargets(db: Db, opts: PriorityOptions = {}): Promise<PrioritySummary> {
  const log = opts.log ?? (() => {})
  const f = { ...defaultFetchers(), ...(opts.fetchers ?? {}) }
  const targets = opts.targets ?? await listPriorityTargets(db)
  const sources = opts.sources ?? [...PRIORITY_SOURCES]
  const maxPages = opts.maxPages ?? 20
  const fecState = opts.fecState === undefined ? 'HI' : opts.fecState
  const total: PrioritySummary = { ...emptyResult(0), targets: targets.length, perTarget: [] }
  const late = () => opts.deadlineMs != null && Date.now() >= opts.deadlineMs
  let cscResources: CscResource[] | null = null

  for (const t of targets) {
    const terms = searchTerms(t)
    for (const source of sources) {
      if (late()) { log('time budget reached'); return total }
      const r = emptyResult(0)
      let matched = 0
      // Overlapping queries (several surnames or name forms) return the same rows; handle each once.
      const handled = new Set<string>()
      try {
        if (source === 'csc') {
          cscResources ??= await f.cscResources(log)
          for (const res of cscResources) {
            for (const q of terms.surnames) {
              for (let page = 0, offset = 0; page < maxPages && !late(); page++) {
                const { records, total: n } = await f.cscSearch(res.id, q, offset, 100)
                for (const raw of records) {
                  const parsed = parseCscRecord(res.kind, raw)
                  // processRecord counts the rows it writes; count skipped rows here.
                  if (!parsed || !(matchesTarget(parsed.fromName, t) || matchesTarget(parsed.toName, t)) || handled.has(`${res.id}:${parsed.recordId}`)) { r.seen++; continue }
                  handled.add(`${res.id}:${parsed.recordId}`)
                  matched++
                  await processCscRecord(db, res.kind, res.id, parsed, raw, r, log)
                }
                offset += records.length
                if (records.length < 100 || offset >= n) break
              }
            }
          }
        } else {
          for (const name of terms.fullNames) {
            let cursor: { last_index: string; last_date: string } | null = null
            for (let page = 0; page < maxPages && !late(); page++) {
              const { results, next } = await f.fecSearch(name, fecState, cursor)
              for (const raw of results) {
                const p = parseScheduleA(raw)
                if (!p || p.donorIsOrg !== (t.kind === 'org') || !matchesTarget(p.donor, t) || handled.has(p.recordId)) { r.seen++; continue }
                handled.add(p.recordId)
                matched++
                await processScheduleA(db, p, raw, r, log)
              }
              if (!next) break
              cursor = next
            }
          }
        }
      } catch (e) {
        r.errors++
        log(`${t.name} / ${source}: ${(e as Error).message}`)
      }
      total.perTarget.push({ entityId: t.id, name: t.name, source, matched, documents: r.documents, edges: r.edges, entitiesCreated: r.entitiesCreated, errors: r.errors })
      total.documents += r.documents; total.edges += r.edges; total.entitiesCreated += r.entitiesCreated; total.seen += r.seen; total.errors += r.errors
      log(`${t.name} / ${source}: matched=${matched} docs=${r.documents} edges=${r.edges} errors=${r.errors}`)
    }
  }
  total.done = true
  return total
}

/**
 * Run the priority pass when the last one is older than PRIORITY_CADENCE_HOURS (or `force`).
 * Tracked in import_cursor under source 'priority'. Returns null when not due or nothing is flagged.
 */
export async function runPriorityPassIfDue(db: Db, opts: PriorityOptions & { now?: Date; force?: boolean } = {}): Promise<PrioritySummary | null> {
  const now = opts.now ?? new Date()
  const cursor = await getCursor(db, PRIORITY_SOURCE_KEY)
  const last = cursor.last_run_at ? new Date(cursor.last_run_at).getTime() : 0
  if (!opts.force && cursor.status === 'complete' && now.getTime() - last < PRIORITY_CADENCE_HOURS * 3600e3) return null
  const targets = opts.targets ?? await listPriorityTargets(db)
  if (!targets.length) return null
  await setCursor(db, PRIORITY_SOURCE_KEY, 0, 'running')
  try {
    const summary = await importPriorityTargets(db, { ...opts, targets })
    const finished = !opts.deadlineMs || Date.now() < opts.deadlineMs
    await setCursor(db, PRIORITY_SOURCE_KEY, 0, finished ? 'complete' : 'idle', { last_pass: { targets: summary.targets, documents: summary.documents, edges: summary.edges, errors: summary.errors } })
    return summary
  } catch (e) {
    await setCursor(db, PRIORITY_SOURCE_KEY, 0, 'error', { error: (e as Error).message })
    throw e
  }
}
