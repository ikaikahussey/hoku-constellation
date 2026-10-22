/**
 * Tests for profile-facts (edge → fact conversion) and fact-check (summary verification).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import { edgeToFact, edgesToFacts, profileToFacts } from '@/lib/ai/profile-facts'
import { factCheckSummary, type FactCheckResult } from '@/lib/ai/fact-check'
import type { EdgeView } from '@/lib/analytics/types'

let db: TestDb
const S: Record<string, string> = {}

let n = 0
const ent = async (kind: string, name: string, identifiers: object = {}, attributes: object = {}) =>
  (await db.one<{ id: string }>(`insert into entity(kind, name, identifiers, attributes) values ($1,$2,$3,$4) returning id`, [kind, name, JSON.stringify(identifiers), JSON.stringify(attributes)]))!.id
const doc = async (source: string, doc_type: string, title: string, doc_date: string | null) =>
  (await db.one<{ id: string }>(`insert into document(source, source_record_id, doc_type, title, doc_date, raw, checksum) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [source, null, doc_type, title, doc_date, '{}', `seed${n++}`.padEnd(64, '0')]))!.id
const edge = async (type: string, from: string, to: string, docId: string, extra: { role?: string; amount?: number; start?: string } = {}) => {
  await db.query(`insert into edge(type, from_id, to_id, document_id, role, amount, start_date, attributes, match_status, from_name_raw, to_name_raw)
    values ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb,'matched',(select name from entity where id = $2),(select name from entity where id = $3))`,
    [type, from, to, docId, extra.role ?? null, extra.amount ?? null, extra.start ?? null])
}

beforeAll(async () => {
  db = await createTestDb()
  S.person = await ent('person', 'Jane Kahaleʻokalani Doe', {}, { slug: 'jane-doe' })
  S.org = await ent('org', 'Acme Corp', {}, { slug: 'acme-corp' })
  S.committee = await ent('org', 'Senate Commerce Committee', {})
  S.bill = await ent('bill', 'SB42 (2027)', { measure: '2027:SB42' })
  S.parcel = await ent('parcel', 'TMK 1-2-3-004', { tmk: '1-2-3-004' })

  S.doc1 = await doc('fec', 'contribution', 'FEC filing', '2027-01-15')
  S.doc2 = await doc('csc', 'filing', 'Corp filing', '2027-03-01')
  S.doc3 = await doc('ethics-lobbyists', 'lobbyist_registration', 'Lobby reg', '2027-02-10')
  S.doc4 = await doc('capitol_measures', 'testimony', 'Testimony SB42', '2027-02-20')
  S.doc5 = await doc('usaspending', 'contract', 'Federal contract', '2026-11-01')

  await edge('contributed_to', S.person, S.org, S.doc1, { amount: 5000, start: '2027-01-15' })
  await edge('officer_of', S.person, S.org, S.doc2, { role: 'President', start: '2027-03-01' })
  await edge('lobbied_for', S.person, S.committee, S.doc3, { start: '2027-02-10' })
  await edge('testified_on', S.person, S.bill, S.doc4, { role: 'support', start: '2027-02-20' })
  await edge('awarded_contract', S.committee, S.org, S.doc5, { amount: 125000, start: '2026-11-01' })
  await edge('owns', S.person, S.parcel, S.doc2, { start: '2027-03-01' })
})

afterAll(async () => { await db.end() })

// ---------------------------------------------------------------- edgeToFact

describe('edgeToFact', () => {
  it('formats contributed_to with amount and date', async () => {
    const edges = await db.many<EdgeView>(
      `select e.*, f.name from_name, f.kind from_kind, f.attributes->>'slug' from_slug,
              t.name to_name, t.kind to_kind, t.attributes->>'slug' to_slug,
              d.source doc_source, d.doc_type, d.title doc_title, d.url doc_url, d.doc_date
         from edge e left join entity f on f.id = e.from_id left join entity t on t.id = e.to_id
         join document d on d.id = e.document_id
        where e.type = 'contributed_to' and e.from_id = $1`, [S.person])

    expect(edges).toHaveLength(1)
    const fact = edgeToFact(edges[0], S.person)
    expect(fact).not.toBeNull()
    expect(fact!.text).toContain('Jane')
    expect(fact!.text).toContain('$5,000')
    expect(fact!.text).toContain('Acme Corp')
    // Date may be formatted by PGlite as a JS Date string; just check year is present
    expect(fact!.text).toContain('2027')
    expect(fact!.documentId).toBe(S.doc1)
    expect(fact!.kind).toBe('contributed_to')
  })

  it('formats officer_of with role', async () => {
    const edges = await db.many<EdgeView>(
      `select e.*, f.name from_name, f.kind from_kind, f.attributes->>'slug' from_slug,
              t.name to_name, t.kind to_kind, t.attributes->>'slug' to_slug,
              d.source doc_source, d.doc_type, d.title doc_title, d.url doc_url, d.doc_date
         from edge e left join entity f on f.id = e.from_id left join entity t on t.id = e.to_id
         join document d on d.id = e.document_id
        where e.type = 'officer_of' and e.from_id = $1`, [S.person])

    const fact = edgeToFact(edges[0], S.person)
    expect(fact!.text).toContain('officer')
    expect(fact!.text).toContain('President')
    expect(fact!.text).toContain('Acme Corp')
  })

  it('returns null when no document_id', () => {
    const fake = { type: 'contributed_to', document_id: '', from_name: 'A', to_name: 'B' } as EdgeView
    expect(edgeToFact(fake, 'x')).toBeNull()
  })
})

// ---------------------------------------------------------------- edgesToFacts

describe('edgesToFacts', () => {
  it('deduplicates by document + text', async () => {
    const edges = await db.many<EdgeView>(
      `select e.*, f.name from_name, f.kind from_kind, f.attributes->>'slug' from_slug,
              t.name to_name, t.kind to_kind, t.attributes->>'slug' to_slug,
              d.source doc_source, d.doc_type, d.title doc_title, d.url doc_url, d.doc_date
         from edge e left join entity f on f.id = e.from_id left join entity t on t.id = e.to_id
         join document d on d.id = e.document_id
        where e.from_id = $1 or e.to_id = $1`, [S.person])

    // Pass the same edges twice — dedup should keep count stable
    const facts = edgesToFacts([...edges, ...edges], S.person)
    expect(facts.length).toBe(edges.length)
    for (const f of facts) {
      expect(f.documentId).toBeTruthy()
      expect(f.text.length).toBeGreaterThan(10)
    }
  })
})

// ---------------------------------------------------------------- profileToFacts

describe('profileToFacts', () => {
  it('assembles facts for a person entity', async () => {
    const entity = await db.one<{ id: string; kind: 'person'; name: string }>(`select * from entity where id = $1`, [S.person])
    const facts = await profileToFacts(db, entity! as any)
    expect(facts.length).toBeGreaterThanOrEqual(4)
    const types = new Set(facts.map(f => f.kind))
    expect(types.has('contributed_to')).toBe(true)
    expect(types.has('officer_of')).toBe(true)
    expect(types.has('lobbied_for')).toBe(true)
    expect(types.has('testified_on')).toBe(true)
  })

  it('returns empty for bill entities', async () => {
    const entity = await db.one<any>(`select * from entity where id = $1`, [S.bill])
    const facts = await profileToFacts(db, entity!)
    expect(facts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- factCheckSummary

describe('factCheckSummary', () => {
  it('passes a well-cited summary', async () => {
    const result = await factCheckSummary(db, {
      entityId: S.person,
      body: `Jane Kahaleʻokalani Doe contributed $5,000 to Acme Corp in 2027-01-15. Doe is an officer of Acme Corp.`,
      cites: [S.doc1, S.doc2],
      entityName: 'Jane Kahaleʻokalani Doe',
    })
    expect(result.passed).toBe(true)
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  it('flags missing citations', async () => {
    const result = await factCheckSummary(db, {
      entityId: S.person,
      body: 'Jane Doe did something important.',
      cites: [],
      entityName: 'Jane Kahaleʻokalani Doe',
    })
    expect(result.issues.some(i => i.category === 'missing_citation')).toBe(true)
  })

  it('flags invalid document IDs', async () => {
    const result = await factCheckSummary(db, {
      entityId: S.person,
      body: 'Jane Doe contributed to Acme Corp.',
      cites: ['00000000-0000-0000-0000-000000000000'],
      entityName: 'Jane Kahaleʻokalani Doe',
    })
    expect(result.issues.some(i => i.category === 'invalid_document')).toBe(true)
    expect(result.passed).toBe(false)
  })

  it('warns on amount mismatch', async () => {
    const result = await factCheckSummary(db, {
      entityId: S.person,
      body: 'Jane Doe contributed $99,999 to Acme Corp.',
      cites: [S.doc1],
      entityName: 'Jane Kahaleʻokalani Doe',
    })
    expect(result.issues.some(i => i.category === 'amount_mismatch')).toBe(true)
  })

  it('warns on unknown entity name', async () => {
    const result = await factCheckSummary(db, {
      entityId: S.person,
      body: 'Jane Doe met with Zephyron Moonbeam Holdings to discuss funding.',
      cites: [S.doc1],
      entityName: 'Jane Kahaleʻokalani Doe',
    })
    expect(result.issues.some(i => i.category === 'unknown_name')).toBe(true)
  })

  it('warns when entity name is not mentioned', async () => {
    const result = await factCheckSummary(db, {
      entityId: S.person,
      body: 'Someone contributed to an organization.',
      cites: [S.doc1],
      entityName: 'Jane Kahaleʻokalani Doe',
    })
    expect(result.issues.some(i => i.category === 'wrong_entity')).toBe(true)
  })

  it('reports stats correctly', async () => {
    const result = await factCheckSummary(db, {
      entityId: S.person,
      body: 'Jane Doe contributed $5,000 to Acme Corp.',
      cites: [S.doc1, S.doc2],
      entityName: 'Jane Kahaleʻokalani Doe',
    })
    expect(result.stats.citedDocCount).toBe(2)
    expect(result.stats.validDocCount).toBe(2)
    expect(result.stats.edgeCount).toBeGreaterThanOrEqual(4)
    expect(result.stats.sentenceCount).toBe(1)
  })
})
