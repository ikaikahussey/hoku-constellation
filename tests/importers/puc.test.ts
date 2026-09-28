import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as puc from '@/lib/import/sources/puc'
import { runTwice, edgesFor } from './_harness'

const fx = (f: string) => readFileSync(new URL(`../../lib/import/sources/__fixtures__/${f}`, import.meta.url), 'utf8')
let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('puc parser', () => {
  it('parses docket search and parties tables', () => {
    const d = puc.parseDocketTable(fx('puc-search.html'))
    expect(d).toHaveLength(2)
    expect(d[0]).toMatchObject({ docketNumber: '2024-0001', filingDate: '2024-01-05', applicant: 'Hawaiian Electric Company, Inc.', status: 'Open', docketType: 'Rate Case', url: 'https://dms.puc.hawaii.gov/dms/DocketDetails?docketNumber=2024-0001' })
    expect(d[1].url).toBe('https://dms.puc.hawaii.gov/dms/DocketDetails?docketNumber=2024-0002')
    const parties = puc.parseDocketParties(fx('puc-parties.html'))
    expect(parties).toEqual([
      { name: 'Hawaiian Electric Company, Inc.', role: 'applicant' }, { name: 'Division of Consumer Advocacy', role: 'consumer advocate' },
      { name: 'Ulupono Initiative LLC', role: 'intervenor' }, { name: 'Henry Curtis', role: 'intervenor' },
    ])
  })
})

describe('puc importer', () => {
  it('creates dockets and applicant utilities, party_to edges for intervenors; idempotent', async () => {
    const dockets = puc.parseDocketTable(fx('puc-search.html'))
    dockets[0].parties = puc.parseDocketParties(fx('puc-parties.html'))
    const r = await runTwice(db, puc, dockets, { year: '2024' })
    expect(r.edges).toBe(5) // 4 parties on docket 1 (applicant deduped) + applicant on docket 2
    const docket = await db.one<{ identifiers: Record<string, string>; attributes: Record<string, unknown> }>(`select identifiers, attributes from entity where kind = 'docket' and identifiers ->> 'docket_number' = '2024-0001'`)
    expect(docket?.attributes).toMatchObject({ docket_number: '2024-0001', status: 'Open', docket_type: 'Rate Case' })
    const edges = await edgesFor(db, 'puc')
    expect(edges.find(e => e.from_name_raw === 'Hawaiian Electric Company, Inc.')).toMatchObject({ type: 'party_to', role: 'applicant', match_status: 'matched' })
    expect(edges.find(e => e.from_name_raw === 'Henry Curtis')).toMatchObject({ role: 'intervenor', match_status: 'review' })
    const utilities = await db.many<{ attributes: Record<string, unknown> }>(`select attributes from entity where kind = 'org' and attributes ->> 'org_type' = 'utility'`)
    expect(utilities).toHaveLength(2)
  })
})
