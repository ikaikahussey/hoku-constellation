import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as boards from '@/lib/import/sources/boards'
import { runTwice, edgesFor } from './_harness'

const html = readFileSync(new URL('../../lib/import/sources/__fixtures__/board-page.html', import.meta.url), 'utf8')
let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('boards parser', () => {
  it('parses index links and a board roster table, skipping vacancies', () => {
    expect(boards.parseBoardIndex(`<a href="/boards/public-utilities-commission">Public Utilities Commission</a><a href="/apply">Apply</a><a href="/boards/x.pdf">PDF</a>`))
      .toEqual([{ name: 'Public Utilities Commission', url: 'https://boards.hawaii.gov/boards/public-utilities-commission' }])
    const b = boards.parseBoardPage(html, 'https://boards.hawaii.gov/boards/puc', 'PUC')
    expect(b.name).toBe('Public Utilities Commission')
    expect(b.members).toEqual([
      { name: 'Leodoloff R. Asuncion, Jr.', seat: 'Chair', termEnds: '2028-06-30', appointedBy: 'Governor' },
      { name: 'Naomi U. Kuwaye', seat: 'Commissioner', termEnds: '2026-06-30', appointedBy: 'Governor' },
    ])
    expect(boards.officeType(b.name)).toBe('commission')
  })
})

describe('boards importer', () => {
  it('creates the office and appointees, appointed_to edges with term end; idempotent', async () => {
    const b = boards.parseBoardPage(html, 'https://boards.hawaii.gov/boards/puc', 'PUC')
    const r = await runTwice(db, boards, [b])
    expect(r.edges).toBe(2)
    expect(r.entitiesCreated).toBe(3)
    const office = await db.one<{ attributes: Record<string, unknown> }>(`select attributes from entity where kind = 'office'`)
    expect(office?.attributes).toMatchObject({ office_type: 'commission', jurisdiction: 'state', seat_count: 2 })
    const edges = await edgesFor(db, 'boards')
    expect(edges.find(e => e.from_name_raw === 'Naomi U. Kuwaye')).toMatchObject({ type: 'appointed_to', role: 'Commissioner', end_date: '2026-06-30', match_status: 'matched' })
  })
})
