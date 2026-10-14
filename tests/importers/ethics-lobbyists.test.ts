import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as mod from '@/lib/import/sources/ethics-lobbyists'
import { readFileSync } from 'node:fs'
import { parseCsv } from '@/lib/import/sources/property-hnl'
import { runTwice, edgesFor } from './_harness'

const fixture = (f: string) => readFileSync(new URL(`../../lib/import/sources/__fixtures__/${f}`, import.meta.url), 'utf8')
import registrations from '@/lib/import/sources/__fixtures__/ethics-lobbyists.json'
import expenditures from '@/lib/import/sources/__fixtures__/ethics-expenditures.json'

let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('ethics_lobbyists parser', () => {
  it('parses registration rows', () => {
    const p = mod.parseRegistration(registrations[0] as Record<string, unknown>)!
    expect(p).toMatchObject({ lobbyist: 'Smith, John A.', client: 'Hawaii Gas', lobbyYear: '2025-2026', registrationDate: '2025-01-10', terminationDate: null, amended: false, url: 'https://ethics.hawaii.gov/docs/reg101.pdf' })
    expect(mod.parseRegistration(registrations[1] as Record<string, unknown>)).toMatchObject({ terminationDate: '2025-06-30', amended: true })
    expect(mod.parseRegistration(registrations[2] as Record<string, unknown>)).toMatchObject({ client: null, registrationDate: '2025-01-15' })
    expect(mod.parseRegistration(registrations[3] as Record<string, unknown>)).toBeNull()
  })
  it('parses expenditure rows for org and person filers', () => {
    expect(mod.parseExpenditure(expenditures[0] as Record<string, unknown>)).toMatchObject({ filer: 'Hawaii Gas', filerIsOrg: true, amount: 12500, payee: 'Pacific Media Group', category: 'Media Advertising' })
    expect(mod.parseExpenditure(expenditures[1] as Record<string, unknown>)).toMatchObject({ filer: 'Smith, John A.', filerIsOrg: false, amount: 45000, payee: null })
  })
})

describe('ethics_lobbyists CSV route', () => {
  it('finds the CSV downloads on a dataset page (not the CKAN API)', () => {
    const page = 'https://opendata.hawaii.gov/dataset/hawaii-state-ethics-commission-s-lobbyist-registration-statements'
    expect(mod.csvLinks(fixture('ethics/dataset-page.html'), page)).toEqual([
      'https://opendata.hawaii.gov/dataset/9f4e6414-dd04-40bf-88d2-31b5b8b6e8d3/resource/f186ec29-a1c8-4985-b92e-870b19db8211/download/socrata_-lobbyist-registration-statements.csv',
      'https://opendata.hawaii.gov/dataset/9f4e6414-dd04-40bf-88d2-31b5b8b6e8d3/resource/aed69d13-fe07-4e91-8abf-a51c8a408e1f/download/socrata_-lobbyist-registration-statements.csv',
    ])
    for (const u of Object.values(mod.DATASET_PAGES)) expect(u).not.toMatch(/\/api\/|\/datastore\//)
  })
  it('parses CSV rows with a content-hash id; equal rows share an id', () => {
    const rows = parseCsv(fixture('ethics/registrations.csv'))
    expect(rows).toHaveLength(4)
    const p = mod.parseRegistration(rows[0])!
    expect(p).toMatchObject({ lobbyist: 'Smith, John A.', client: 'Hawaii Gas', registrationDate: '2025-01-10', terminationDate: null, amended: false })
    expect(p.recordId).toMatch(/^[0-9a-f]{24}$/)
    expect(mod.parseRegistration({ ...rows[0] })!.recordId).toBe(p.recordId)
    expect(mod.parseRegistration(rows[1])!.recordId).not.toBe(p.recordId)
    expect(mod.parseRegistration({ 'FULL NAME': 'Pua, Leilani', 'lobby_year': '2025' })).toMatchObject({ lobbyist: 'Pua, Leilani', lobbyYear: '2025' })
    expect(mod.parseRegistration(rows[3])).toBeNull()
  })
  it('imports CSV rows idempotently', async () => {
    const csvDb = await createTestDb()
    try {
      const r = await runTwice(csvDb, mod, parseCsv(fixture('ethics/registrations.csv')), { dataset: 'registrations' }, 3)
      expect(r.edges).toBe(2)
    } finally { await csvDb.end() }
  })
})

describe('ethics_lobbyists importer', () => {
  it('creates lobbyists, resolves clients, and is idempotent', async () => {
    await db.query(`insert into entity (kind, name, aliases) values ('org', 'Hawaii Gas', '{}')`)
    const r = await runTwice(db, mod, registrations, { dataset: 'registrations', resource: 'reg' }, 3)
    expect(r.edges).toBe(2)
    const lobbyists = await db.many<{ name: string; attributes: Record<string, unknown> }>(`select name, attributes from entity where kind = 'person' order by name`)
    expect(lobbyists.map(l => l.name)).toEqual(['John A. Smith', 'Leilani Pua'])
    expect(lobbyists[0].attributes.entity_types).toEqual(['person', 'lobbyist'])
    const edges = await edgesFor(db, 'ethics_lobbyists')
    const byClient = Object.fromEntries(edges.map(e => [e.to_name_raw, e]))
    expect(byClient['Hawaii Gas']).toMatchObject({ type: 'lobbied_for', match_status: 'matched', start_date: '2025-01-10', end_date: '2026-12-31' })
    expect(byClient['Alexander & Baldwin, Inc.']).toMatchObject({ match_status: 'review', end_date: '2025-06-30' })
    expect(edges.find(e => e.to_name_raw === null)).toBeUndefined()
  })
  it('imports expenditure statements as spent_with edges', async () => {
    const r = await runTwice(db, mod, expenditures, { dataset: 'expenditures', resource: 'exp' })
    expect(r.edges).toBe(2)
    const edges = (await edgesFor(db, 'ethics_lobbyists')).filter(e => e.type === 'spent_with')
    expect(edges).toHaveLength(2)
    expect(edges.find(e => e.from_name_raw === 'Hawaii Gas')).toMatchObject({ amount: '12500.00', role: 'Media Advertising', start_date: '2025-01-01', end_date: '2025-12-31' })
    // Person filer already created by the registration run → matched
    expect(edges.find(e => e.from_name_raw === 'Smith, John A.')?.from_id).not.toBeNull()
  })
})
