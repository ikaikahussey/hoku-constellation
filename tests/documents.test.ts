import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import { listDocuments, documentFacets } from '@/lib/db/queries/documents'
import { PAID_DOC_TYPES } from '@/lib/db/gating'
import { sourceLabel, sourceTitle, docTypeLabel } from '@/components/documents/labels'

let db: TestDb
const sha = (s: string) => s.padEnd(64, '0')

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    insert into entity (id, kind, name) values
      ('00000000-0000-4000-8000-000000000001', 'person', 'Josh Green'),
      ('00000000-0000-4000-8000-000000000002', 'org', 'Hawaiian Electric');
    insert into document (id, source, source_record_id, doc_type, title, doc_date, body_text, checksum, raw) values
      ('00000000-0000-4000-8000-00000000000a', 'sec_edgar', 'sec:1', 'sec_filing', 'HEI DEF 14A', '2026-03-20', 'Proxy statement naming directors.', '${sha('a')}', '{}'),
      ('00000000-0000-4000-8000-00000000000b', 'csc', 'csc:2', 'contribution', 'HEI PAC → Green', '2022-03-15', null, '${sha('b')}', '{}'),
      ('00000000-0000-4000-8000-00000000000c', 'capitol_measures', 'SB1234', 'measure', 'SB1234 RELATING TO ENERGY', '2026-01-17', 'A bill for an act relating to energy.', '${sha('c')}', '{}'),
      ('00000000-0000-4000-8000-00000000000d', 'capitol_measures', 'HB1', 'measure', null, null, null, '${sha('d')}', '{}');
    insert into edge (document_id, type, from_id, to_id, from_name_raw, to_name_raw, match_status) values
      ('00000000-0000-4000-8000-00000000000a', 'director_of', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Green', 'HEI', 'matched'),
      ('00000000-0000-4000-8000-00000000000a', 'officer_of', null, '00000000-0000-4000-8000-000000000002', 'Scott Seu', 'HEI', 'unmatched'),
      ('00000000-0000-4000-8000-00000000000b', 'contributed_to', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'HEI PAC', 'Green', 'matched');
  `)
})
afterAll(async () => { await db.end() })

const ids = (rows: { id: string }[]) => rows.map(r => r.id.slice(-1))

describe('listDocuments', () => {
  it('lists newest first with edge counts and excerpts, nulls last', async () => {
    const { rows, total } = await listDocuments(db)
    expect(total).toBe(4)
    expect(ids(rows)).toEqual(['a', 'c', 'b', 'd'])
    expect(rows[0].edge_count).toBe(2)
    expect(rows[0].excerpt).toBe('Proxy statement naming directors.')
    expect(rows[3].edge_count).toBe(0)
  })
  it('searches title, record id and body text case-insensitively', async () => {
    expect(ids((await listDocuments(db, { q: 'def 14a' })).rows)).toEqual(['a'])
    expect(ids((await listDocuments(db, { q: 'hb1' })).rows)).toEqual(['d'])
    expect(ids((await listDocuments(db, { q: 'relating to energy' })).rows)).toEqual(['c'])
    expect((await listDocuments(db, { q: 'zzz-nothing' })).total).toBe(0)
  })
  it('filters by source, type and date range', async () => {
    expect(ids((await listDocuments(db, { sources: ['capitol_measures'] })).rows)).toEqual(['c', 'd'])
    expect(ids((await listDocuments(db, { docTypes: ['sec_filing', 'contribution'] })).rows)).toEqual(['a', 'b'])
    expect(ids((await listDocuments(db, { from: '2026-01-01' })).rows)).toEqual(['a', 'c'])
    expect(ids((await listDocuments(db, { from: '2022-01-01', to: '2022-12-31' })).rows)).toEqual(['b'])
    // malformed dates are ignored rather than passed to SQL
    expect((await listDocuments(db, { from: "2026' or 1=1 --" })).total).toBe(4)
  })
  it('hides excluded (gated) doc types from results and facets', async () => {
    const gated = [...PAID_DOC_TYPES]
    const { rows, total } = await listDocuments(db, { excludeDocTypes: gated })
    expect(total).toBe(3)
    expect(ids(rows)).not.toContain('b')
    const facets = await documentFacets(db, { excludeDocTypes: gated })
    expect(facets.docTypes.map(f => f.value)).toEqual(['measure', 'sec_filing'])
    expect(facets.sources.find(f => f.value === 'csc')).toBeUndefined()
  })
  it('paginates with a stable total', async () => {
    const p1 = await listDocuments(db, { limit: 3, offset: 0 })
    const p2 = await listDocuments(db, { limit: 3, offset: 3 })
    expect(p1.rows).toHaveLength(3)
    expect(p2.rows).toHaveLength(1)
    expect(p2.total).toBe(4)
  })
})

describe('documentFacets', () => {
  it('counts per source and type, each ignoring its own filter', async () => {
    const f = await documentFacets(db, { sources: ['csc'] })
    // source facet ignores the source filter so alternatives stay visible
    expect(f.sources).toEqual([{ value: 'capitol_measures', n: 2 }, { value: 'csc', n: 1 }, { value: 'sec_edgar', n: 1 }])
    // type facet respects the source filter
    expect(f.docTypes).toEqual([{ value: 'contribution', n: 1 }])
  })
  it('applies the text and date filters to both facets', async () => {
    const f = await documentFacets(db, { q: 'energy', from: '2026-01-01' })
    expect(f.sources).toEqual([{ value: 'capitol_measures', n: 1 }])
    expect(f.docTypes).toEqual([{ value: 'measure', n: 1 }])
  })
})

describe('document labels', () => {
  it('names sources from the registry, including the keys the legacy port wrote', () => {
    expect(sourceLabel('csc')).toBe('Campaign Spending Commission')
    expect(sourceLabel('hawaii_csc')).toBe('Campaign Spending Commission')
    expect(sourceLabel('hawaii_ethics')).toBe('State Ethics Commission')
    expect(sourceLabel('hawaii_puc')).toBe('Public Utilities Commission')
    expect(sourceLabel('legacy_timeline')).toBe('Editorial timeline')
    expect(sourceLabel('unknown_key')).toBe('unknown key')
    expect(sourceTitle('sec_edgar')).toContain('SEC EDGAR')
    expect(docTypeLabel('lobbyist_registration')).toBe('lobbyist registration')
  })
})
