import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import {
  normalize, normalizeOrg, canonicalPersonName, matchEntity, autoMatchThreshold,
  matchByIdentifier, matchByIdentifiers, fuzzyMatch, resolveEntity, followMerge,
} from '@/lib/entity-match'

describe('normalize', () => {
  it('collapses ʻokina variants', () => {
    const forms = ['Kauaʻi', 'Kauai', "Kaua'i", 'Kaua‘i', 'Kaua’i', 'Kaua`i']
    const keys = new Set(forms.map(normalize))
    expect(keys.size).toBe(1)
  })
  it('collapses kahakō including uppercase', () => {
    expect(normalize('Hāna')).toBe(normalize('Hana'))
    expect(normalize('HĀNA')).toBe('hana')
    expect(normalize('Kāneʻohe')).toBe('kaneohe')
    expect(normalize('Ōlelo Ēīōū')).toBe('olelo eiou')
  })
  it('collapses Oʻahu variants', () => {
    const forms = ['Oʻahu', 'Oahu', "O'ahu", 'O‘ahu', 'OʻAHU']
    expect(new Set(forms.map(normalize)).size).toBe(1)
  })
  it('normalizes org suffixes', () => {
    expect(normalizeOrg('Hawaiian Electric Industries, Inc.')).toBe('hawaiian electric industries')
    expect(normalizeOrg('The Queen\'s Health Systems')).toBe('queens health systems')
    expect(normalizeOrg('Alexander & Baldwin LLC')).toBe('alexander and baldwin')
  })
  it('reorders Last, First names', () => {
    expect(canonicalPersonName('Case, Ed')).toBe('Ed Case')
    expect(canonicalPersonName('Abbett, Richard E. ')).toBe('Richard E. Abbett')
    expect(canonicalPersonName('Ed Case')).toBe('Ed Case')
  })
})

describe('matchEntity (pure)', () => {
  const people = [
    { id: 'p1', name: 'Ed Case', aliases: ['Edward Case'] },
    { id: 'p2', name: 'Brian Schatz', aliases: [] },
    { id: 'p3', name: 'Mazie Hirono', aliases: ['Mazie K. Hirono'] },
  ]
  it('matches exact and Last, First forms at 1.0', () => {
    expect(matchEntity('Case, Ed', people)[0]).toMatchObject({ id: 'p1', confidence: 1 })
    expect(matchEntity('edward case', people)[0]).toMatchObject({ id: 'p1', confidence: 1 })
  })
  it('returns review-band matches for near misses and nothing for distant names', () => {
    const r = matchEntity('Brian Schats', people)
    expect(r[0].id).toBe('p2')
    expect(r[0].confidence).toBeLessThan(0.95)
    expect(r[0].confidence).toBeGreaterThanOrEqual(0.7)
    expect(matchEntity('Josh Green', people)).toHaveLength(0)
  })
  it('thresholds', () => {
    expect(autoMatchThreshold(1)).toBe('matched')
    expect(autoMatchThreshold(0.95)).toBe('matched')
    expect(autoMatchThreshold(0.8)).toBe('review')
    expect(autoMatchThreshold(0.5)).toBe('unmatched')
  })
})

describe('database-backed resolution', () => {
  let db: TestDb
  let heco: string, hecoOld: string, edCase: string, kauai: string
  beforeAll(async () => {
    db = await createTestDb()
    heco = (await db.one<{ id: string }>(`insert into entity(kind,name,aliases,identifiers) values ('org','Hawaiian Electric Industries, Inc.','{"HEI","Hawaiian Electric"}','{"ein":"99-0208097","sec_cik":"0000354707"}') returning id`))!.id
    hecoOld = (await db.one<{ id: string }>(`insert into entity(kind,name,merged_into_id) values ('org','Hawaiian Electric Industries Inc', $1) returning id`, [heco]))!.id
    edCase = (await db.one<{ id: string }>(`insert into entity(kind,name,identifiers) values ('person','Ed Case','{"fec_id":"H6HI02164"}') returning id`))!.id
    kauai = (await db.one<{ id: string }>(`insert into entity(kind,name) values ('org','County of Kauaʻi') returning id`))!.id
    await db.query(`insert into entity(kind,name) values ('person','Edwin Casey')`)
    await db.query(`insert into entity(kind,name) values ('org','Case Construction Co')`)
  })
  afterAll(async () => { await db.end() })

  it('matches by identifier, digits-only tolerant, and follows merges', async () => {
    expect((await matchByIdentifier(db, 'ein', '99-0208097'))?.entityId).toBe(heco)
    expect((await matchByIdentifier(db, 'ein', '990208097'))?.entityId).toBe(heco)
    expect((await matchByIdentifier(db, 'sec_cik', '354707'))).toBeNull() // no zero-padding guesses
    expect((await matchByIdentifier(db, 'fec_id', 'H6HI02164', 'person'))?.entityId).toBe(edCase)
    expect((await matchByIdentifier(db, 'fec_id', 'H6HI02164', 'org'))).toBeNull()
    expect((await matchByIdentifiers(db, { dcca: null, ein: '99-0208097' }, 'org'))?.scheme).toBe('ein')
    expect(await followMerge(db, hecoOld)).toBe(heco)
  })

  it('fuzzy matches within kind and respects Hawaiian orthography', async () => {
    const r = await fuzzyMatch(db, 'County of Kauai', { kind: 'org' })
    expect(r[0]).toMatchObject({ id: kauai, confidence: 1 })
    const r2 = await fuzzyMatch(db, "County of Kaua'i", { kind: 'org' })
    expect(r2[0].id).toBe(kauai)
    const wrongKind = await fuzzyMatch(db, 'Ed Case', { kind: 'org' })
    expect(wrongKind.find(c => c.id === edCase)).toBeUndefined()
  })

  it('resolveEntity routes: identifier → matched, exact fuzzy → matched, near → review, far → unmatched', async () => {
    const byId = await resolveEntity(db, { kind: 'org', rawName: 'Some Other Name', identifiers: { ein: '99-0208097' } })
    expect(byId).toMatchObject({ entityId: heco, status: 'matched', via: 'identifier' })

    const exact = await resolveEntity(db, { kind: 'person', rawName: 'Case, Ed' })
    expect(exact).toMatchObject({ entityId: edCase, status: 'matched', via: 'fuzzy' })

    const near = await resolveEntity(db, { kind: 'org', rawName: 'Hawaiian Electric Industry' })
    expect(near.status === 'review' || near.status === 'matched').toBe(true)
    if (near.status === 'review') expect(near.entityId).toBeNull()

    const far = await resolveEntity(db, { kind: 'person', rawName: 'Zebulon Quixote' })
    expect(far).toMatchObject({ entityId: null, status: 'unmatched' })
  })

  it('redirects merged entities to the survivor', async () => {
    const r = await resolveEntity(db, { kind: 'org', rawName: 'Hawaiian Electric Industries Inc' })
    expect(r.entityId).toBe(heco)
  })
})
