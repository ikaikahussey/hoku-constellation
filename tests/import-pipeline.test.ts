import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import { canonicalize, recordChecksum, upsertDocument, resolveRef, insertEdge, processRecord, emptyResult, getCursor, setCursor, slugFor, type RecordPlan } from '@/lib/import/pipeline'
import { toIsoDate, toAmount, periodRange, looksLikeOrg, normalizeTmk, normalizeMeasure } from '@/lib/import/normalize'
import { parseRobots, isAllowed } from '@/lib/import/http'

let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('canonicalization and checksums', () => {
  it('is key-order independent and drops undefined', () => {
    expect(canonicalize({ b: 1, a: [{ d: 2, c: 3 }], e: undefined })).toBe('{"a":[{"c":3,"d":2}],"b":1}')
    expect(recordChecksum('csc', { a: 1, b: 2 })).toBe(recordChecksum('csc', { b: 2, a: 1 }))
    expect(recordChecksum('csc', { a: 1 })).not.toBe(recordChecksum('fec', { a: 1 }))
    expect(recordChecksum('csc', { a: 1 })).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('normalizers', () => {
  it('dates, amounts, periods', () => {
    expect(toIsoDate('2016-06-16T23:43:05')).toBe('2016-06-16')
    expect(toIsoDate('6/30/2025 18:37:54')).toBe('2025-06-30')
    expect(toIsoDate('12/5/2017')).toBe('2017-12-05')
    expect(toIsoDate('')).toBeNull()
    expect(toAmount('$1,234.56')).toBe(1234.56)
    expect(toAmount('(500)')).toBe(-500)
    expect(toAmount(100)).toBe(100)
    expect(toAmount('n/a')).toBeNull()
    expect(periodRange('2014-2016')).toEqual({ start: '2014-01-01', end: '2016-12-31' })
    expect(periodRange('2026')).toEqual({ start: '2026-01-01', end: '2026-12-31' })
    expect(normalizeTmk('1-5-001-001-0001')).toBe('150010010001')
    expect(normalizeMeasure('SB 1234 HD1')).toBe('SB1234')
    expect(looksLikeOrg('Hawaiian Electric Industries, Inc.')).toBe(true)
    expect(looksLikeOrg('Abbett, Richard E.')).toBe(false)
    expect(looksLikeOrg('Friends of Ed Case')).toBe(true)
  })
})

describe('robots.txt', () => {
  it('parses groups and matches the most specific rule', () => {
    const rules = parseRobots(`User-agent: *\nDisallow: /private/\nAllow: /private/open\nCrawl-delay: 2\n\nUser-agent: HokuInsiderBot\nDisallow: /nobots/`)
    expect(rules.disallow).toEqual(['/nobots/'])
    expect(isAllowed(rules, '/nobots/x')).toBe(false)
    expect(isAllowed(rules, '/api/3/action/x')).toBe(true)
    const star = parseRobots(`User-agent: *\nDisallow: /private/\nAllow: /private/open\nCrawl-delay: 2`)
    expect(isAllowed(star, '/private/secret')).toBe(false)
    expect(isAllowed(star, '/private/open/1')).toBe(true)
    expect(star.crawlDelay).toBe(2)
    expect(isAllowed(parseRobots(''), '/anything')).toBe(true)
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /*.pdf$'), '/x/y.pdf')).toBe(false)
  })
})

describe('write pipeline', () => {
  it('upserts documents idempotently and tracks source_record_id changes', async () => {
    const a = await upsertDocument(db, { source: 't', source_record_id: 'r1', doc_type: 'contribution', raw: { x: 1 } })
    const b = await upsertDocument(db, { source: 't', source_record_id: 'r1', doc_type: 'contribution', raw: { x: 1 } })
    expect(a.inserted).toBe(true); expect(b.inserted).toBe(false); expect(b.id).toBe(a.id)
    // Same source record with changed content: updated in place, same id
    const c = await upsertDocument(db, { source: 't', source_record_id: 'r1', doc_type: 'contribution', raw: { x: 2 } })
    expect(c.inserted).toBe(false); expect(c.id).toBe(a.id); expect(c.checksum).not.toBe(a.checksum)
    await expect(upsertDocument(db, { source: 't', doc_type: 'tweet' as never, raw: {} })).rejects.toThrow()
  })

  it('resolves refs: identifier match, fuzzy match, review, creation rules, merge redirect', async () => {
    const heco = (await db.one<{ id: string }>(`insert into entity(kind,name,identifiers,aliases) values ('org','Hawaiian Electric Industries','{"ein":"99-0208097"}','{"HEI"}') returning id`))!.id
    const old = (await db.one<{ id: string }>(`insert into entity(kind,name,merged_into_id) values ('org','Hawaiian Electric Ind', $1) returning id`, [heco]))!.id

    const byId = await resolveRef(db, { kind: 'org', rawName: 'HAWAIIAN ELEC INDUSTRIES', identifiers: { ein: '990208097' } })
    expect(byId).toMatchObject({ entityId: heco, status: 'matched', created: false })

    const fuzzy = await resolveRef(db, { kind: 'org', rawName: 'hawaiian electric industries inc' })
    expect(fuzzy).toMatchObject({ entityId: heco, status: 'matched' })

    const merged = await resolveRef(db, { kind: 'org', rawName: 'Hawaiian Electric Ind' })
    expect(merged.entityId).toBe(heco)
    expect(merged.entityId).not.toBe(old)

    const review = await resolveRef(db, { kind: 'org', rawName: 'Hawaiian Electric Industry' })
    expect(review.entityId === null || review.entityId === heco).toBe(true)

    const noCreate = await resolveRef(db, { kind: 'person', rawName: 'Totally New Person' })
    expect(noCreate).toMatchObject({ entityId: null, status: 'unmatched', created: false })

    const created = await resolveRef(db, { kind: 'org', rawName: 'New Org With EIN', identifiers: { ein: '11-1111111' } })
    expect(created.created).toBe(true)
    const again = await resolveRef(db, { kind: 'org', rawName: 'New Org With EIN', identifiers: { ein: '11-1111111' } })
    expect(again).toMatchObject({ entityId: created.entityId, created: false })

    const bill = await resolveRef(db, { kind: 'bill', rawName: 'SB1234 (2026)', identifiers: { capitol_measure: '2026:SB1234' }, attributes: { measure_number: 'SB1234', session: '2026' } })
    expect(bill.created).toBe(true)
    const billAgain = await resolveRef(db, { kind: 'bill', rawName: 'SB1234 (2026)', identifiers: { capitol_measure: '2026:SB1234' }, attributes: { measure_number: 'SB1234', session: '2026' } })
    expect(billAgain.entityId).toBe(bill.entityId)

    const roster = await resolveRef(db, { kind: 'person', rawName: 'Josh Green', createIfMissing: true, attributes: { office_held: 'Governor' } })
    expect(roster.created).toBe(true)
    const rosterAgain = await resolveRef(db, { kind: 'person', rawName: 'Green, Josh', createIfMissing: true })
    expect(rosterAgain.entityId).toBe(roster.entityId)
    expect(rosterAgain.created).toBe(false)
  })

  it('inserts edges once with correct match_status, and processRecord counts correctly', async () => {
    const acc = emptyResult(0)
    const plan: RecordPlan = {
      document: { source: 't2', source_record_id: 'c1', doc_type: 'contribution' as const, raw: { id: 'c1', amount: 100 }, doc_date: '2024-01-01' },
      edges: async ({ db: d, created }) => {
        const from = await resolveRef(d, { kind: 'person', rawName: 'Unknown Donor' })
        const to = await resolveRef(d, { kind: 'org', rawName: 'Hawaiian Electric Industries' })
        if (from.created || to.created) created()
        return [{ type: 'contributed_to' as const, from, to, amount: 100, start_date: '2024-01-01', attributes: { election_period: '2024' } }]
      },
    }
    await processRecord(db, plan, acc)
    expect(acc).toMatchObject({ seen: 1, documents: 1, edges: 1, entitiesCreated: 0 })
    await processRecord(db, plan, acc)
    expect(acc).toMatchObject({ seen: 2, documents: 1, edges: 1 })
    const edge = await db.one<{ match_status: string; from_id: string | null; to_id: string | null; from_name_raw: string }>(
      `select match_status, from_id, to_id, from_name_raw from edge e join document d on d.id = e.document_id where d.source = 't2'`)
    expect(edge).toMatchObject({ match_status: 'review', from_id: null, from_name_raw: 'Unknown Donor' })
    expect(edge!.to_id).not.toBeNull()

    const doc = await upsertDocument(db, { source: 't2', source_record_id: 'm1', doc_type: 'article', raw: { t: 1 } })
    const ok = await insertEdge(db, doc.id, { type: 'mentioned_in', from: { entityId: edge!.to_id!, rawName: 'HEI' }, to: null, role: 'subject' })
    expect(ok).toBe(true)
    await expect(insertEdge(db, doc.id, { type: 'voted_on', from: { entityId: null, rawName: 'X', status: 'unmatched', confidence: null, created: false }, to: null })).rejects.toThrow()
  })

  it('cursor round-trips and merges metadata', async () => {
    expect(await getCursor(db, 'x')).toMatchObject({ cursor_offset: 0, status: null })
    await setCursor(db, 'x', 500, 'running', { a: 1 })
    await setCursor(db, 'x', 1000, 'complete', { b: 2 })
    const c = await getCursor(db, 'x')
    expect(c.cursor_offset).toBe(1000)
    expect(c.status).toBe('complete')
    expect(c.metadata).toMatchObject({ a: 1, b: 2 })
  })

  it('slugs handle Hawaiian orthography', () => {
    expect(slugFor('Kauaʻi Island Utility Coöperative')).toBe('kauai-island-utility-cooperative')
    expect(slugFor('TMK 1-5-001', { tmk: '150010010001' })).toBe('tmk-1-5-001-150010010001')
  })
})
