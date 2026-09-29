/**
 * E2/E10 — alert matching and delivery: every event type, dedup, burst collapse, quiet hours, mute,
 * unsubscribe, Slack, retries, digests, and end-to-end latency (synthetic document → mock inbox).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { createTestDb, type TestDb } from './helpers/pglite'
import { createTeam } from '@/lib/teams'
import { runMatcher } from '@/lib/alerts/matcher'
import { runDelivery, runDigests } from '@/lib/alerts/delivery'
import { classifyStatus, committeeCodes, parseHearingTime } from '@/lib/alerts/events'
import { inQuietHours, quietEnd, nextLocalTime } from '@/lib/alerts/time'
import { createAlertRule, muteRule, unsubscribeRule, markDeliveryOpened } from '@/lib/alerts/rules'
import { MemoryTransport, type EmailMessage, type EmailResult } from '@/lib/email/resend'
import { encryptSecret, sign, verify } from '@/lib/crypto'
import type { Channels, SlackMessage } from '@/lib/alerts/channels'
import { DisabledSmsSender, isSlackWebhookUrl } from '@/lib/alerts/channels'

process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64')

let db: TestDb
let n = 0
const uniq = () => `${Date.now()}-${n++}`
const EPOCH = new Date(0)

class FakeSlack { sent: SlackMessage[] = []; async send(m: SlackMessage) { this.sent.push(m); return { ok: true } } }
const channels = (email = new MemoryTransport(), slack = new FakeSlack()): Channels & { email: MemoryTransport; slack: FakeSlack } =>
  ({ email, slack, sms: new DisabledSmsSender() }) as never

async function proTeam(owner: string, email: string) {
  const t = await createTeam(db, owner, `Team ${owner}`, { email })
  await db.query(`update app.team set plan = 'pro', subscription_status = 'active' where id = $1`, [t.id])
  const wl = (await db.one<{ id: string }>(`select id from app.watchlist where team_id = $1`, [t.id]))!.id
  return { teamId: t.id, wl }
}
const entity = async (kind: string, name: string, extra: { identifiers?: object; attributes?: object; aliases?: string[] } = {}) =>
  (await db.one<{ id: string }>(`insert into entity(kind, name, identifiers, attributes, aliases) values ($1, $2, $3, $4, $5) returning id`,
    [kind, name, JSON.stringify(extra.identifiers ?? {}), JSON.stringify(extra.attributes ?? {}), extra.aliases ?? []]))!.id
const doc = async (d: { doc_type: string; source?: string; source_record_id?: string; title?: string; body?: string; raw?: object }) =>
  (await db.one<{ id: string }>(
    `insert into document(source, source_record_id, doc_type, title, body_text, raw, checksum) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [d.source ?? 'test', d.source_record_id ?? null, d.doc_type, d.title ?? null, d.body ?? null, JSON.stringify(d.raw ?? {}), uniq().padEnd(64, '0')]))!.id
const edge = async (type: string, from: string | null, to: string | null, documentId: string, role: string | null = null) =>
  (await db.one<{ id: string }>(`insert into edge(type, from_id, to_id, document_id, role, match_status, from_name_raw) values ($1, $2, $3, $4, $5, 'matched', 'raw') returning id`,
    [type, from, to, documentId, role]))!.id
const watch = (wl: string, col: 'entity_id' | 'keyword' | 'committee_entity_id' | 'source_key', v: string) =>
  db.query(`insert into app.watchlist_item(watchlist_id, ${col}) values ($1, $2)`, [wl, v])
const measureDoc = (session: string, measure: string, status: string, date = '2027-02-01') =>
  doc({ doc_type: 'measure', source: 'capitol_measures', source_record_id: `${session}:${measure}`, title: `${measure} (${session})`,
    raw: { measure, session, currentStatus: status, statusHistory: [{ date, text: status }] } })
const events = (teamId: string) => db.many<{ event_type: string; dedup_key: string; entity_id: string | null; headline: string }>(
  `select event_type, dedup_key, entity_id, headline from app.alert_event where team_id = $1 order by detected_at`, [teamId])
const reset = () => db.exec(`delete from app.alert_delivery; delete from app.alert_event; delete from app.matcher_state;`)
/** Isolate a test: rules created by earlier tests stop matching. */
const isolate = async () => { await reset(); await db.exec(`update app.alert_rule set active = false`) }

beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('status classification (data.capitol.hawaii.gov status text)', () => {
  it.each([
    ['Bill scheduled to be heard by HLT on Tuesday, 02-10-27 9:00AM in House conference room 329.', 'bill.hearing_scheduled'],
    ['The committee(s) on HLT has rescheduled its public hearing to 02-11-27 2:00PM.', 'bill.hearing_changed'],
    ['The hearing on this measure has been cancelled.', 'bill.hearing_canceled'],
    ['Reported from HLT (Stand. Com. Rep. No. 123) as amended in HD 1, recommending passage on Second Reading and referral to FIN.', 'bill.committee_report'],
    ['Passed Third Reading with Representative(s) Ward voting no (1) and Representative(s) Kong excused (1).', 'bill.vote_recorded'],
    ['Passed Second Reading as amended in HD 1 and referred to the committee(s) on FIN.', 'bill.new_draft'],
    ['Referred to EET, CPN.', 'bill.status_change'],
  ])('%s → %s', (text, type) => { expect(classifyStatus(text).type).toBe(type) })
  it('extracts committee codes and hearing times (HST)', () => {
    expect(committeeCodes('Referred to HLT, CPC/JHA, FIN, referral sheet 2')).toEqual(['HLT', 'CPC', 'JHA', 'FIN'])
    expect(committeeCodes('Bill scheduled to be heard by EET on 02-04-27')).toEqual(['EET'])
    expect(parseHearingTime('heard by HLT on 02-10-27 9:00AM')!.toISOString()).toBe('2027-02-10T19:00:00.000Z')
    expect(parseHearingTime('on 2/10/2027 1:30 PM')!.toISOString()).toBe('2027-02-10T23:30:00.000Z')
  })
})

describe('Honolulu time helpers', () => {
  it('quiet hours, including windows that wrap midnight', () => {
    const at = (h: number, m = 0) => new Date(Date.UTC(2027, 0, 5, h + 10, m)) // HST h:m
    expect(inQuietHours(at(22), '21:00', '07:00')).toBe(true)
    expect(inQuietHours(at(6, 59), '21:00', '07:00')).toBe(true)
    expect(inQuietHours(at(7), '21:00', '07:00')).toBe(false)
    expect(inQuietHours(at(12), '12:00', '13:00')).toBe(true)
    expect(inQuietHours(at(12), null, null)).toBe(false)
    expect(quietEnd(at(22), '07:00').toISOString()).toBe(new Date(Date.UTC(2027, 0, 6, 17, 0)).toISOString())
  })
  it('next digest time', () => {
    const tue = new Date(Date.UTC(2027, 0, 5, 20, 0)) // Tue 10:00 HST
    expect(nextLocalTime(tue, '07:00').toISOString()).toBe('2027-01-06T17:00:00.000Z')
    expect(nextLocalTime(tue, '07:00', 1).toISOString()).toBe('2027-01-11T17:00:00.000Z')
  })
})

describe('matcher: every event type', () => {
  let team: { teamId: string; wl: string }
  let bill: string, person: string, committee: string
  beforeAll(async () => {
    team = await proTeam('evt_owner', 'evt@example.com')
    await createAlertRule(db, { watchlistId: team.wl, userId: 'evt_owner', channel: 'email' })
    bill = await entity('bill', 'HB1 (2027)', { identifiers: { measure: '2027:HB1' }, attributes: { measure_number: 'HB1', session: '2027' } })
    person = await entity('person', 'Watched Donor', { attributes: { slug: 'watched-donor' } })
    committee = await entity('org', 'House Committee on Health', { identifiers: { committee_code: '2027:H:HLT' } })
    await watch(team.wl, 'entity_id', bill)
    await watch(team.wl, 'entity_id', person)
    await watch(team.wl, 'committee_entity_id', committee)
    await watch(team.wl, 'keyword', 'geothermal')
    await watch(team.wl, 'source_key', 'sunshine_calendar')
  })
  beforeEach(reset)

  const statusCases: Array<[string, string]> = [
    ['Passed First Reading.', 'bill.status_change'],
    ['Passed Second Reading as amended in HD 1 and referred to the committee(s) on FIN.', 'bill.new_draft'],
    ['Bill scheduled to be heard by HLT on Tuesday, 02-10-27 9:00AM in House conference room 329.', 'bill.hearing_scheduled'],
    ['The committee(s) on HLT has rescheduled its public hearing to 02-11-27 2:00PM.', 'bill.hearing_changed'],
    ['The hearing on this measure has been cancelled.', 'bill.hearing_canceled'],
    ['Reported from HLT (Stand. Com. Rep. No. 123), recommending passage on Third Reading.', 'bill.committee_report'],
    ['Passed Third Reading. Ayes, 49; Noes, 1 (Representative(s) Ward). Excused, 1.', 'bill.vote_recorded'],
  ]
  it.each(statusCases)('measure status "%s" → %s', async (status, type) => {
    await db.query(`delete from document where source = 'capitol_measures'`)
    await measureDoc('2027', 'HB1', status)
    await runMatcher(db, { since: EPOCH })
    const ev = await events(team.teamId)
    expect(ev.map(e => e.event_type)).toContain(type)
    expect(ev.find(e => e.event_type === type)!.entity_id).toBe(bill)
  })

  it('committee.referral and committee.hearing_notice for a watched committee', async () => {
    await db.query(`delete from document where source = 'capitol_measures'`)
    await measureDoc('2027', 'HB1', 'Referred to HLT, FIN.')
    await runMatcher(db, { since: EPOCH })
    expect((await events(team.teamId)).map(e => e.event_type)).toContain('committee.referral')
    await reset()
    await db.query(`delete from document where source = 'capitol_measures'`)
    await measureDoc('2027', 'HB1', 'Bill scheduled to be heard by HLT on Tuesday, 02-10-27 9:00AM.')
    await runMatcher(db, { since: EPOCH })
    expect((await events(team.teamId)).map(e => e.event_type)).toContain('committee.hearing_notice')
  })

  it('bill.vote_recorded and bill.new_testimony from edges, one event per document', async () => {
    const vdoc = await doc({ doc_type: 'vote' })
    const a = await entity('person', 'Rep A'), b = await entity('person', 'Rep B')
    await edge('voted_on', a, bill, vdoc, 'aye')
    await edge('voted_on', b, bill, vdoc, 'aye with reservations')
    const tdoc = await doc({ doc_type: 'testimony' })
    const org = await entity('org', 'Testifying Org')
    await edge('testified_on', org, bill, tdoc, 'oppose')
    await runMatcher(db, { since: EPOCH })
    const ev = await events(team.teamId)
    expect(ev.filter(e => e.event_type === 'bill.vote_recorded')).toHaveLength(1)
    expect(ev.filter(e => e.event_type === 'bill.new_testimony')).toHaveLength(1)
  })

  it('bill.testimony_deadline when the hearing is within 72h (deadline 24h before, within 48h)', async () => {
    const hearing = new Date(Date.now() + 50 * 3600_000)
    const hst = new Date(hearing.getTime() - 10 * 3600_000)
    const mm = String(hst.getUTCMonth() + 1).padStart(2, '0'), dd = String(hst.getUTCDate()).padStart(2, '0'), yy = String(hst.getUTCFullYear()).slice(2)
    let h = hst.getUTCHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12
    await db.query(`update entity set attributes = attributes || $2 where id = $1`,
      [bill, JSON.stringify({ current_status: `Bill scheduled to be heard by HLT on ${mm}-${dd}-${yy} ${h}:${String(hst.getUTCMinutes()).padStart(2, '0')}${ap} in conference room 329.` })])
    await runMatcher(db, { since: new Date() })
    await runMatcher(db, { since: new Date() })
    expect((await events(team.teamId)).filter(e => e.event_type === 'bill.testimony_deadline')).toHaveLength(1)
    await db.query(`update entity set attributes = attributes - 'current_status' where id = $1`, [bill])
  })

  it('entity.new_edge for watched types and entity.mention', async () => {
    const d1 = await doc({ doc_type: 'contribution' })
    const cand = await entity('person', 'Candidate')
    await edge('contributed_to', person, cand, d1)
    const d2 = await doc({ doc_type: 'article', title: 'Profile' })
    await edge('mentioned_in', person, null, d2, 'subject')
    await runMatcher(db, { since: EPOCH })
    const ev = await events(team.teamId)
    expect(ev.find(e => e.event_type === 'entity.new_edge')!.headline).toMatch(/Watched Donor contributed to Candidate/)
    expect(ev.find(e => e.event_type === 'entity.mention')).toBeTruthy()
  })

  it('keyword.match on body_text with word boundaries (Sunshine agendas, PUC, county items)', async () => {
    await doc({ doc_type: 'agenda', source: 'sunshine_calendar', title: 'BLNR agenda', body: 'Item D-4: Geothermal lease, Puna.' })
    await doc({ doc_type: 'docket_filing', source: 'puc', title: 'Filing', body: 'Nothing relevant; geothermals is not a word match? no' })
    await doc({ doc_type: 'agenda', source: 'maui_council', title: 'Council', body: 'No match here.' })
    await runMatcher(db, { since: EPOCH })
    const ev = (await events(team.teamId)).filter(e => e.event_type === 'keyword.match')
    expect(ev).toHaveLength(1)
    expect(ev[0].headline).toMatch(/geothermal/)
    expect((await events(team.teamId)).filter(e => e.event_type === 'source.new_document')).toHaveLength(1)
  })

  it('respects rule event_types filters', async () => {
    await db.query(`update app.alert_rule set event_types = '{bill.hearing_canceled}' where watchlist_id = $1`, [team.wl])
    await db.query(`delete from document where source = 'capitol_measures'`)
    await measureDoc('2027', 'HB1', 'Passed First Reading.')
    await runMatcher(db, { since: EPOCH })
    expect((await events(team.teamId)).filter(e => e.event_type.startsWith('bill.'))).toHaveLength(0)
    await db.query(`update app.alert_rule set event_types = '{}' where watchlist_id = $1`, [team.wl])
  })
})

describe('dedup, mute, unsubscribe, quiet hours', () => {
  let bill: string
  beforeEach(async () => { await isolate(); await db.query(`delete from document where source = 'capitol_measures'`) })
  beforeAll(async () => { bill = await entity('bill', 'SB9 (2027)', { identifiers: { measure: '2027:SB9' }, attributes: { measure_number: 'SB9', session: '2027' } }) })

  it('one alert per event per user even if several rules and teams match; re-runs add nothing', async () => {
    const t1 = await proTeam('dup_user', 'dup@example.com')
    const t2 = await proTeam('dup_other', 'other@example.com')
    await db.query(`insert into app.team_member(team_id, user_id, role, email, joined_at) values ($1, 'dup_user', 'member', 'dup@example.com', now())`, [t2.teamId])
    const wl2 = (await db.one<{ id: string }>(`insert into app.watchlist(team_id, name) values ($1, 'Second') returning id`, [t1.teamId]))!.id
    for (const wl of [t1.wl, wl2, t2.wl]) await watch(wl, 'entity_id', bill)
    await createAlertRule(db, { watchlistId: t1.wl, userId: 'dup_user', channel: 'digest_daily' })
    await createAlertRule(db, { watchlistId: t1.wl, userId: 'dup_user', channel: 'email' })
    await createAlertRule(db, { watchlistId: wl2, userId: 'dup_user', channel: 'email' })
    await createAlertRule(db, { watchlistId: t2.wl, userId: 'dup_user', channel: 'email' })
    await measureDoc('2027', 'SB9', 'Passed First Reading.')
    await runMatcher(db, { since: EPOCH })
    await runMatcher(db, { since: EPOCH })
    await runMatcher(db)
    const d = await db.many<{ channel: string }>(`select channel from app.alert_delivery where user_id = 'dup_user'`)
    expect(d).toEqual([{ channel: 'email' }]) // instant email wins over the digest
    const ev = await db.many(`select 1 from app.alert_event where dedup_key like 'bill:${bill}:%'`)
    expect(ev).toHaveLength(2) // one per team, each carrying every matching rule
    const rules = await db.one<{ n: number }>(`select max(cardinality(rule_ids))::int n from app.alert_event where team_id = $1`, [t1.teamId])
    expect(rules!.n).toBe(3)
  })

  it('muted and unsubscribed rules produce no alerts; unmuting restores them', async () => {
    const t = await proTeam('mute_user', 'mute@example.com')
    await watch(t.wl, 'entity_id', bill)
    const r = await createAlertRule(db, { watchlistId: t.wl, userId: 'mute_user', channel: 'email' })
    await muteRule(db, r.id, new Date(Date.now() + 3600_000))
    await measureDoc('2027', 'SB9', 'Passed First Reading.')
    await runMatcher(db, { since: EPOCH })
    expect(await db.many(`select 1 from app.alert_delivery where user_id = 'mute_user'`)).toHaveLength(0)
    await muteRule(db, r.id, null)
    await runMatcher(db, { since: EPOCH })
    expect(await db.many(`select 1 from app.alert_delivery where user_id = 'mute_user'`)).toHaveLength(1)
    await reset()
    await unsubscribeRule(db, r.id)
    await runMatcher(db, { since: EPOCH })
    expect(await db.many(`select 1 from app.alert_delivery where user_id = 'mute_user'`)).toHaveLength(0)
  })

  it('quiet hours defer instant alerts until the window ends', async () => {
    const t = await proTeam('quiet_user', 'quiet@example.com')
    await watch(t.wl, 'entity_id', bill)
    await createAlertRule(db, { watchlistId: t.wl, userId: 'quiet_user', channel: 'email', quietStart: '21:00', quietEnd: '07:00' })
    const night = new Date(Date.UTC(2027, 1, 3, 8, 30)) // 22:30 HST
    await measureDoc('2027', 'SB9', 'Passed First Reading.')
    await runMatcher(db, { since: EPOCH, now: night })
    const row = await db.one<{ status: string; scheduled_for: string }>(`select status, scheduled_for::text from app.alert_delivery where user_id = 'quiet_user'`)
    expect(row!.status).toBe('deferred')
    expect(new Date(row!.scheduled_for).toISOString()).toBe('2027-02-03T17:00:00.000Z')
    const ch = channels()
    expect((await runDelivery(db, ch, { now: night })).sent).toBe(0)
    expect((await runDelivery(db, ch, { now: new Date('2027-02-03T17:00:01Z') })).sent).toBe(1)
    expect(ch.email.sent[0].to).toEqual(['quiet@example.com'])
  })

  it('removed team members stop receiving alerts', async () => {
    const t = await proTeam('gone_owner', 'owner@example.com')
    await db.query(`insert into app.team_member(team_id, user_id, role, email, joined_at, removed_at) values ($1, 'gone_user', 'member', 'gone@example.com', now(), now())`, [t.teamId])
    await watch(t.wl, 'entity_id', bill)
    await db.query(`insert into app.alert_rule(watchlist_id, user_id, channel) values ($1, 'gone_user', 'email')`, [t.wl])
    await measureDoc('2027', 'SB9', 'Passed First Reading.')
    await runMatcher(db, { since: EPOCH })
    expect(await db.many(`select 1 from app.alert_delivery where user_id = 'gone_user'`)).toHaveLength(0)
  })
})

describe('delivery', () => {
  beforeEach(isolate)

  it('collapses a burst of 10+ events on one bill within 10 minutes into one email', async () => {
    const t = await proTeam('burst_user', 'burst@example.com')
    const bill = await entity('bill', 'HB77 (2027)')
    await watch(t.wl, 'entity_id', bill)
    await createAlertRule(db, { watchlistId: t.wl, userId: 'burst_user', channel: 'email' })
    for (let i = 0; i < 12; i++) {
      const d = await doc({ doc_type: 'testimony', title: `Packet ${i}` })
      await edge('testified_on', await entity('org', `Org ${i}`), bill, d, 'support')
    }
    await runMatcher(db, { since: EPOCH })
    const ch = channels()
    const r = await runDelivery(db, ch)
    expect(r).toMatchObject({ sent: 1, collapsed: 11, messages: 1 })
    expect(ch.email.sent).toHaveLength(1)
    expect(ch.email.sent[0].subject).toMatch(/12 updates on HB77/)
    expect(ch.email.sent[0].text.match(/new testimony filed/g)).toHaveLength(12)
  })

  it('does not collapse below the threshold', async () => {
    const t = await proTeam('small_user', 'small@example.com')
    const bill = await entity('bill', 'HB78 (2027)')
    await watch(t.wl, 'entity_id', bill)
    await createAlertRule(db, { watchlistId: t.wl, userId: 'small_user', channel: 'email' })
    for (let i = 0; i < 3; i++) await edge('testified_on', await entity('org', `S ${i}`), bill, await doc({ doc_type: 'testimony' }), 'support')
    await runMatcher(db, { since: EPOCH })
    const ch = channels()
    expect((await runDelivery(db, ch)).sent).toBe(3)
  })

  it('email carries a signed one-click unsubscribe and open pixel; plain black-and-white template', async () => {
    const t = await proTeam('link_user', 'link@example.com')
    const p = await entity('person', 'Linked Person', { attributes: { slug: 'linked-person' } })
    await watch(t.wl, 'entity_id', p)
    const rule = await createAlertRule(db, { watchlistId: t.wl, userId: 'link_user', channel: 'email' })
    await edge('appointed_to', p, await entity('office', 'Board of Land'), await doc({ doc_type: 'appointment' }))
    await runMatcher(db, { since: EPOCH })
    const ch = channels()
    await runDelivery(db, ch)
    const m = ch.email.sent[0]
    expect(m.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    const url = new URL(m.headers!['List-Unsubscribe'].slice(1, -1))
    expect(url.searchParams.get('r')).toBe(rule.id)
    expect(verify(`unsub:${rule.id}`, url.searchParams.get('s'))).toBe(true)
    expect(verify(`unsub:${rule.id}`, 'forged')).toBe(false)
    expect(m.html).toMatch(/\/person\/linked-person/)
    expect(m.html).not.toMatch(/#(?!000000|FFFFFF|CC0000|595959|E5E5E5)[0-9A-Fa-f]{6}/)
    const deliveryId = new URL(m.html.match(/src="([^"]+open[^"]+)"/)![1].replace(/&amp;/g, '&')).searchParams.get('d')!
    await markDeliveryOpened(db, deliveryId)
    expect((await db.one<{ opened_at: string | null }>(`select opened_at from app.alert_delivery where id = $1`, [deliveryId]))!.opened_at).not.toBeNull()
  })

  it('posts to Slack with the decrypted team webhook', async () => {
    const t = await proTeam('slack_owner', 'slack@example.com')
    await db.query(`update app.team set slack_webhook_enc = $2 where id = $1`, [t.teamId, encryptSecret('https://hooks.slack.com/services/T000/B000/XXXX')])
    const bill = await entity('bill', 'HB90 (2027)')
    await watch(t.wl, 'entity_id', bill)
    await createAlertRule(db, { watchlistId: t.wl, userId: null, channel: 'slack' })
    await edge('testified_on', await entity('org', 'Slack Org'), bill, await doc({ doc_type: 'testimony' }), 'support')
    await runMatcher(db, { since: EPOCH })
    const ch = channels()
    expect((await runDelivery(db, ch)).sent).toBe(1)
    expect(ch.slack.sent[0].text).toMatch(/HB90/)
    expect(isSlackWebhookUrl('https://hooks.slack.com/services/a/b/c')).toBe(true)
    expect(isSlackWebhookUrl('https://evil.example.com/services/a')).toBe(false)
  })

  it('retries failed sends with backoff and marks them failed after 3 attempts', async () => {
    const t = await proTeam('fail_user', 'fail@example.com')
    const bill = await entity('bill', 'HB91 (2027)')
    await watch(t.wl, 'entity_id', bill)
    await createAlertRule(db, { watchlistId: t.wl, userId: 'fail_user', channel: 'email' })
    await edge('testified_on', await entity('org', 'Fail Org'), bill, await doc({ doc_type: 'testimony' }), 'support')
    await runMatcher(db, { since: EPOCH })
    const failing = { async send(ms: EmailMessage[]): Promise<EmailResult[]> { return ms.map(() => ({ ok: false, id: null, error: 'Resend 500' })) } }
    const ch = { email: failing, slack: new FakeSlack(), sms: new DisabledSmsSender() }
    let t0 = Date.now()
    expect((await runDelivery(db, ch, { now: new Date(t0) })).retried).toBe(1)
    t0 += 2 * 60_000
    expect((await runDelivery(db, ch, { now: new Date(t0) })).retried).toBe(1)
    t0 += 5 * 60_000
    expect((await runDelivery(db, ch, { now: new Date(t0) })).failed).toBe(1)
    expect((await db.one<{ status: string; error: string }>(`select status, error from app.alert_delivery where user_id = 'fail_user'`))).toMatchObject({ status: 'failed', error: 'Resend 500' })
  })

  it('assembles daily digests grouped by event type, one email per user', async () => {
    const t = await proTeam('digest_user', 'digest@example.com')
    const bill = await entity('bill', 'HB92 (2027)')
    await watch(t.wl, 'entity_id', bill)
    await watch(t.wl, 'keyword', 'aquifer')
    await createAlertRule(db, { watchlistId: t.wl, userId: 'digest_user', channel: 'digest_daily' })
    await edge('testified_on', await entity('org', 'Digest Org'), bill, await doc({ doc_type: 'testimony' }), 'support')
    await doc({ doc_type: 'agenda', title: 'Water commission', body: 'The aquifer item.' })
    const now = new Date()
    await runMatcher(db, { since: EPOCH, now })
    const ch = channels()
    expect((await runDelivery(db, ch, { now })).sent).toBe(0)
    expect((await runDigests(db, ch, { now })).messages).toBe(0)
    const later = new Date(now.getTime() + 25 * 3600_000)
    const r = await runDigests(db, ch, { now: later })
    expect(r).toMatchObject({ users: 1, events: 2, messages: 1 })
    expect(ch.email.sent[0].subject).toMatch(/Daily digest — 2 updates/)
    expect(ch.email.sent[0].text).toMatch(/New testimony filed[\s\S]*Keyword match|Keyword match[\s\S]*New testimony filed/)
    expect((await runDigests(db, ch, { now: later })).messages).toBe(0)
  })
})

describe('signing', () => {
  it('signs and verifies values', () => {
    expect(verify('x', sign('x'))).toBe(true)
    expect(verify('y', sign('x'))).toBe(false)
  })
})

describe('latency: synthetic document → mock inbox', () => {
  beforeEach(isolate)
  it('delivers in under 60 seconds from commit', async () => {
    const t = await proTeam('lat_user', 'latency@example.com')
    await watch(t.wl, 'keyword', 'latencyprobe')
    await createAlertRule(db, { watchlistId: t.wl, userId: 'lat_user', channel: 'email' })
    await runMatcher(db) // establish watermark
    const committed = Date.now()
    await doc({ doc_type: 'agenda', title: 'Probe', body: 'synthetic latencyprobe document' })
    const ch = channels()
    await runMatcher(db)
    await runDelivery(db, ch)
    expect(ch.email.sent).toHaveLength(1)
    expect(ch.email.sent[0].at - committed).toBeLessThan(60_000)
    const s = await db.one<{ s: number }>(
      `select extract(epoch from (d.sent_at - ev.fetched_at))::float8 s from app.alert_delivery d join app.alert_event ev on ev.id = d.alert_event_id where d.user_id = 'lat_user'`)
    expect(s!.s).toBeLessThan(60)
  })
})
