import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as fec from '@/lib/import/sources/fec'
import { runTwice, edgesFor } from './_harness'
import rows from '@/lib/import/sources/__fixtures__/fec.json'

let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('fec parser', () => {
  it('parses Schedule A rows and flags PAC vs individual donors', () => {
    const pac = fec.parseScheduleA(rows[0] as fec.ScheduleA)!
    expect(pac).toMatchObject({ donor: 'MATSON, INC. PAC', donorIsOrg: true, donorFecId: 'C00400028', committeeName: 'SCHATZ FOR SENATE', amount: 5000, date: '2023-09-30' })
    expect(pac.attributes).toMatchObject({ election_period: '2024', contribution_type: 'CONTRIBUTION', memo: false })
    const ind = fec.parseScheduleA(rows[1] as fec.ScheduleA)!
    expect(ind).toMatchObject({ donorIsOrg: false, amount: 250.5 })
    expect(ind.attributes).toMatchObject({ employer: 'UNIVERSITY OF HAWAII', occupation: 'PROFESSOR', memo: true })
    expect(fec.parseScheduleA(rows[2] as fec.ScheduleA)).toBeNull()
  })
})

describe('fec importer', () => {
  it('creates the recipient committee and PAC donor by FEC id, leaves individuals for review', async () => {
    const r = await runTwice(db, fec, rows, {}, 2)
    expect(r.edges).toBe(2)
    const orgs = await db.many<{ name: string; identifiers: Record<string, string> }>(`select name, identifiers from entity where kind = 'org' order by name`)
    expect(orgs.map(o => o.identifiers.fec_id).sort()).toEqual(['C00400028', 'S4HI00089'])
    const edges = await edgesFor(db, 'fec')
    expect(edges.find(e => e.from_name_raw === 'MATSON, INC. PAC')).toMatchObject({ type: 'contributed_to', match_status: 'matched', amount: '5000.00' })
    expect(edges.find(e => e.from_name_raw === 'KEALOHA, MARY')).toMatchObject({ match_status: 'review', from_id: null })
    expect(await db.one(`select 1 from entity where kind = 'person'`)).toBeNull()
  })
})
