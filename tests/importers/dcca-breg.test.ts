import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as breg from '@/lib/import/sources/dcca-breg'
import { normalizeDccaFileNumber } from '@/lib/import/normalize'
import { runImporter } from '@/lib/import/run'
import { edgesFor } from './_harness'

// Wide export: one row per entity, numbered officer columns.
const WIDE = `File Number,Business Name,Entity Type,Status,Registration Date,Place of Incorporation,Mailing Address,City,State,Zip,Registered Agent,Officer 1 Name,Officer 1 Title,Officer 2 Name,Officer 2 Title,Annual Report Year
372533C5,KALIA AINA HOLDINGS LLC,Domestic Limited Liability Company,Active,07/16/2026,Hawaii,1000 BISHOP ST STE 800,HONOLULU,HI,96813,CORPORATE AGENTS LLC,"Keola, Nani",Manager,,,2026
12345 D1,MAUI GROWERS INC,Domestic Profit Corporation,Active,1998-03-02,Hawaii,PO BOX 1,KAHULUI,HI,96732,,"Silva, Joe",President,"Silva, Joe",Director,2025
,NO FILE NUMBER CO,Domestic Profit Corporation,Active,,,,,,,,,,,,
`
// Long export: one row per officer; entity columns repeat.
const LONG = `Business ID,Entity Name,Type,Standing,Date of Incorporation,Officer Name,Officer Title,City,Zip
99999 C2,HILO HARBOR FOUNDATION,Domestic Nonprofit Corporation,Active,2001-05-05,"Kahale, Lei",President,HILO,96720
99999 C2,HILO HARBOR FOUNDATION,Domestic Nonprofit Corporation,Active,2001-05-05,"Ito, Sam",Treasurer,HILO,96720
99999 C2,HILO HARBOR FOUNDATION,Domestic Nonprofit Corporation,Active,2001-05-05,"Ito, Sam",Treasurer,HILO,96720
`

let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('dcca_breg (registry export loader)', () => {
  it('normalizes DCCA file numbers', () => {
    expect(normalizeDccaFileNumber('372533c5')).toBe('372533 C5')
    expect(normalizeDccaFileNumber(' 12345-D1 ')).toBe('12345 D1')
    expect(normalizeDccaFileNumber('372533  C5')).toBe('372533 C5')
    expect(normalizeDccaFileNumber('')).toBeNull()
  })
  it('maps wide-export headers and reports ignored columns', () => {
    const { fields, officerColumns, unmapped } = breg.mapColumns(WIDE.split('\n')[0].split(','))
    expect(fields).toMatchObject({ fileNumber: 'File Number', name: 'Business Name', entityType: 'Entity Type', status: 'Status', registrationDate: 'Registration Date', placeOfIncorporation: 'Place of Incorporation', address: 'Mailing Address', city: 'City', state: 'State', zip: 'Zip', agent: 'Registered Agent' })
    expect(officerColumns).toEqual([{ n: 1, name: 'Officer 1 Name', title: 'Officer 1 Title' }, { n: 2, name: 'Officer 2 Name', title: 'Officer 2 Title' }])
    expect(unmapped).toEqual(['Annual Report Year'])
  })
  it('parses wide rows and merges long-format officer rows by file number', () => {
    const wide = breg.parseBregCsv(WIDE)
    expect(wide.skipped).toBe(1)
    expect(wide.entities.map(e => [e.fileNumber, e.name, e.registrationDate, e.officers])).toEqual([
      ['372533 C5', 'KALIA AINA HOLDINGS LLC', '2026-07-16', [{ name: 'Keola, Nani', title: 'Manager' }]],
      ['12345 D1', 'MAUI GROWERS INC', '1998-03-02', [{ name: 'Silva, Joe', title: 'President' }, { name: 'Silva, Joe', title: 'Director' }]],
    ])
    const long = breg.parseBregCsv(LONG)
    expect(long.entities).toHaveLength(1)
    expect(long.entities[0]).toMatchObject({ fileNumber: '99999 C2', entityType: 'Domestic Nonprofit Corporation', status: 'Active', registrationDate: '2001-05-05', officers: [{ name: 'Kahale, Lei', title: 'President' }, { name: 'Ito, Sam', title: 'Treasurer' }] })
    expect(long.entities[0].raw).toHaveLength(3)
  })
  it('maps entity types', () => {
    expect(breg.orgTypeFor('Domestic Limited Liability Company')).toBe('llc')
    expect(breg.orgTypeFor('Foreign Profit Corporation')).toBe('corporation')
    expect(breg.orgTypeFor('Domestic Nonprofit Corporation')).toBe('nonprofit')
    expect(breg.orgTypeFor('Limited Liability Limited Partnership')).toBe('limited_partnership')
    expect(breg.orgTypeFor('Trade Name')).toBe('trade_name')
    expect(breg.orgTypeFor(null)).toBe('organization')
  })
  it('imports from params.csv: orgs by DCCA number, officers resolve-only; idempotent', async () => {
    const opts = { params: { csv: WIDE, filename: 'breg.csv' }, resume: false, log: () => {} }
    const first = await runImporter(db, breg.SOURCE_KEY, breg.importBatch, opts)
    expect(first).toMatchObject({ documents: 2, entitiesCreated: 2, edges: 3, errors: 0, done: true })
    const second = await runImporter(db, breg.SOURCE_KEY, breg.importBatch, opts)
    expect(second).toMatchObject({ documents: 0, edges: 0, entitiesCreated: 0 })
    const org = await db.one<{ identifiers: Record<string, string>; attributes: Record<string, unknown> }>(`select identifiers, attributes from entity where name = 'KALIA AINA HOLDINGS LLC'`)
    expect(org?.identifiers).toEqual({ dcca: '372533 C5' })
    expect(org?.attributes).toMatchObject({ org_type: 'llc', status: 'active', registration_date: '2026-07-16', island: 'Oʻahu', registered_agent: 'CORPORATE AGENTS LLC' })
    const edges = await edgesFor(db, 'dcca_breg')
    expect(edges.map(e => [e.from_name_raw, e.type, e.role, e.match_status])).toEqual([
      ['Silva, Joe', 'director_of', 'Director', 'review'],
      ['Silva, Joe', 'officer_of', 'President', 'review'],
      ['Keola, Nani', 'director_of', 'Manager', 'review'],
    ])
    const persons = await db.one<{ n: string }>(`select count(*)::text n from entity where kind = 'person'`)
    expect(persons?.n).toBe('0')
  })
  it('refuses to run without a CSV, and rejects a file with no file-number column', async () => {
    await expect(breg.importBatch(db, 0, 10, {})).rejects.toThrow(/--file/)
    await expect(breg.importBatch(db, 0, 10, { params: { csv: 'Company,City\nA,B\n', filename: 'bad.csv' } })).rejects.toThrow(/file-number/)
  })
})
