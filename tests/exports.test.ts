/**
 * E7/E10 — CSV export (quoting, formula injection, every list view) and the ICS feed (RFC 5545
 * structure, parse by ical.js, secret URL rotation invalidates the old URL).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import ICAL from 'ical.js'
import { createTestDb, type TestDb } from './helpers/pglite'
import { createTeam } from '@/lib/teams'
import { csvCell, toCsv } from '@/lib/export/csv'
import { buildCalendar, escapeText, fold } from '@/lib/export/ics'
import { rotateCalendarToken, userCalendar, userForCalendarToken, calendarUrl } from '@/lib/export/calendar'
import { exportRows, EXPORT_KINDS } from '@/lib/export/lists'

let db: TestDb
const S: Record<string, string> = {}
beforeAll(async () => {
  db = await createTestDb()
  const t = await createTeam(db, 'cal_user', 'Calendar team')
  await db.query(`update app.team set plan = 'pro', subscription_status = 'active' where id = $1`, [t.id])
  const wl = (await db.one<{ id: string }>(`select id from app.watchlist where team_id = $1`, [t.id]))!.id
  const mk = async (name: string, status: string) => (await db.one<{ id: string }>(
    `insert into entity(kind, name, identifiers, attributes) values ('bill', $1, $2, $3) returning id`,
    [name, JSON.stringify({ measure: `2027:${name.split(' ')[0]}` }), JSON.stringify({ measure_number: name.split(' ')[0], session: '2027', title: 'RELATING TO WATER; AND, ESCAPES.', current_status: status })]))!.id
  S.b1 = await mk('HB5 (2027)', 'Bill scheduled to be heard by WAL, EEP on Wednesday, 02-24-27 9:00AM in House conference room 430.')
  S.b2 = await mk('SB7 (2027)', 'The hearing on this measure scheduled for 02-25-27 1:00PM in conference room 225 has been cancelled.')
  S.b3 = await mk('HB9 (2027)', 'Referred to FIN.')
  for (const b of [S.b1, S.b2, S.b3]) await db.query(`insert into app.watchlist_item(watchlist_id, entity_id) values ($1, $2)`, [wl, b])
  const doc = (await db.one<{ id: string }>(`insert into document(source, doc_type, title, raw, checksum) values ('capitol_votes','vote','Vote','{}','v1') returning id`))!.id
  const rep = (await db.one<{ id: string }>(`insert into entity(kind, name) values ('person', '=HYPERLINK("http://x")') returning id`))!.id
  await db.query(`insert into edge(type, from_id, to_id, document_id, role, match_status, start_date, attributes) values ('voted_on', $1, $2, $3, 'aye', 'matched', '2027-02-10', '{"committee":"WAL"}')`, [rep, S.b1, doc])
  S.rep = rep
})
afterAll(async () => { await db.end() })

describe('CSV', () => {
  it('quotes per RFC 4180 and neutralizes spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
    expect(csvCell('=SUM(A1)')).toBe(`'=SUM(A1)`)
    expect(csvCell('+1 808')).toBe(`'+1 808`)
    expect(csvCell('@cmd')).toBe(`'@cmd`)
    expect(csvCell('-42.5')).toBe('-42.5')
    expect(csvCell(null)).toBe('')
    const csv = toCsv([{ a: 1, b: 'Kaʻōnohi' }])
    expect(csv).toBe('﻿a,b\r\n1,Kaʻōnohi\r\n')
  })

  it('exports every list view with source document ids', async () => {
    const bills = await exportRows(db, 'bills', new URLSearchParams(), 'cal_user')
    expect(bills.rows.map(r => r.measure).sort()).toEqual(['HB5', 'HB9', 'SB7'])
    expect(bills.rows.find(r => r.measure === 'HB5')!.next_hearing).toBe('2027-02-24T19:00:00.000Z')
    expect(bills.rows.find(r => r.measure === 'SB7')!.next_hearing).toBe('')
    const votes = await exportRows(db, 'votes', new URLSearchParams({ bill: S.b1 }), 'cal_user')
    const csv = toCsv(votes.rows, votes.columns)
    expect(csv.split('\r\n')[0]).toBe('﻿date,committee,name,vote,source_title,source_url,source_document_id')
    expect(csv).toContain(`2027-02-10,WAL,"'=HYPERLINK(""http://x"")",aye`)
    expect((await exportRows(db, 'contributions', new URLSearchParams({ entity: S.rep }), 'cal_user')).rows).toEqual([])
    expect((await exportRows(db, 'testimony', new URLSearchParams({ bill: S.b1 }), 'cal_user')).rows).toEqual([])
    expect((await exportRows(db, 'search', new URLSearchParams({ q: 'HB5' }), 'cal_user')).rows[0].name).toBe('HB5 (2027)')
    expect((await exportRows(db, 'documents', new URLSearchParams(), 'cal_user')).rows.length).toBe(1)
    expect(EXPORT_KINDS).toContain('search')
    await expect(exportRows(db, 'votes', new URLSearchParams({ bill: 'x' }), 'cal_user')).rejects.toThrow(/bill parameter/)
  })
})

describe('ICS feed (RFC 5545)', () => {
  const NOW = new Date('2027-02-20T00:00:00Z')

  it('writes a valid calendar: CRLF, folded lines ≤ 75 octets, escaped text, required properties', async () => {
    const ics = await userCalendar(db, 'cal_user', NOW)
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:/)
    expect((unfolded.match(/BEGIN:VEVENT/g) ?? []).length).toBe((unfolded.match(/END:VEVENT/g) ?? []).length)
    for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
      for (const prop of ['UID:', 'DTSTAMP:', 'DTSTART']) expect(block).toContain(prop)
    }
    expect(unfolded).toContain('RELATING TO WATER\\; AND\\, ESCAPES.')

    const comp = new ICAL.Component(ICAL.parse(ics))
    const events = comp.getAllSubcomponents('vevent').map(v => new ICAL.Event(v))
    expect(events.map(e => e.summary).sort()).toEqual([
      'CANCELED: Committee hearing: SB7 (2027)',
      'Testimony due: HB5 (2027) (WAL/EEP)',
      'WAL/EEP hearing: HB5 (2027)',
    ].sort())
    const hearing = events.find(e => e.summary.startsWith('WAL'))!
    expect(hearing.startDate.toJSDate().toISOString()).toBe('2027-02-24T19:00:00.000Z')
    expect(hearing.location).toBe('State Capitol, Room 430')
    expect(new Set(events.map(e => e.uid)).size).toBe(events.length)
    expect(comp.getAllSubcomponents('vevent').find(v => v.getFirstPropertyValue('summary')?.toString().startsWith('CANCELED'))!.getFirstPropertyValue('status')).toBe('CANCELLED')
  })

  it('folds multi-byte text on character boundaries and escapes per TEXT rules', () => {
    const long = fold(`SUMMARY:${'Kaʻōnohi '.repeat(20)}`)
    for (const l of long.split('\r\n')) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75)
    expect(long.replace(/\r\n /g, '')).toBe(`SUMMARY:${'Kaʻōnohi '.repeat(20)}`)
    expect(escapeText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne')
    const allDay = buildCalendar('x', [{ uid: 'u@x', start: new Date('2027-03-05T00:00:00Z'), allDay: true, summary: 'First crossover' }], NOW)
    expect(allDay).toContain('DTSTART;VALUE=DATE:20270305\r\nDTEND;VALUE=DATE:20270306')
    expect(() => ICAL.parse(allDay)).not.toThrow()
  })

  it('serves only through the secret token; rotation invalidates the old URL', async () => {
    const t1 = await rotateCalendarToken(db, 'cal_user')
    expect(calendarUrl(t1)).toMatch(/\/api\/calendar\/[A-Za-z0-9_-]+\.ics$/)
    expect(await userForCalendarToken(db, t1)).toBe('cal_user')
    const t2 = await rotateCalendarToken(db, 'cal_user')
    expect(t2).not.toBe(t1)
    expect(await userForCalendarToken(db, t1)).toBeNull()
    expect(await userForCalendarToken(db, t2)).toBe('cal_user')
    expect(await userForCalendarToken(db, 'short')).toBeNull()
    const stored = await db.one<{ ics_token_hash: string }>(`select ics_token_hash from app.user_pref where user_id = 'cal_user'`)
    expect(stored!.ics_token_hash).not.toContain(t2)
  })
})
