import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as sec from '@/lib/import/sources/sec-edgar'
import { runTwice, edgesFor } from './_harness'
import submissions from '@/lib/import/sources/__fixtures__/sec-submissions.json'

const html = readFileSync(new URL('../../lib/import/sources/__fixtures__/def14a.html', import.meta.url), 'utf8')
let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('sec_edgar', () => {
  it('defaults to verified Hawaiʻi registrants, not the look-alike CIKs', () => {
    expect(sec.DEFAULT_CIKS).toContain('0000354707') // Hawaiian Electric Industries
    expect(sec.DEFAULT_CIKS).toContain('0001545654') // Alexander & Baldwin
    expect(sec.DEFAULT_CIKS).toContain('0000003453') // Matson
    for (const wrong of ['0000046619', '0000003906', '0001616862']) expect(sec.DEFAULT_CIKS).not.toContain(wrong) // HEICO, Allied Capital, Axalta
    for (const cik of sec.DEFAULT_CIKS) expect(cik).toMatch(/^\d{10}$/)
  })
  it('finds the latest DEF 14A and builds the archive URL', () => {
    const def = sec.latestDef14a(submissions as sec.Submissions)!
    expect(def).toEqual({ accession: '0000354707-26-000005', date: '2026-03-20', doc: 'he-def14a.htm' })
    expect(sec.archiveUrl('354707', def.accession, def.doc)).toBe('https://www.sec.gov/Archives/edgar/data/354707/000035470726000005/he-def14a.htm')
  })
  it('parses the director/officer table, deduplicating names and skipping totals', () => {
    expect(sec.parseDef14aPeople(html)).toEqual([
      { name: 'Scott W. H. Seu', title: 'President, Chief Executive Officer and Director', age: 57 },
      { name: 'Celeste A. Connors', title: 'Director', age: 52 },
    ])
  })
  it('imports: org by CIK, officer/director edges, body text stored; idempotent', async () => {
    const r = await runTwice(db, sec, [{ submissions, proxyHtml: html }], { skipProxy: '0' })
    expect(r.entitiesCreated).toBe(1)
    const edges = await edgesFor(db, 'sec_edgar')
    expect(edges.map(e => [e.from_name_raw, e.type])).toEqual([['Celeste A. Connors', 'director_of'], ['Scott W. H. Seu', 'director_of']])
    const doc = await db.one<{ body_text: string; doc_date: string }>(`select body_text, doc_date::text doc_date from document where source = 'sec_edgar'`)
    expect(doc?.body_text).toContain('PROXY STATEMENT')
    expect(doc?.doc_date).toBe('2026-03-20')
    const org = await db.one<{ identifiers: Record<string, string> }>(`select identifiers from entity where kind = 'org'`)
    expect(org?.identifiers.sec_cik).toBe('0000354707')
  })
})
