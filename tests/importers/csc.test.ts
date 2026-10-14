import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as csc from '@/lib/import/sources/csc'
import { runTwice, edgesFor, dryRunLeavesNothing } from './_harness'
import contributions from '@/lib/import/sources/__fixtures__/csc.json'
import expenditures from '@/lib/import/sources/__fixtures__/csc-expenditures.json'
import catalog from '@/lib/import/sources/__fixtures__/csc-socrata/catalog.json'
import sodaRows from '@/lib/import/sources/__fixtures__/csc-socrata/rows.json'

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

describe('csc Socrata route (hicscdata.hawaii.gov)', () => {
  const datasets = csc.datasetsFromCatalog(catalog.results)
  it('classifies catalog datasets by display names and skips non-datasets and unclassifiable ones', () => {
    expect(datasets.map(d => [d.id, d.kind])).toEqual([['3maa-4fgr', 'expenditure'], ['jexd-xbcg', 'contribution']])
    expect(datasets[1].fields).toMatchObject({ candidate_name: 'Candidate Name', contributor_name: 'Contributor Name', reg_no: 'Reg No' })
    expect(csc.catalogUrl()).toMatch(/^https:\/\/hicscdata\.hawaii\.gov\/api\/catalog\/v1\?/)
  })
  it('re-keys SODA rows to display names so the shared parser reads them', () => {
    const row = csc.rekeyRow(sodaRows[0], datasets[1].fields)
    expect(row).toMatchObject({ _id: 'row-aaaa~1111', 'Candidate Name': 'Green, Josh', 'Contributor Name': 'Hawaiian Electric Industries PAC' })
    expect(csc.parseCscRecord('contribution', row)).toMatchObject({ fromName: 'Hawaiian Electric Industries PAC', toName: 'Green, Josh', amount: 2000, date: '2022-03-15', regNo: 'CC10529', recordId: 'row-aaaa~1111' })
    expect(csc.parseCscRecord('contribution', csc.rekeyRow(sodaRows[2], datasets[1].fields))).toBeNull()
  })
  it('maps a cross-dataset offset to a dataset and a local offset', () => {
    const ds = [{ id: 'a', kind: 'contribution' as const, name: 'a', rows: 3 }, { id: 'b', kind: 'expenditure' as const, name: 'b', rows: 2 }]
    expect(csc.locate(ds, 0)).toEqual({ index: 0, local: 0 })
    expect(csc.locate(ds, 3)).toEqual({ index: 1, local: 0 })
    expect(csc.locate(ds, 4)).toEqual({ index: 1, local: 1 })
    expect(csc.locate(ds, 5)).toBeNull()
  })
  it('imports re-keyed SODA rows idempotently with dataset-scoped record ids', async () => {
    const sdb = await createTestDb()
    try {
      const rows = sodaRows.map(r => csc.rekeyRow(r, datasets[1].fields))
      const r = await runTwice(sdb, csc, rows, { kind: 'contribution', resource: 'jexd-xbcg' }, 2)
      expect(r.edges).toBe(2)
      const docs = await sdb.many<{ source_record_id: string; url: string }>(`select source_record_id, url from document where source = 'csc' order by 1`)
      expect(docs).toEqual([
        { source_record_id: 'jexd-xbcg:row-aaaa~1111', url: 'https://hicscdata.hawaii.gov/d/jexd-xbcg' },
        { source_record_id: 'jexd-xbcg:row-aaaa~2222', url: 'https://hicscdata.hawaii.gov/d/jexd-xbcg' },
      ])
    } finally { await sdb.end() }
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
