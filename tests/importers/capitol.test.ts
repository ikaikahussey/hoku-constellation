import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as measures from '@/lib/import/sources/capitol-measures'
import * as testimony from '@/lib/import/sources/capitol-testimony'
import { runTwice, edgesFor } from './_harness'

const fx = (f: string) => readFileSync(new URL(`../../lib/import/sources/__fixtures__/${f}`, import.meta.url), 'utf8')
let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('capitol_measures parser', () => {
  it('extracts measure codes from a session list page', () => {
    expect(measures.parseMeasureList(fx('capitol-list.html'))).toEqual(['SB1234', 'HB567'])
  })
  it('parses a measure page: title, introducers, status history, referral', () => {
    const m = measures.parseMeasurePage(fx('capitol-measure.html'), '2026', 'https://x/SB1234')!
    expect(m).toMatchObject({ measure: 'SB1234', session: '2026', chamber: 'S', measureType: 'SB', title: 'RELATING TO ENERGY.', currentReferral: 'EET, CPN', companion: 'HB567', introducedDate: '2026-01-17' })
    expect(m.introducers).toEqual(['WAKAI', 'KEOHOKALOLE', 'INOUYE'])
    expect(m.statusHistory).toHaveLength(2)
    expect(m.currentStatus).toBe('Referred to EET, CPN.')
  })
})

describe('capitol_measures importer', () => {
  it('creates bill and legislators, sponsored edges with introducer order; idempotent', async () => {
    const m = measures.parseMeasurePage(fx('capitol-measure.html'), '2026', 'https://x/SB1234')!
    const r = await runTwice(db, measures, [m], { session: '2026' })
    expect(r.edges).toBe(3)
    expect(r.entitiesCreated).toBe(4)
    const bill = await db.one<{ attributes: Record<string, unknown>; identifiers: Record<string, string> }>(`select attributes, identifiers from entity where kind = 'bill'`)
    expect(bill?.identifiers.measure).toBe('2026:SB1234')
    expect(bill?.attributes).toMatchObject({ measure_number: 'SB1234', session: '2026', current_status: 'Referred to EET, CPN.' })
    const edges = await edgesFor(db, 'capitol_measures')
    expect(edges.every(e => e.match_status === 'matched' && e.type === 'sponsored')).toBe(true)
    expect(edges.find(e => e.from_name_raw === 'WAKAI')?.role).toBe('introducer')
    expect(edges.find(e => e.from_name_raw === 'INOUYE')?.role).toBe('co-introducer')
  })
  it('re-import with changed status updates the bill without duplicating', async () => {
    const m = measures.parseMeasurePage(fx('capitol-measure.html'), '2026', 'https://x/SB1234')!
    m.statusHistory.push({ date: '2026-02-10', chamber: 'S', text: 'Passed Second Reading.' })
    m.currentStatus = 'Passed Second Reading.'
    await measures.importBatch(db, 0, 10, { pageSource: async () => ({ records: [m], done: true }) as never, params: { session: '2026' } })
    const bills = await db.many<{ attributes: Record<string, unknown> }>(`select attributes from entity where kind = 'bill'`)
    expect(bills).toHaveLength(1)
    expect(bills[0].attributes.current_status).toBe('Passed Second Reading.')
    expect(await db.many(`select 1 from document where source = 'capitol_measures'`)).toHaveLength(1) // same source_record_id → updated in place
  })
})

describe('capitol_testimony parser', () => {
  it('splits a packet into testifiers with position and organization', () => {
    const t = testimony.parseTestifiers(fx('testimony-packet.txt'))
    const by = Object.fromEntries(t.map(x => [x.name, x]))
    expect(Object.keys(by).sort()).toEqual(['Jim Kelly', 'Melissa Miyashiro', 'Keoni Alana', 'Micah Munekata'].sort())
    expect(by['Jim Kelly']).toMatchObject({ org: 'Hawaiian Electric Company, Inc.', position: 'support', isOrg: false })
    expect(by['Melissa Miyashiro']).toMatchObject({ org: 'Blue Planet Foundation', position: 'support' })
    expect(by['Keoni Alana']).toMatchObject({ org: null, position: 'oppose', isOrg: false })
    expect(by['Micah Munekata']).toMatchObject({ org: 'Ulupono Initiative', position: 'comment' })
  })
  it('extracts packet links with committee and hearing date', () => {
    const links = testimony.parseTestimonyLinks(`<a href="/sessions/session2026/Testimony/SB1234_TESTIMONY_EET_02-04-26_.PDF">Testimony</a><a href="/x.pdf">other</a>`)
    expect(links).toEqual([{ url: 'https://www.capitol.hawaii.gov/sessions/session2026/Testimony/SB1234_TESTIMONY_EET_02-04-26_.PDF', committee: 'EET', hearingDate: '2026-02-04' }])
  })
})

describe('capitol_testimony importer', () => {
  it('writes testified_on edges per testifier and reuses the bill entity', async () => {
    await db.query(`insert into entity (kind, name, aliases) values ('org', 'Blue Planet Foundation', '{}')`)
    const packet: testimony.TestimonyPacket = {
      measure: 'SB1234', session: '2026', committee: 'EET', hearingDate: '2026-02-04', url: 'https://www.capitol.hawaii.gov/sessions/session2026/Testimony/SB1234_TESTIMONY_EET_02-04-26_.PDF',
      testifiers: testimony.parseTestifiers(fx('testimony-packet.txt')), text: fx('testimony-packet.txt'),
    }
    const r = await runTwice(db, testimony, [packet], { session: '2026' })
    expect(r.entitiesCreated).toBe(0) // bill already exists from the measures run
    const edges = await edgesFor(db, 'capitol_testimony')
    expect(edges).toHaveLength(7) // 4 testifiers + 3 organizations
    expect(edges.find(e => e.from_name_raw === 'Blue Planet Foundation')).toMatchObject({ role: 'support', match_status: 'matched' })
    expect(edges.find(e => e.from_name_raw === 'Jim Kelly')?.attributes.organization).toBe('Hawaiian Electric Company, Inc.')
    expect(edges.find(e => e.from_name_raw === 'Keoni Alana')).toMatchObject({ role: 'oppose', match_status: 'review' })
    expect(await db.many(`select 1 from entity where kind = 'bill'`)).toHaveLength(1)
  })
})
