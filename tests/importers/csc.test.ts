import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as csc from '@/lib/import/sources/csc'
import { runTwice, edgesFor, dryRunLeavesNothing } from './_harness'
import contributions from '@/lib/import/sources/__fixtures__/csc.json'
import expenditures from '@/lib/import/sources/__fixtures__/csc-expenditures.json'

let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('csc parser', () => {
  it('classifies resources by column names', () => {
    expect(csc.classifyFields(['_id', 'Candidate Name', 'Contributor Name', 'Amount'])).toBe('contribution')
    expect(csc.classifyFields(['_id', 'Candidate Name', 'Vendor Name', 'Expenditure Category'])).toBe('expenditure')
    expect(csc.classifyFields(['_id', 'Candidate Name', 'Lender Name', 'Loan Amount'])).toBe('loan')
    expect(csc.classifyFields(['_id', 'Something'])).toBeNull()
  })
  it('parses contributions with normalized dates, amounts and org heuristics', () => {
    const p = csc.parseCscRecord('contribution', contributions[0] as Record<string, unknown>)!
    expect(p).toMatchObject({ fromName: 'Hawaiian Electric Industries', toName: 'Green, Josh', fromIsOrg: true, toIsOrg: false, amount: 2000, date: '2022-03-15', role: 'Noncandidate Committee', regNo: 'CC10529' })
    expect(p.attributes).toMatchObject({ election_period: '2018-2022', office: 'Governor', non_monetary: false, aggregate: 4000 })
    const ind = csc.parseCscRecord('contribution', contributions[2] as Record<string, unknown>)!
    expect(ind).toMatchObject({ fromIsOrg: false, amount: 250, date: '2022-06-30' })
    expect(ind.attributes).toMatchObject({ employer: 'Self', occupation: 'Attorney' })
    expect(csc.parseCscRecord('contribution', contributions[3] as Record<string, unknown>)).toBeNull()
  })
  it('parses expenditures from candidate and noncandidate committees', () => {
    const e = csc.parseCscRecord('expenditure', expenditures[0] as Record<string, unknown>)!
    expect(e).toMatchObject({ fromName: 'Green, Josh', toName: 'Anthology Marketing Group', amount: 15000, role: 'Advertising', fromIsOrg: false })
    const nc = csc.parseCscRecord('expenditure', expenditures[1] as Record<string, unknown>)!
    expect(nc).toMatchObject({ fromName: 'Be Change Now', fromIsOrg: true, regNo: 'NC20456' })
  })
})

describe('csc importer', () => {
  it('is idempotent, advances the cursor, and routes matches', async () => {
    // Pre-existing org so one donor resolves by fuzzy match (ʻokina variant).
    await db.query(`insert into entity (kind, name, aliases) values ('org', 'Kauai Coffee Company', '{}')`)
    const r = await runTwice(db, csc, contributions, { kind: 'contribution', resource: 'r1' }, 3)
    expect(r.edges).toBe(3)
    const edges = await edgesFor(db, 'csc')
    expect(edges.map(e => e.type)).toEqual(['contributed_to', 'contributed_to', 'contributed_to'])
    // Candidate (authoritative) was created once and reused across records.
    const candidates = await db.many(`select id from entity where kind = 'person' and identifiers ->> 'csc_reg_no' = 'CC10529'`)
    expect(candidates).toHaveLength(1)
    const byDonor = Object.fromEntries(edges.map(e => [e.from_name_raw, e]))
    expect(byDonor['Kauaʻi Coffee Company'].match_status).toBe('matched')       // fuzzy-matched existing org
    expect(byDonor['Hawaiian Electric Industries'].match_status).toBe('review')  // recipient matched, donor unknown org (not auto-created)
    expect(byDonor['Doe, Jane'].match_status).toBe('review')                     // individual donor never auto-created
    expect(byDonor['Doe, Jane'].from_id).toBeNull()
    expect(byDonor['Hawaiian Electric Industries'].amount).toBe('2000.00')
  })
  it('imports expenditures as spent_with and creates noncandidate committees by Reg No', async () => {
    const r = await runTwice(db, csc, expenditures, { kind: 'expenditure', resource: 'r2' })
    expect(r.edges).toBe(2)
    const edges = (await edgesFor(db, 'csc')).filter(e => e.type === 'spent_with')
    expect(edges).toHaveLength(2)
    const nc = await db.one<{ attributes: Record<string, unknown> }>(`select attributes from entity where kind = 'org' and identifiers ->> 'csc_reg_no' = 'NC20456'`)
    expect(nc?.attributes.org_type).toBe('pac')
  })
  it('dry run writes nothing', async () => {
    const r = await dryRunLeavesNothing(db, csc, contributions, { kind: 'contribution', resource: 'r3' })
    expect(r.seen).toBe(4)
  })
})
