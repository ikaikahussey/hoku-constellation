import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as usa from '@/lib/import/sources/usaspending'
import { runTwice, edgesFor } from './_harness'
import rows from '@/lib/import/sources/__fixtures__/usaspending.json'

let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('usaspending', () => {
  it('parses awards and grants', () => {
    expect(usa.parseAward(rows[0] as usa.UsaSpendingRow, 'contract')).toMatchObject({ vendor: 'NAN, INC.', uei: 'ABC123DEF456', agency: 'Department of Defense', amount: 18500000.5, start: '2026-01-15', end: '2027-06-30', isGrant: false })
    expect(usa.parseAward(rows[1] as usa.UsaSpendingRow, 'contract')?.isGrant).toBe(true)
    expect(usa.parseAward(rows[2] as usa.UsaSpendingRow, 'contract')).toBeNull()
  })
  it('imports: agencies created, UEI vendor created, unmatched vendor left for review', async () => {
    const r = await runTwice(db, usa, rows, { family: 'contract' }, 2)
    expect(r.entitiesCreated).toBe(3) // DoD, NSF, NAN (has UEI)
    const edges = await edgesFor(db, 'usaspending')
    expect(edges.find(e => e.to_name_raw === 'NAN, INC.')).toMatchObject({ type: 'awarded_contract', match_status: 'matched', amount: '18500000.50' })
    expect(edges.find(e => e.to_name_raw === 'University of Hawaii')).toMatchObject({ type: 'awarded_grant', match_status: 'review' })
    const docs = await db.many<{ doc_type: string }>(`select doc_type from document where source = 'usaspending' order by 1`)
    expect(docs.map(d => d.doc_type)).toEqual(['contract', 'grant'])
  })
})
