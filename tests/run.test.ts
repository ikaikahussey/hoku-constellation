import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import { runImporter } from '@/lib/import/run'
import { emptyResult, setCursor } from '@/lib/import/pipeline'
import type { BatchImporter } from '@/lib/import/types'

let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

/** A three-record source that records the offsets it was asked for. */
function source(calls: number[]): BatchImporter {
  return async (_db, offset, size) => {
    calls.push(offset)
    const n = Math.max(0, Math.min(size, 3 - offset))
    return { ...emptyResult(offset), seen: n, nextOffset: offset + n, done: offset + n >= 3 }
  }
}

describe('runImporter cursor start', () => {
  it('resumes a completed cursor at its end by default (append-style sources)', async () => {
    await setCursor(db, 'append_src', 3, 'complete')
    const calls: number[] = []
    const r = await runImporter(db, 'append_src', source(calls), { log: () => {} })
    expect(calls).toEqual([3])
    expect(r.seen).toBe(0)
  })
  it('restarts a completed cursor at 0 with restartIfComplete (snapshot sources)', async () => {
    await setCursor(db, 'snapshot_src', 3, 'complete')
    const calls: number[] = []
    const r = await runImporter(db, 'snapshot_src', source(calls), { restartIfComplete: true, batchSize: 2, log: () => {} })
    expect(calls).toEqual([0, 2])
    expect(r.seen).toBe(3)
  })
  it('still resumes an unfinished cursor with restartIfComplete', async () => {
    await setCursor(db, 'partial_src', 2, 'running')
    const calls: number[] = []
    await runImporter(db, 'partial_src', source(calls), { restartIfComplete: true, log: () => {} })
    expect(calls).toEqual([2])
  })
})
