import { describe, it, expect } from 'vitest'
import { isDue, selectDueSources, RUNNING_GRACE_MS } from '@/lib/import/schedule'
import { getSource } from '@/lib/import/source-registry'
import { createTestDb } from './helpers/pglite'

const now = Date.parse('2026-09-28T12:00:00Z')
const iso = (msAgo: number) => new Date(now - msAgo).toISOString()

describe('importer scheduling', () => {
  it('never-run, unfinished, and cadence-elapsed sources are due; recently running and fresh ones are not', () => {
    const csc = getSource('csc') // daily, live
    expect(isDue(csc, undefined, now)).toBe(true)
    expect(isDue(csc, { source: 'csc', cursor_offset: 10, status: 'running', last_run_at: iso(60_000) }, now)).toBe(false)
    expect(isDue(csc, { source: 'csc', cursor_offset: 10, status: 'running', last_run_at: iso(RUNNING_GRACE_MS + 1) }, now)).toBe(true)
    expect(isDue(csc, { source: 'csc', cursor_offset: 10, status: 'error', last_run_at: iso(1000) }, now)).toBe(true)
    expect(isDue(csc, { source: 'csc', cursor_offset: 10, status: 'complete', last_run_at: iso(2 * 3600_000) }, now)).toBe(false)
    expect(isDue(csc, { source: 'csc', cursor_offset: 10, status: 'complete', last_run_at: iso(25 * 3600_000) }, now)).toBe(true)
    expect(isDue(getSource('elections'), undefined, now)).toBe(false)           // planned, not live
    expect(isDue(getSource('employee_compensation'), undefined, now)).toBe(false) // manual
  })
  it('selects due live sources from import_cursor in registry order', async () => {
    const db = await createTestDb()
    try {
      await db.query(`insert into import_cursor (source, cursor_offset, status, last_run_at) values ('csc', 5000, 'complete', $1), ('fec', 100, 'running', $2), ('boards', 0, 'complete', $3)`,
        [iso(3600_000), iso(60_000), iso(8 * 24 * 3600_000)])
      const due = await selectDueSources(db, { live: ['csc', 'fec', 'boards', 'puc'], now })
      expect(due.map(d => d.key)).toEqual(['boards', 'puc']) // csc fresh, fec owned by another tick, boards weekly elapsed, puc never run
      const only = await selectDueSources(db, { live: ['csc', 'puc'], keys: ['puc'], now })
      expect(only.map(d => d.key)).toEqual(['puc'])
    } finally { await db.end() }
  })
})
