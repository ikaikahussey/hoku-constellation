import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as gleif from '@/lib/import/sources/gleif'
import fixture from '@/lib/import/sources/__fixtures__/gleif-hi.json'
import { runTwice, edgesFor, dryRunLeavesNothing } from './_harness'

const records = fixture.records as unknown as gleif.LeiRecord[]
const parents = fixture.parents as unknown as Record<string, gleif.LeiRecord>
const items: gleif.GleifItem[] = records.map(record => ({ record, parent: parents[record.attributes.lei] ?? null }))

let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('gleif (Hawaiʻi-jurisdiction LEIs)', () => {
  it('reads the DCCA file number only from Hawaiʻi-registry records', () => {
    expect(gleif.dccaFileNumber(records[0].attributes.entity)).toBe('372533 C5')
    expect(gleif.dccaFileNumber(records[2].attributes.entity)).toBeNull()
    expect(gleif.dccaFileNumber(parents['254900TESTINSURE0002'].attributes.entity)).toBeNull() // Delaware registry
  })
  it('maps legal forms and parent links', () => {
    expect(gleif.legalForm({ id: 'VPBH', other: null })).toEqual({ label: 'Limited Liability Company', orgType: 'llc' })
    expect(gleif.legalForm({ id: '8888', other: 'TRUST' })).toEqual({ label: 'Trust', orgType: 'trust' })
    expect(gleif.legalForm(null)).toEqual({ label: null, orgType: 'organization' })
    expect(items.map(i => gleif.hasDirectParent(i.record))).toEqual([false, true, false])
  })
  it('builds attributes with island from the legal-address ZIP', () => {
    expect(gleif.orgAttributesFor(records[1])).toEqual({
      org_type: 'corporation', legal_form: 'Corporation', status: 'active', city: 'KIHEI', state: 'HI', zip: '96753-1234',
      island: 'Maui', jurisdiction: 'US-HI', formation_date: '2014-02-03', lei_status: 'LAPSED',
    })
    expect(gleif.orgAttributesFor(parents['254900TESTINSURE0002']).island).toBeUndefined()
  })
  it('dry run writes nothing', async () => {
    await dryRunLeavesNothing(db, gleif, items)
  })
  it('imports orgs by LEI and DCCA number, with an owns edge from the reported parent; idempotent', async () => {
    const r = await runTwice(db, gleif, items)
    expect(r.entitiesCreated).toBe(4)
    const orgs = await db.many<{ name: string; lei: string; dcca: string | null; island: string | null; org_type: string }>(
      `select name, identifiers->>'lei' lei, identifiers->>'dcca' dcca, attributes->>'island' island, attributes->>'org_type' org_type from entity where kind = 'org' order by name`)
    expect(orgs).toEqual([
      { name: 'EXAMPLE PAYMENTS HOLDINGS, INC.', lei: '5493TESTPARENT000004', dcca: null, island: null, org_type: 'organization' },
      { name: 'KALIA AINA HOLDINGS, LLC', lei: '254900TESTAINA000001', dcca: '372533 C5', island: 'Oʻahu', org_type: 'llc' },
      { name: 'MAKANA FAMILY TRUST', lei: '254900TESTTRUST00003', dcca: null, island: 'Hawaiʻi', org_type: 'trust' },
      { name: 'PACIFIC CAPTIVE INSURANCE COMPANY, INC.', lei: '254900TESTINSURE0002', dcca: '281944 D1', island: 'Maui', org_type: 'corporation' },
    ])
    const edges = await edgesFor(db, 'gleif')
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ type: 'owns', role: 'direct parent', match_status: 'matched', from_name_raw: 'EXAMPLE PAYMENTS HOLDINGS, INC.', to_name_raw: 'PACIFIC CAPTIVE INSURANCE COMPANY, INC.' })
    const alias = await db.one<{ aliases: string[] }>(`select aliases from entity where identifiers->>'lei' = '254900TESTAINA000001'`)
    expect(alias?.aliases).toEqual(['KALIA AINA'])
  })
  it('attaches to an org already known by its DCCA file number and adds the LEI', async () => {
    const fresh = await createTestDb()
    try {
      await fresh.query(`insert into entity(kind, name, identifiers, attributes) values ('org', 'Kalia Aina Holdings LLC', '{"dcca":"372533 C5"}', '{"slug":"kalia-aina-holdings-llc"}')`)
      const r = await runTwice(fresh, gleif, [items[0]])
      expect(r.entitiesCreated).toBe(0)
      const org = await fresh.one<{ identifiers: Record<string, string> }>(`select identifiers from entity where kind = 'org'`)
      expect(org?.identifiers).toEqual({ dcca: '372533 C5', lei: '254900TESTAINA000001' })
    } finally { await fresh.end() }
  })
})
