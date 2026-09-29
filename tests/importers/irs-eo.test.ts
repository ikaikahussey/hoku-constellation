import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as eo from '@/lib/import/sources/irs-eo'
import { parseCsv } from '@/lib/import/sources/property-hnl'
import { islandForZip } from '@/lib/import/normalize'
import { runTwice, dryRunLeavesNothing } from './_harness'

const rows = parseCsv(readFileSync(new URL('../../lib/import/sources/__fixtures__/eo_hi.csv', import.meta.url), 'utf8')) as eo.BmfRow[]
let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('irs_eo (IRS EO BMF, Hawaiʻi)', () => {
  it('maps subsection codes, ruling months, and ZIPs', () => {
    expect(eo.subsectionLabel('03')).toBe('501(c)(3)')
    expect(eo.subsectionLabel('00')).toBeNull()
    expect(eo.yyyymmToDate('200410')).toBe('2004-10-01')
    expect(eo.yyyymmToDate('000000')).toBeNull()
    expect(eo.yyyymmToDate('202513')).toBeNull()
    expect(islandForZip('96813-4718')).toBe('Oʻahu')
    expect(islandForZip('96789')).toBe('Oʻahu')
    expect(islandForZip('96768')).toBe('Maui')
    expect(islandForZip('96766')).toBe('Kauaʻi')
    expect(islandForZip('96720')).toBe('Hawaiʻi')
    expect(islandForZip('96748')).toBe('Molokaʻi')
    expect(islandForZip('96763')).toBe('Lānaʻi')
    expect(islandForZip('94105')).toBeNull()
    expect(islandForZip('')).toBeNull()
  })
  it('builds org attributes from a row', () => {
    expect(eo.orgAttributesFor(rows[1])).toEqual({
      org_type: 'nonprofit', city: 'MAKAWAO', state: 'HI', zip: '96768-8280', island: 'Maui', ntee_code: 'B11',
      irs_subsection: '501(c)(3)', irs_ruling_date: '2004-10-01', assets: 487381, income: 411749, revenue: 411749,
    })
  })
  it('dry run writes nothing', async () => {
    await dryRunLeavesNothing(db, eo, rows)
  })
  it('imports one document and one org per EIN, skips rows without an EIN; idempotent', async () => {
    const r = await runTwice(db, eo, rows, {}, 3)
    expect(r.entitiesCreated).toBe(3)
    const orgs = await db.many<{ name: string; ein: string; island: string | null; subsection: string | null }>(
      `select name, identifiers->>'ein' ein, attributes->>'island' island, attributes->>'irs_subsection' subsection from entity where kind = 'org' order by name`)
    expect(orgs).toEqual([
      { name: 'BEN AND MIRIAM LAU FOUNDATION', ein: '010629526', island: 'Oʻahu', subsection: '501(c)(3)' },
      { name: 'HAWAII STATE AFL CIO', ein: '990073497', island: 'Oʻahu', subsection: '501(c)(5)' },
      { name: 'KAMEHAMEHA SCHOOLS MAUI CAMPUS OHANA', ein: '200170363', island: 'Maui', subsection: '501(c)(3)' },
    ])
    const doc = await db.one<{ doc_type: string; doc_date: string; title: string }>(`select doc_type, doc_date::text doc_date, title from document where source = 'irs_eo' and source_record_id = '200170363'`)
    expect(doc).toEqual({ doc_type: 'entity_registration', doc_date: '2004-10-01', title: 'KAMEHAMEHA SCHOOLS MAUI CAMPUS OHANA — IRS exempt organization (501(c)(3))' })
  })
  it('attaches to an existing org with the same EIN instead of creating a duplicate', async () => {
    const fresh = await createTestDb()
    try {
      await fresh.query(`insert into entity(kind, name, identifiers, attributes) values ('org', 'Hawaii State AFL-CIO', '{"ein":"990073497"}', '{"slug":"hawaii-state-afl-cio"}')`)
      const r = await runTwice(fresh, eo, [rows[2]], {}, 1)
      expect(r.entitiesCreated).toBe(0)
      const n = await fresh.one<{ n: string }>(`select count(*)::text n from entity where kind = 'org'`)
      expect(n?.n).toBe('1')
    } finally { await fresh.end() }
  })
})
