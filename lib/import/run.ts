/**
 * Runs an importer to completion (or to --limit) with cursor tracking. Shared by CLI wrappers in
 * scripts/import/*.ts, workers/import-*.ts, and the admin route.
 */
import type { Db } from '@/lib/db/types'
import { getCursor, setCursor, type BatchResult } from './pipeline'
import type { BatchImporter, ImportOptions } from './types'
import { dryDb } from './dry'

export interface RunSummary extends BatchResult { batches: number; source: string; dry: boolean; durationMs: number }

export interface RunOptions extends ImportOptions {
  batchSize?: number
  /** Explicit start offset (overrides the cursor). */
  offset?: number
  /** Start from the stored cursor (default) or from 0. */
  resume?: boolean
  /** Max batches per invocation (serverless callers). */
  maxBatches?: number
}

export async function runImporter(realDb: Db, source: string, importBatch: BatchImporter, opts: RunOptions = {}): Promise<RunSummary> {
  const db = opts.dry ? dryDb(realDb) : realDb
  const log = opts.log ?? ((m: string) => console.log(`[${source}] ${m}`))
  const started = Date.now()
  const batchSize = opts.batchSize ?? 500
  const cursor = await getCursor(db, source)
  let offset = opts.offset ?? (opts.resume === false ? 0 : cursor.cursor_offset)
  const total: RunSummary = { documents: 0, entitiesCreated: 0, edges: 0, nextOffset: offset, done: false, seen: 0, errors: 0, batches: 0, source, dry: !!opts.dry, durationMs: 0 }
  if (!opts.dry) await setCursor(db, source, offset, 'running')
  log(`starting at offset ${offset} (dry=${!!opts.dry}, limit=${opts.limit ?? '∞'})`)
  try {
    for (;;) {
      const remaining = opts.limit != null ? opts.limit - total.seen : Infinity
      if (remaining <= 0) break
      const size = Math.min(batchSize, remaining)
      const r = await importBatch(db, offset, size, opts)
      total.batches++
      total.documents += r.documents; total.entitiesCreated += r.entitiesCreated; total.edges += r.edges; total.seen += r.seen; total.errors += r.errors
      offset = r.nextOffset
      total.nextOffset = offset
      log(`batch ${total.batches}: seen=${r.seen} docs=${r.documents} edges=${r.edges} entities=${r.entitiesCreated} next=${offset} done=${r.done}`)
      if (!opts.dry) await setCursor(db, source, offset, r.done ? 'complete' : 'running', { last_batch: r })
      if (r.done) { total.done = true; break }
      if (opts.maxBatches && total.batches >= opts.maxBatches) break
    }
  } catch (e) {
    if (!opts.dry) await setCursor(db, source, offset, 'error', { error: (e as Error).message })
    throw e
  }
  total.durationMs = Date.now() - started
  log(`finished: seen=${total.seen} docs=${total.documents} edges=${total.edges} entities=${total.entitiesCreated} errors=${total.errors} done=${total.done} in ${total.durationMs}ms`)
  return total
}

/** Parse the common CLI flags: --dry --limit=N --offset=N --batch=N --key=value */
export function parseCliArgs(argv = process.argv.slice(2)): RunOptions & { params: Record<string, string> } {
  const out: RunOptions & { params: Record<string, string> } = { params: {} }
  for (const a of argv) {
    if (a === '--dry') out.dry = true
    else if (a === '--restart') out.resume = false
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8))
    else if (a.startsWith('--batch=')) out.batchSize = Number(a.slice(8))
    else if (a.startsWith('--offset=')) { out.offset = Number(a.slice(9)); out.resume = false }
    else if (a.startsWith('--max-batches=')) out.maxBatches = Number(a.slice(14))
    else if (a.startsWith('--') && a.includes('=')) { const i = a.indexOf('='); out.params[a.slice(2, i)] = a.slice(i + 1) }
  }
  return out
}
