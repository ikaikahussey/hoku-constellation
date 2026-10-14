import { describe, it, expect } from 'vitest'
import { isDue, selectDueSources, RUNNING_GRACE_MS, CRON_BATCH_SIZE } from '@/lib/import/schedule'
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
    expect(isDue({ ...csc, paused: true }, undefined, now)).toBe(false)              // paused by the owner
    expect(isDue(getSource('capitol_measures'), undefined, now)).toBe(false)
  })
  it('selects due live sources, never-run first, then least recently run', async () => {
    const db = await createTestDb()
    try {
      await db.query(`insert into import_cursor (source, cursor_offset, status, last_run_at) values ('csc', 5000, 'complete', $1), ('fec', 100, 'running', $2), ('boards', 0, 'complete', $3)`,
        [iso(3600_000), iso(60_000), iso(8 * 24 * 3600_000)])
      const due = await selectDueSources(db, { live: ['csc', 'fec', 'boards', 'spo_hands', 'puc'], now })
      expect(due.map(d => d.key)).toEqual(['spo_hands', 'boards']) // csc fresh, fec owned by another tick, puc paused; spo_hands never run goes before boards (weekly elapsed)
      // A source stuck at the head of the registry does not starve one that has never run.
      await db.query(`insert into import_cursor (source, cursor_offset, status, last_run_at) values ('capitol_testimony', 0, 'error', $1)`, [iso(1000)])
      const fair = await selectDueSources(db, { live: ['capitol_testimony', 'news'], now })
      expect(fair.map(d => d.key)).toEqual(['news', 'capitol_testimony'])
      const only = await selectDueSources(db, { live: ['csc', 'spo_hands'], keys: ['spo_hands'], now })
      expect(only.map(d => d.key)).toEqual(['spo_hands'])
    } finally { await db.end() }
  })
})

describe('cron batch size', () => {
  it('keeps one batch of per-record fetches well inside the 300 s function limit', () => {
    // One request per second per host, up to one 30 s timeout retry per record in the worst case seen.
    const worstCaseSeconds = CRON_BATCH_SIZE * 1 + 30 * 2
    expect(worstCaseSeconds).toBeLessThan(120)
    expect(CRON_BATCH_SIZE).toBeGreaterThan(0)
  })
})
