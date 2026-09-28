import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as prop from '@/lib/import/sources/property-hnl'
import { runTwice, edgesFor } from './_harness'

const fx = (f: string) => readFileSync(new URL(`../../lib/import/sources/__fixtures__/${f}`, import.meta.url), 'utf8')
let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('property_hnl parser', () => {
  it('parses the CSV roll, normalizes TMKs, splits co-owners, drops non-Honolulu parcels', () => {
    const rows = prop.parseCsv(fx('rpad-roll.csv'))
    expect(rows).toHaveLength(3)
    const parsed = rows.map(prop.parseRollRow)
    expect(parsed[0]).toMatchObject({ tmk: '123004005000', owners: ['KAMEHAMEHA SCHOOLS'], assessedTotal: 15500000, assessmentYear: 2026, taxClass: 'Commercial' })
    expect(parsed[1]?.owners).toEqual(['DOE, JOHN K', 'DOE, MARY L'])
    expect(parsed[2]).toBeNull()
  })
  it('parses a qPublic parcel page', () => {
    const p = prop.parseQpublicPage(fx('qpublic-parcel.html'), '1-2-3-004-005-0000', 'https://q/x')!
    expect(p).toMatchObject({ tmk: '123004005000', owners: ['KAMEHAMEHA SCHOOLS'], address: '567 S KING ST', assessedTotal: 15500000, assessedLand: 12000000, landAreaSqft: 43560, assessmentYear: 2026 })
  })
})

describe('property_hnl importer', () => {
  it('creates parcels, owns edges (org matched, persons review); re-run updates assessment; idempotent', async () => {
    await db.query(`insert into entity (kind, name, aliases) values ('org', 'Kamehameha Schools', '{}')`)
    const records = prop.parseCsv(fx('rpad-roll.csv')).map(prop.parseRollRow).filter((p): p is prop.ParcelRecord => !!p)
    const r = await runTwice(db, prop, records)
    expect(r.entitiesCreated).toBe(2) // two parcels
    expect(r.edges).toBe(3)
    const edges = await edgesFor(db, 'property_hnl')
    expect(edges.find(e => e.from_name_raw === 'KAMEHAMEHA SCHOOLS')).toMatchObject({ type: 'owns', match_status: 'matched', role: 'fee owner' })
    expect(edges.filter(e => e.from_name_raw?.startsWith('DOE')).every(e => e.match_status === 'review')).toBe(true)
    const parcel = await db.one<{ attributes: Record<string, unknown> }>(`select attributes from entity where kind = 'parcel' and identifiers ->> 'tmk' = '123004005000'`)
    expect(parcel?.attributes).toMatchObject({ tmk: '123004005000', county: 'Honolulu', assessed_value: 15500000, assessment_year: 2026 })
  })
})
