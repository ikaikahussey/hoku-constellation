/**
 * E0/E10 — workspace isolation and entitlements at the database level.
 * Team A members never see team B's rows; a Reader-plan team cannot use Pro features even with
 * direct SQL; staff read everything; users cannot change billing fields.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import { createTeam, inviteMember, acceptInvitation, removeMember, transferOwnership, setMemberRole, seatsUsed, TeamError } from '@/lib/teams'
import { getEntitlements, getTeamEntitlements, PLAN_FEATURES } from '@/lib/entitlements'

let db: TestDb
const A1 = 'a_owner', A2 = 'a_member', B1 = 'b_owner', R1 = 'reader_owner', STAFF = 'staff_user', LEGACY = 'legacy_pro'
const ids: Record<string, string> = {}

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`insert into user_account(user_id, is_staff) values ('${STAFF}', true);
                 insert into user_account(user_id, subscription_tier, subscription_status) values ('${LEGACY}', 'professional', 'active');`)
  const bill = (await db.one<{ id: string }>(`insert into entity(kind, name) values ('bill', 'HB1 (2027)') returning id`))!.id
  const doc = (await db.one<{ id: string }>(`insert into document(source, doc_type, raw, checksum) values ('t','measure','{}','c1') returning id`))!.id
  ids.bill = bill; ids.doc = doc

  const a = await createTeam(db, A1, 'Team A', { email: 'a1@example.com' })
  const b = await createTeam(db, B1, 'Team B')
  const r = await createTeam(db, R1, 'Reader Co')
  await db.query(`update app.team set plan = 'pro', subscription_status = 'active', seat_count = 3 where id = $1`, [a.id])
  await db.query(`update app.team set plan = 'pro', subscription_status = 'active' where id = $1`, [b.id])
  await db.query(`update app.team set plan = 'reader', subscription_status = 'active' where id = $1`, [r.id])
  ids.a = a.id; ids.b = b.id; ids.r = r.id
  const inv = await inviteMember(db, A1, a.id, 'a2@example.com')
  await acceptInvitation(db, inv.token, A2, 'a2@example.com')

  for (const [team, owner] of [[a.id, A1], [b.id, B1]] as const) {
    const client = (await db.one<{ id: string }>(`insert into app.client(team_id, name) values ($1, $2) returning id`, [team, `client of ${team}`]))!.id
    const wl = (await db.one<{ id: string }>(`select id from app.watchlist where team_id = $1`, [team]))!.id
    await db.query(`insert into app.watchlist_item(watchlist_id, entity_id) values ($1, $2)`, [wl, bill])
    const rule = (await db.one<{ id: string }>(`insert into app.alert_rule(watchlist_id, user_id, channel) values ($1, $2, 'email') returning id`, [wl, owner]))!.id
    await db.query(`insert into app.note(team_id, author_user_id, entity_id, body) values ($1, $2, $3, 'private note')`, [team, owner, bill])
    await db.query(`insert into app.report(team_id, client_id, period_start, period_end) values ($1, $2, '2027-01-01', '2027-01-07')`, [team, client])
    const ev = (await db.one<{ id: string }>(
      `insert into app.alert_event(team_id, event_type, dedup_key, entity_id, document_id, headline) values ($1, 'bill.status_change', $2, $3, $4, 'x') returning id`,
      [team, `k-${team}`, bill, doc]))!.id
    await db.query(`insert into app.alert_delivery(alert_event_id, team_id, rule_id, user_id, channel, dedup_key) values ($1, $2, $3, $4, 'email', $5)`, [ev, team, rule, owner, `k-${team}`])
    ids[`wl_${team}`] = wl; ids[`client_${team}`] = client
  }
})
afterAll(async () => { await db.end() })

const count = async (uid: string, sql: string) => {
  const r = await db.as('authenticated', uid)<{ n: string }>(`select count(*)::text n from (${sql}) x`)
  return Number(r.rows[0].n)
}

describe('team isolation', () => {
  const TABLES = ['app.team', 'app.client', 'app.watchlist', 'app.watchlist_item', 'app.alert_rule', 'app.note', 'app.report', 'app.alert_event', 'app.alert_delivery']

  it('members of team A see only team A rows', async () => {
    for (const uid of [A1, A2]) {
      expect(await count(uid, `select * from app.client`)).toBe(1)
      expect(await count(uid, `select * from app.client where team_id = '${ids.b}'`)).toBe(0)
      expect(await count(uid, `select * from app.note where team_id = '${ids.b}'`)).toBe(0)
      expect(await count(uid, `select * from app.report where team_id = '${ids.b}'`)).toBe(0)
      expect(await count(uid, `select * from app.watchlist where team_id = '${ids.b}'`)).toBe(0)
      expect(await count(uid, `select * from app.watchlist_item where watchlist_id = '${ids[`wl_${ids.b}`]}'`)).toBe(0)
      expect(await count(uid, `select * from app.alert_delivery where team_id = '${ids.b}'`)).toBe(0)
      expect(await count(uid, `select * from app.alert_event where team_id = '${ids.b}'`)).toBe(0)
    }
    expect(await count(A2, `select * from app.note`)).toBe(1)
    expect(await count(A2, `select * from app.alert_delivery`)).toBe(1)
  })

  it('a non-member sees nothing and cannot write into another team', async () => {
    for (const t of TABLES) expect(await count(R1, `select * from ${t} where ${t === 'app.team' ? 'id' : t.endsWith('item') || t.endsWith('rule') ? `'${ids.a}'::uuid` : 'team_id'} = '${ids.a}'`)).toBe(0)
    await expect(db.as('authenticated', B1)(`insert into app.note(team_id, author_user_id, entity_id, body) values ('${ids.a}', '${B1}', '${ids.bill}', 'intrusion')`)).rejects.toThrow(/row-level security/i)
    await expect(db.as('authenticated', B1)(`insert into app.watchlist_item(watchlist_id, keyword) values ('${ids[`wl_${ids.a}`]}', 'x')`)).rejects.toThrow(/row-level security/i)
    const upd = await db.as('authenticated', B1)(`update app.client set name = 'hijack' where team_id = '${ids.a}'`)
    expect(upd.rowCount).toBe(0)
    const del = await db.as('authenticated', B1)(`delete from app.note where team_id = '${ids.a}'`)
    expect(del.rowCount).toBe(0)
  })

  it('staff read every team', async () => {
    expect(await count(STAFF, `select * from app.client`)).toBe(2)
    expect(await count(STAFF, `select * from app.note`)).toBe(2)
    expect(await count(STAFF, `select * from app.alert_delivery`)).toBe(2)
  })

  it('users cannot change plan, seats, or Stripe ids, nor mark a report sent', async () => {
    await expect(db.as('authenticated', A1)(`update app.team set plan = 'organization' where id = '${ids.a}'`)).rejects.toThrow(/permission denied/i)
    await expect(db.as('authenticated', A1)(`update app.team set seat_count = 99 where id = '${ids.a}'`)).rejects.toThrow(/permission denied/i)
    await expect(db.as('authenticated', A1)(`update app.team set is_design_partner = true where id = '${ids.a}'`)).rejects.toThrow(/permission denied/i)
    await expect(db.as('authenticated', A1)(`insert into app.team_member(team_id, user_id, role, joined_at) values ('${ids.b}', '${A1}', 'owner', now())`)).rejects.toThrow(/permission denied/i)
    await expect(db.as('authenticated', A1)(`update app.report set status = 'sent' where team_id = '${ids.a}'`)).rejects.toThrow(/row-level security|approved before/i)
    const ok = await db.as('authenticated', A1)(`update app.team set name = 'Team A renamed' where id = '${ids.a}'`)
    expect(ok.rowCount).toBe(1)
  })

  it('users cannot read the matcher watermark or other users’ entitlements', async () => {
    await expect(db.as('authenticated', A1)(`select * from app.matcher_state`)).rejects.toThrow(/permission denied/i)
    await expect(db.as('authenticated', A1)(`select (app.entitlements('${B1}')).*`)).rejects.toThrow(/permission denied/i)
    const own = await db.as('authenticated', A1)<{ tier: string }>(`select (app.entitlements('${A1}')).tier`)
    expect(own.rows[0].tier).toBe('pro')
    await expect(db.as('anonymous', null)(`select (app.entitlements('${A1}')).tier`)).rejects.toThrow(/permission denied/i)
  })
})

describe('entitlements', () => {
  it('derive the tier from team membership', async () => {
    expect((await getEntitlements(db, A2)).tier).toBe('pro')
    expect((await getEntitlements(db, R1)).tier).toBe('reader')
    expect((await getEntitlements(db, 'nobody')).tier).toBe('free')
    expect(await getTeamEntitlements(db, ids.r)).toMatchObject({ tier: 'reader', reports: false, qa: false, max_watch_items: 10 })
  })

  it('match lib/entitlements.ts PLAN_FEATURES for every tier', async () => {
    for (const tier of ['free', 'reader', 'pro', 'organization'] as const) {
      const row = await db.one(`select (app.plan_features($1)).*`, [tier])
      expect(row).toEqual(PLAN_FEATURES[tier])
    }
  })

  it('legacy Professional subscribers keep paid content and API access', async () => {
    expect(await getEntitlements(db, LEGACY)).toMatchObject({ tier: 'pro', paid_content: true, api: true })
  })

  it('staff get every feature', async () => {
    expect(await getEntitlements(db, STAFF)).toMatchObject({ is_staff: true, reports: true, qa: true, api: true })
  })

  it('a lapsed subscription drops the team to free', async () => {
    await db.query(`update app.team set subscription_status = 'canceled' where id = $1`, [ids.b])
    expect((await getEntitlements(db, B1)).tier).toBe('free')
    expect(await count(B1, `select * from app.client`)).toBe(0)
    await db.query(`update app.team set subscription_status = 'active' where id = $1`, [ids.b])
    expect(await count(B1, `select * from app.client`)).toBe(1)
  })

  it('paid content gating follows team membership', async () => {
    await db.query(`insert into document(source, doc_type, raw, checksum) values ('t','contribution','{}','c-paid')`)
    expect(await count(A2, `select * from document where doc_type = 'contribution'`)).toBe(1)
    expect(await count(R1, `select * from document where doc_type = 'contribution'`)).toBe(1)
    expect(await count('free_user', `select * from document where doc_type = 'contribution'`)).toBe(0)
  })
})

describe('Reader plan cannot use Pro features at the database level', () => {
  it('cannot create clients or reports', async () => {
    await expect(db.as('authenticated', R1)(`insert into app.client(team_id, name) values ('${ids.r}', 'x')`)).rejects.toThrow(/row-level security/i)
    expect(await count(R1, `select * from app.report`)).toBe(0)
  })
  it('cannot read cached briefings', async () => {
    await db.query(`insert into app.briefing(entity_id, content) values ($1, '{}')`, [ids.bill])
    expect(await count(R1, `select * from app.briefing`)).toBe(0)
    expect(await count(A1, `select * from app.briefing`)).toBe(1)
  })
  it('is limited to 10 watch items', async () => {
    const wl = (await db.one<{ id: string }>(`select id from app.watchlist where team_id = $1`, [ids.r]))!.id
    for (let i = 0; i < 10; i++) await db.as('authenticated', R1)(`insert into app.watchlist_item(watchlist_id, keyword) values ('${wl}', 'kw${i}')`)
    await expect(db.as('authenticated', R1)(`insert into app.watchlist_item(watchlist_id, keyword) values ('${wl}', 'kw10')`)).rejects.toThrow(/watch item limit/i)
    await expect(db.query(`insert into app.watchlist_item(watchlist_id, keyword) values ($1, 'kw11')`, [wl])).rejects.toThrow(/watch item limit/i)
  })
  it('free teams cannot create alert rules; SMS is not offered', async () => {
    const t = await createTeam(db, 'free_owner', 'Free team')
    const wl = (await db.one<{ id: string }>(`select id from app.watchlist where team_id = $1`, [t.id]))!.id
    await expect(db.as('authenticated', 'free_owner')(`insert into app.alert_rule(watchlist_id, user_id, channel) values ('${wl}', 'free_owner', 'email')`)).rejects.toThrow(/row-level security/i)
    await expect(db.as('authenticated', A1)(`insert into app.alert_rule(watchlist_id, user_id, channel) values ('${ids[`wl_${ids.a}`]}', '${A1}', 'sms')`)).rejects.toThrow(/row-level security/i)
    const ok = await db.as('authenticated', A1)(`insert into app.alert_rule(watchlist_id, user_id, channel) values ('${ids[`wl_${ids.a}`]}', '${A1}', 'digest_daily')`)
    expect(ok.rowCount).toBe(1)
  })
})

describe('team management', () => {
  it('enforces seats on invitations', async () => {
    expect(await seatsUsed(db, ids.a)).toBe(2)
    await inviteMember(db, A1, ids.a, 'third@example.com')
    await expect(inviteMember(db, A1, ids.a, 'fourth@example.com')).rejects.toThrow(/seats are in use/)
  })
  it('only owners/admins invite; members cannot', async () => {
    await expect(inviteMember(db, A2, ids.a, 'x@example.com')).rejects.toBeInstanceOf(TeamError)
  })
  it('transfers ownership and removes members while keeping their notes', async () => {
    await setMemberRole(db, A1, ids.a, A2, 'admin')
    await db.query(`insert into app.note(team_id, author_user_id, entity_id, body) values ($1, $2, $3, 'by a2')`, [ids.a, A2, ids.bill])
    await transferOwnership(db, A1, ids.a, A2)
    await expect(removeMember(db, A1, ids.a, A2)).rejects.toThrow(/owner cannot be removed/)
    await removeMember(db, A2, ids.a, A1)
    expect(await count(A1, `select * from app.note`)).toBe(0)
    expect(await count(A2, `select * from app.note where author_user_id = '${A2}'`)).toBe(1)
    const notes = await db.many(`select * from app.note where team_id = $1`, [ids.a])
    expect(notes.length).toBe(2)
  })
})

describe('watch_entity_ids migration', () => {
  it('moves legacy watch lists into a personal team default watchlist, idempotently', async () => {
    const e = (await db.one<{ id: string }>(`insert into entity(kind, name) values ('person', 'Watched') returning id`))!.id
    await db.query(`insert into user_account(user_id, watch_entity_ids) values ('watcher', array[$1::uuid, $2::uuid])`, [e, ids.bill])
    const sql = (await import('node:fs')).readFileSync('db/migrations/003_app_workspace.sql', 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    const rows = await db.many<{ entity_id: string }>(
      `select i.entity_id from app.watchlist_item i join app.watchlist w on w.id = i.watchlist_id join app.team t on t.id = w.team_id
        join app.team_member m on m.team_id = t.id where m.user_id = 'watcher' and t.is_personal and w.is_default`)
    expect(rows.map(r => r.entity_id).sort()).toEqual([e, ids.bill].sort())
  })
})
