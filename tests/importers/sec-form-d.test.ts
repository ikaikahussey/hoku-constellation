import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as formd from '@/lib/import/sources/sec-form-d'
import { unzip, parseTsv } from '@/lib/import/clients/zip'
import { runTwice, edgesFor, dryRunLeavesNothing } from './_harness'

const zip = readFileSync(new URL('../../lib/import/sources/__fixtures__/form-d/2026q1_d.zip', import.meta.url))
const filings = formd.readQuarterZip(zip, '2026q1')
let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('zip + tsv reader', () => {
  it('lists and inflates entries, honouring the filter', () => {
    const all = unzip(zip)
    expect([...all.keys()].sort()).toEqual(['2026Q1_d/FORMDSUBMISSION.tsv', '2026Q1_d/FormD_readme.html', '2026Q1_d/ISSUERS.tsv', '2026Q1_d/OFFERING.tsv', '2026Q1_d/RELATEDPERSONS.tsv', '2026Q1_d/SIGNATURES.tsv'])
    expect([...unzip(zip, n => n.endsWith('OFFERING.tsv')).keys()]).toEqual(['2026Q1_d/OFFERING.tsv'])
    expect(() => unzip(Buffer.from('not a zip at all, just some bytes that are long enough'))).toThrow(/not a ZIP/)
    expect(deflateRawSync(Buffer.from('x')).length).toBeGreaterThan(0)
  })
  it('parses tab-separated rows with quoted fields and literal inner quotes', () => {
    expect(parseTsv('A\tB\r\n"say ""hi"""\t5" pipe\r\n\r\nx\t\n')).toEqual([{ A: 'say "hi"', B: '5" pipe' }, { A: 'x', B: '' }])
  })
})

describe('sec_form_d (Form D data sets, Hawaiʻi issuers)', () => {
  it('finds quarterly links on the listing page, oldest first, across both URL prefixes', () => {
    const html = '<a href="/files/structureddata/data/form-d-data-sets/2013q4_d_0.zip">old</a><a href="/files/datastandardsinnovation/data/form-d-data-sets/2026q2_d.zip">Q2</a><a href="/files/structureddata/data/form-d-data-sets/2025q4_d.zip">Q4</a><a href="/files/structureddata/data/form-d-data-sets/2026q1_d.zip">Q1</a><a href="/files/structureddata/data/form-d-data-sets/2026q1_d.zip">dup</a>'
    expect(formd.parseQuarterLinks(html)).toEqual([
      { quarter: '2013q4', url: 'https://www.sec.gov/files/structureddata/data/form-d-data-sets/2013q4_d_0.zip' },
      { quarter: '2025q4', url: 'https://www.sec.gov/files/structureddata/data/form-d-data-sets/2025q4_d.zip' },
      { quarter: '2026q1', url: 'https://www.sec.gov/files/structureddata/data/form-d-data-sets/2026q1_d.zip' },
      { quarter: '2026q2', url: 'https://www.sec.gov/files/datastandardsinnovation/data/form-d-data-sets/2026q2_d.zip' },
    ])
  })
  it('keeps primary issuers in Hawaiʻi and joins submission, offering and related persons', () => {
    expect(formd.formDDate('14-FEB-2026')).toBe('2026-02-14')
    expect(filings.map(f => [f.accession, f.cik, f.entityName, f.filingDate, f.submissionType])).toEqual([
      ['0009000001-26-000001', '0009000001', 'Makai Ventures Fund I, LLC', '2026-02-14', 'D'],
      ['0009000002-26-000001', '0009000002', 'Kona Coffee Growers, Inc.', '2026-03-03', 'D/A'],
    ])
    expect(filings[0]).toMatchObject({ industryGroup: 'Pooled Investment Fund', totalOfferingAmount: 25000000, totalAmountSold: 4500000, previousNames: ['Makai Seed Fund LLC'], yearOfInc: '2024' })
    expect(filings[1].totalOfferingAmount).toBeNull() // "Indefinite"
    expect(filings[0].relatedPersons).toEqual([
      { name: 'Makai GP, LLC', isOrg: true, relationships: ['Promoter'], clarification: 'Manager of the Issuer (the "GP")', city: 'HONOLULU', state: 'HI' },
      { name: 'Leilani K. Akana', isOrg: false, relationships: ['Executive Officer', 'Director'], clarification: 'Managing Member of the GP', city: 'HONOLULU', state: 'HI' },
    ])
  })
  it('maps relationships to edge types (promoters get none)', () => {
    const [gp, akana] = filings[0].relatedPersons
    expect(formd.edgeTypesFor(gp)).toEqual([])
    expect(formd.edgeTypesFor(akana)).toEqual(['officer_of', 'director_of'])
    expect(formd.orgTypeFor('Limited Liability Company')).toBe('llc')
  })
  it('dry run writes nothing', async () => {
    await dryRunLeavesNothing(db, formd, filings)
  })
  it('imports issuers by CIK with officer/director edges from resolve-only people; idempotent', async () => {
    const r = await runTwice(db, formd, filings)
    expect(r.entitiesCreated).toBe(2)
    const orgs = await db.many<{ name: string; cik: string; island: string; org_type: string; aliases: string[] }>(
      `select name, identifiers->>'sec_cik' cik, attributes->>'island' island, attributes->>'org_type' org_type, aliases from entity where kind = 'org' order by name`)
    expect(orgs).toEqual([
      { name: 'Kona Coffee Growers, Inc.', cik: '0009000002', island: 'Hawaiʻi', org_type: 'corporation', aliases: [] },
      { name: 'Makai Ventures Fund I, LLC', cik: '0009000001', island: 'Oʻahu', org_type: 'llc', aliases: ['Makai Seed Fund LLC'] },
    ])
    const edges = await edgesFor(db, 'sec_form_d')
    expect(edges.map(e => [e.from_name_raw, e.type, e.role, e.match_status, e.start_date])).toEqual([
      ['Leilani K. Akana', 'director_of', 'Managing Member of the GP', 'review', '2026-02-14'],
      ['Leilani K. Akana', 'officer_of', 'Managing Member of the GP', 'review', '2026-02-14'],
      ['Kimo Silva', 'officer_of', 'President', 'review', '2026-03-03'],
    ])
    const doc = await db.one<{ body_text: string; url: string }>(`select body_text, url from document where source_record_id = '0009000001-26-000001'`)
    expect(doc?.url).toBe('https://www.sec.gov/Archives/edgar/data/9000001/000900000126000001/')
    expect(doc?.body_text).toContain('Offering: $25,000,000; sold: $4,500,000.')
  })
})
