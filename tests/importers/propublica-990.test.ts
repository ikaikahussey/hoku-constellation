import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as pp from '@/lib/import/sources/propublica-990'
import { runTwice, edgesFor } from './_harness'
import details from '@/lib/import/sources/__fixtures__/propublica.json'

let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('propublica_990', () => {
  it('parses officers from numbered fields and arrays, pads EINs, classifies board titles', () => {
    const officers = pp.parseOfficers(details[0].filings_with_data[0] as Record<string, unknown>)
    expect(officers).toEqual([
      { name: 'MICAH KANE', title: 'PRESIDENT & CEO', compensation: 450000 },
      { name: 'PETER HO', title: 'DIRECTOR', compensation: 0 },
      { name: 'Robin Campaniano', title: 'Board Chair', compensation: 0 },
    ])
    expect(pp.padEin('99-0001234')).toBe('990001234')
    expect(pp.isBoardTitle('DIRECTOR')).toBe(true)
    expect(pp.isBoardTitle('PRESIDENT & CEO')).toBe(false)
  })
  it('imports org by EIN, officer_of/director_of edges to unmatched persons (review); idempotent', async () => {
    await db.query(`insert into entity (kind, name, aliases) values ('person', 'Peter Ho', '{}')`)
    const r = await runTwice(db, pp, details)
    expect(r.entitiesCreated).toBe(2) // two orgs by EIN
    const edges = await edgesFor(db, 'propublica_990')
    expect(edges).toHaveLength(3)
    expect(edges.find(e => e.from_name_raw === 'MICAH KANE')).toMatchObject({ type: 'officer_of', match_status: 'review', role: 'PRESIDENT & CEO' })
    expect(edges.find(e => e.from_name_raw === 'PETER HO')).toMatchObject({ type: 'director_of', match_status: 'matched' })
    const org = await db.one<{ identifiers: Record<string, string>; attributes: Record<string, unknown> }>(`select identifiers, attributes from entity where identifiers ->> 'ein' = '990073524'`)
    expect(org?.attributes).toMatchObject({ org_type: 'nonprofit', ntee_code: 'T31' })
  })
})
