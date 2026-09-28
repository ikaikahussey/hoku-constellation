/**
 * GET|POST /api/cron/ingest[?source=key][&budget=seconds]   (Bearer CRON_SECRET)
 *
 * Serverless replacement for the Mac mini workers: runs due importers (lib/import/schedule.ts) inside
 * a time budget, saving the cursor after every batch so the next tick resumes where this one stopped.
 * Scheduled every 15 minutes in vercel.json; a full backfill of a large source therefore proceeds as a
 * chain of ticks, and finished sources are refreshed on their registry cadence.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { authenticateCron } from '@/app/api/analytics/_lib/auth'
import { runImporter } from '@/lib/import/run'
import { loadImporter, LIVE_SOURCE_KEYS } from '@/lib/import/sources'
import { selectDueSources } from '@/lib/import/schedule'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const DEFAULT_BUDGET_S = 240
const PER_SOURCE_MIN_S = 45

async function handle(request: NextRequest) {
  const unauth = authenticateCron(request)
  if (unauth) return unauth
  const started = Date.now()
  const sp = request.nextUrl.searchParams
  const budgetS = Math.min(Number(sp.get('budget') ?? DEFAULT_BUDGET_S), maxDuration - 20)
  const deadline = started + budgetS * 1000
  const db = await getServiceDb()
  const only = sp.get('source')?.split(',').filter(Boolean)
  const due = await selectDueSources(db, { keys: only, live: LIVE_SOURCE_KEYS })
  const results: Array<Record<string, unknown>> = []
  for (const def of due) {
    const remaining = deadline - Date.now()
    if (remaining < PER_SOURCE_MIN_S * 1000 && results.length) break
    // Share the remaining budget across the sources still due, but give each at least a minimal slice.
    const slice = Math.max(PER_SOURCE_MIN_S * 1000, Math.floor(remaining / (due.length - results.length)))
    const logs: string[] = []
    try {
      const mod = await loadImporter(def.key)
      const summary = await runImporter(db, def.key, mod.importBatch, {
        batchSize: 500, deadlineMs: Math.min(deadline, Date.now() + slice), log: m => { if (logs.length < 20) logs.push(m) },
      })
      results.push({ source: def.key, ok: true, documents: summary.documents, edges: summary.edges, entitiesCreated: summary.entitiesCreated, errors: summary.errors, nextOffset: summary.nextOffset, done: summary.done, batches: summary.batches })
    } catch (e) {
      results.push({ source: def.key, ok: false, error: (e as Error).message, logs })
    }
    if (Date.now() >= deadline) break
  }
  return NextResponse.json({ ok: true, due: due.map(d => d.key), ran: results, durationMs: Date.now() - started })
}

export const GET = handle
export const POST = handle
