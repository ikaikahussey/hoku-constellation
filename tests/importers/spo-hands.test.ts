import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as hands from '@/lib/import/sources/spo-hands'
import { runTwice, edgesFor } from './_harness'

const fx = (f: string) => readFileSync(new URL(`../../lib/import/sources/__fixtures__/${f}`, import.meta.url), 'utf8')
let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('spo_hands parser', () => {
  it('parses an awards listing with pagination flag', () => {
    const { rows, hasNext } = hands.parseListing(fx('hands-awards.html'), 'awards')
    expect(hasNext).toBe(true)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'RFP-26-001', agency: 'Department of Transportation', vendor: 'Grace Pacific LLC', amount: 4250000, date: '2026-02-03', status: 'Awarded', url: 'https://hands.ehawaii.gov/hands/awards/123456' })
  })
  it('parses the debarment list', () => {
    const { rows, hasNext } = hands.parseListing(fx('hands-debarred.html'), 'debarred')
    expect(hasNext).toBe(false)
    expect(rows[0]).toMatchObject({ id: 'D-77', vendor: 'Shady Builders Inc', date: '2025-01-10', endDate: '2028-01-10', status: 'Failure to pay prevailing wages' })
    expect(hands.docTypeFor('debarred')).toBe('debarment')
    expect(hands.docTypeFor('sole-source')).toBe('sole_source_notice')
  })
})

describe('spo_hands importer', () => {
  it('awards → awarded_contract from agency (created) to vendor (matched or review)', async () => {
    await db.query(`insert into entity (kind, name, aliases, attributes) values ('org', 'Grace Pacific LLC', '{}', '{"org_type":"corporation"}')`)
    const { rows } = hands.parseListing(fx('hands-awards.html'), 'awards')
    const r = await runTwice(db, hands, rows, { list: 'awards' })
    expect(r.entitiesCreated).toBe(2) // two agencies
    const edges = await edgesFor(db, 'spo_hands')
    expect(edges.find(e => e.to_name_raw === 'Grace Pacific LLC')).toMatchObject({ type: 'awarded_contract', match_status: 'matched', amount: '4250000.00', role: 'Awarded' })
    expect(edges.find(e => e.to_name_raw === 'Hawaiian Telcom Services Company')).toMatchObject({ match_status: 'review' })
  })
  it('debarments → sanctioned_by with end date', async () => {
    const { rows } = hands.parseListing(fx('hands-debarred.html'), 'debarred')
    await runTwice(db, hands, rows, { list: 'debarred' })
    const e = (await edgesFor(db, 'spo_hands')).find(e => e.type === 'sanctioned_by')!
    expect(e).toMatchObject({ from_name_raw: 'Shady Builders Inc', role: 'debarment', start_date: '2025-01-10', end_date: '2028-01-10' })
  })
})
