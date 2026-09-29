import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as sec from '@/lib/import/sources/sec-hi-companies'
import submissions from '@/lib/import/sources/__fixtures__/sec-hi/submissions.json'
import { runTwice, dryRunLeavesNothing } from './_harness'

const atom = readFileSync(new URL('../../lib/import/sources/__fixtures__/sec-hi/browse.atom.xml', import.meta.url), 'utf8')
const records = submissions as unknown as sec.CompanySubmissions[]
let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('sec_hi_companies', () => {
  it('reads CIKs from the EDGAR browse Atom feed', () => {
    expect(sec.parseBrowseAtom(atom)).toEqual(['0002108164', '0001484388', '0001352430'])
  })
  it('treats all-zero EINs as missing and skips insider-only filers', () => {
    expect(sec.cleanEin('000000000')).toBeNull()
    expect(sec.cleanEin('27-1885521')).toBe('271885521')
    expect(records.map(sec.isCompany)).toEqual([true, true, false])
  })
  it('summarises forms and builds attributes', () => {
    expect(sec.formSummary(records[1])).toEqual({ forms: { D: 1, 'D/A': 1 }, lastFiled: '2019-04-02', formD: true })
    expect(sec.orgAttributesFor(records[0])).toEqual({
      org_type: 'corporation', sector: 'Blank Checks', sic: '6770', tickers: ['PONO'], city: 'HONOLULU', state: 'HI', zip: '96813',
      island: 'Oʻahu', state_of_incorporation: 'Cayman Islands', sec_last_filed: '2026-08-14',
    })
    expect(sec.documentRaw(records[1])).not.toHaveProperty('filings')
  })
  it('dry run writes nothing', async () => {
    await dryRunLeavesNothing(db, sec, records)
  })
  it('imports companies by CIK (and EIN when real), skipping individuals; idempotent', async () => {
    const r = await runTwice(db, sec, records, {}, 2)
    expect(r.entitiesCreated).toBe(2)
    const orgs = await db.many<{ name: string; identifiers: Record<string, string>; aliases: string[]; formd: string | null }>(
      `select name, identifiers, aliases, attributes->>'sec_form_d_filer' formd from entity where kind = 'org' order by name`)
    expect(orgs).toEqual([
      { name: 'Pono Capital Four, Inc.', identifiers: { sec_cik: '0002108164' }, aliases: [], formd: null },
      { name: 'Vanguard Medical Systems, LLC', identifiers: { sec_cik: '0001484388', ein: '271885521' }, aliases: ['VMS Hawaii LLC'], formd: 'true' },
    ])
    const doc = await db.one<{ doc_date: string; title: string }>(`select doc_date::text doc_date, title from document where source = 'sec_hi_companies' and source_record_id = '0001484388'`)
    expect(doc).toEqual({ doc_date: '2019-04-02', title: 'Vanguard Medical Systems, LLC — SEC filer (CIK 1484388)' })
  })
})
