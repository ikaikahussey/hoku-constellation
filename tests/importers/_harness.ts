/**
 * Shared harness for importer fixture tests: feeds fixture pages through `pageSource`, runs the importer
 * through runImporter against PGlite, and asserts the D1 idempotency contract:
 *   - first run inserts N documents and ≥ N edges
 *   - second run inserts 0 documents and 0 edges (checksum + edge_dedup_idx)
 *   - cursor advances to N and ends 'complete'
 */
import { expect } from 'vitest'
import type { Db } from '@/lib/db/types'
import { runImporter } from '@/lib/import/run'
import { getCursor } from '@/lib/import/pipeline'
import type { SourceModule, PageFetcher } from '@/lib/import/types'

export function fixturePages<T>(records: T[]): PageFetcher<T> {
  return async (offset, limit) => {
    const slice = records.slice(offset, offset + limit)
    return { records: slice, total: records.length, done: offset + slice.length >= records.length }
  }
}

export async function runTwice(db: Db, mod: SourceModule, records: unknown[], params: Record<string, string> = {}, expectDocs = records.length) {
  const pageSource = fixturePages(records)
  const first = await runImporter(db, mod.SOURCE_KEY, mod.importBatch, { pageSource, params, batchSize: 2, resume: false, log: () => {} })
  expect(first.errors).toBe(0)
  expect(first.documents).toBe(expectDocs)
  expect(first.done).toBe(true)
  const cursor = await getCursor(db, mod.SOURCE_KEY)
  expect(cursor.cursor_offset).toBe(records.length)
  expect(cursor.status).toBe('complete')

  const second = await runImporter(db, mod.SOURCE_KEY, mod.importBatch, { pageSource, params, batchSize: 2, resume: false, log: () => {} })
  expect(second.documents).toBe(0)
  expect(second.edges).toBe(0)
  expect(second.entitiesCreated).toBe(0)
  return first
}

export async function edgesFor(db: Db, source: string) {
  return db.many<{ type: string; role: string | null; amount: string | null; match_status: string; from_id: string | null; to_id: string | null; from_name_raw: string | null; to_name_raw: string | null; start_date: string | null; end_date: string | null; attributes: Record<string, unknown> }>(
    `select e.type, e.role, e.amount::text amount, e.match_status, e.from_id, e.to_id, e.from_name_raw, e.to_name_raw, e.start_date::text start_date, e.end_date::text end_date, e.attributes
       from edge e join document d on d.id = e.document_id where d.source = $1 order by d.source_record_id, e.type, e.from_name_raw`, [source])
}

export async function dryRunLeavesNothing(db: Db, mod: SourceModule, records: unknown[], params: Record<string, string> = {}) {
  const before = await db.one<{ n: string }>(`select count(*)::text n from document where source = $1`, [mod.SOURCE_KEY])
  const r = await runImporter(db, mod.SOURCE_KEY, mod.importBatch, { pageSource: fixturePages(records), params, dry: true, resume: false, log: () => {} })
  const after = await db.one<{ n: string }>(`select count(*)::text n from document where source = $1`, [mod.SOURCE_KEY])
  expect(after!.n).toBe(before!.n)
  expect(r.dry).toBe(true)
  return r
}
