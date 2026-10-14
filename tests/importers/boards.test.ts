import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as boards from '@/lib/import/sources/boards'
import { runTwice, edgesFor } from './_harness'

const fixture = (f: string) => readFileSync(new URL(`../../lib/import/sources/__fixtures__/${f}`, import.meta.url), 'utf8')
const html = fixture('board-page.html')
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

describe('boards multisite discovery', () => {
  it('lists board subsites from the root sitemap index, once each, boards.hawaii.gov only', () => {
    expect(boards.parseBoardSitemapIndex(fixture('boards/sitemap-index.xml'))).toEqual([
      { slug: 'blnr', url: 'https://boards.hawaii.gov/blnr/' },
      { slug: 'puc', url: 'https://boards.hawaii.gov/puc/' },
    ])
  })
  it('takes the board name from the subsite, and roster links within the same subsite', () => {
    const home = fixture('boards/subsite-home.html')
    expect(boards.boardName(home, 'blnr')).toBe('Board of Land and Natural Resources')
    expect(boards.boardName('<title>Home – Boards and Commissions</title>', 'blnr')).toBe('blnr')
    expect(boards.rosterLinks(home, 'https://boards.hawaii.gov/blnr/')).toEqual([
      'https://boards.hawaii.gov/blnr/board-members/',
      'https://boards.hawaii.gov/blnr/about/composition/',
    ])
  })
  it('reads list-style rosters and ignores navigation text and vacancies', () => {
    const home = boards.parseBoardPage(fixture('boards/subsite-home.html'), 'https://boards.hawaii.gov/blnr/', 'BLNR')
    expect(home.members).toEqual([])
    const b = boards.parseBoardPage(fixture('boards/subsite-members.html'), 'https://boards.hawaii.gov/blnr/board-members/', 'BLNR')
    expect(b.members).toEqual([
      { name: 'Dawn N. S. Chang', seat: 'Chairperson', termEnds: '2027-06-30', appointedBy: null },
      { name: 'Karen Ono', seat: 'Kauaʻi Member', termEnds: '2026-06-30', appointedBy: null },
    ])
    expect(boards.looksLikePersonName('Meeting Agendas')).toBe(false)
    expect(boards.looksLikePersonName('Leodoloff R. Asuncion, Jr.')).toBe(true)
  })
})

describe('boards importer', () => {
  it('skips a board with no members without creating an office', async () => {
    const empty = { name: 'Empty Board', url: 'https://boards.hawaii.gov/empty/', department: null, description: null, members: [] }
    const r = await runTwice(db, boards, [empty], {}, 0)
    expect(r.entitiesCreated).toBe(0)
    expect(await db.many(`select id from entity where kind = 'office'`)).toHaveLength(0)
  })

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
