/**
 * Serverless scheduling for importers (Vercel Cron instead of launchd): decides which live sources are
 * due, given each source's cadence and its import_cursor row.
 *
 *   - a source that has never run, or whose last run did not finish (`status <> 'complete'`), is due
 *   - a completed source is due again once its cadence has elapsed since last_run_at
 *   - a source another invocation is working on (status 'running', touched in the last RUNNING_GRACE_MS)
 *     is skipped so overlapping cron ticks do not double-fetch
 */
import type { Db } from '@/lib/db/types'
import { SOURCE_REGISTRY, type Cadence, type SourceDefinition } from './source-registry'

export const CADENCE_MS: Record<Cadence, number | null> = {
  hourly: 60 * 60_000,
  daily: 24 * 60 * 60_000,
  weekly: 7 * 24 * 60 * 60_000,
  monthly: 30 * 24 * 60 * 60_000,
  quarterly: 91 * 24 * 60 * 60_000,
  annual: 365 * 24 * 60 * 60_000,
  on_demand: null,
}

export const RUNNING_GRACE_MS = 6 * 60_000

export interface CursorState { source: string; cursor_offset: number; status: string | null; last_run_at: string | null }

export function isDue(def: SourceDefinition, cursor: CursorState | undefined, now = Date.now()): boolean {
  if (def.status !== 'live') return false
  const interval = CADENCE_MS[def.cadence]
  if (interval === null) return false
  if (!cursor || !cursor.last_run_at) return true
  const last = new Date(cursor.last_run_at).getTime()
  if (cursor.status === 'running' && now - last < RUNNING_GRACE_MS) return false // another tick owns it
  if (cursor.status !== 'complete') return true                                 // resume unfinished work
  return now - last >= interval
}

/** Live sources that are due now, in registry order (Tier 1 first), restricted to `keys` when given. */
export async function selectDueSources(db: Db, opts: { keys?: string[]; live?: string[]; now?: number } = {}): Promise<SourceDefinition[]> {
  const now = opts.now ?? Date.now()
  const cursors = await db.many<CursorState>(`select source, cursor_offset, status, last_run_at::text last_run_at from import_cursor`)
  const byKey = new Map(cursors.map(c => [c.source, c]))
  return SOURCE_REGISTRY
    .filter(s => (opts.live ? opts.live.includes(s.key) : true))
    .filter(s => (opts.keys ? opts.keys.includes(s.key) : true))
    .filter(s => isDue(s, byKey.get(s.key), now))
}
