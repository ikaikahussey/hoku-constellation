import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as mod from '@/lib/import/sources/ethics-lobbyists'
import { runTwice, edgesFor } from './_harness'
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
