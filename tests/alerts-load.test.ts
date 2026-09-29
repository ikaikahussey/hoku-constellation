/**
 * E8/E10 load simulation: 500 watchlists over 5,000 bills, then a burst of 1,000 status changes
 * committed in one ingestion batch. The alert pipeline (match + deliver to a mock inbox) must stay
 * within the E2 target: commit → sent under 60 seconds at p95.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { createTestDb, type TestDb } from './helpers/pglite'
import { runMatcher } from '@/lib/alerts/matcher'
import { runDelivery } from '@/lib/alerts/delivery'
import { MemoryTransport } from '@/lib/email/resend'
import { DisabledSmsSender } from '@/lib/alerts/channels'

process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')

const BILLS = 5000, TEAMS = 100, LISTS_PER_TEAM = 5, ITEMS_PER_LIST = 50, BURST = 1000

let db: TestDb
beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    insert into entity(kind, name, identifiers, attributes)
      select 'bill', 'HB' || g || ' (2027)', jsonb_build_object('measure', '2027:HB' || g), jsonb_build_object('measure_number', 'HB' || g, 'session', '2027')
        from generate_series(1, ${BILLS}) g;
    insert into app.team(name, plan, subscription_status, seat_count)
      select 'Load team ' || t, 'pro', 'active', ${LISTS_PER_TEAM} from generate_series(1, ${TEAMS}) t;
    insert into app.team_member(team_id, user_id, role, email, joined_at)
      select t.id, 'load_' || row_number() over () , case when u = 1 then 'owner' else 'member' end, 'load' || row_number() over () || '@example.com', now()
        from app.team t cross join generate_series(1, ${LISTS_PER_TEAM}) u;
    insert into app.watchlist(team_id, name, owner_user_id)
      select m.team_id, 'List of ' || m.user_id, m.user_id from app.team_member m;
    -- Each watchlist watches ${ITEMS_PER_LIST} bills spread across the 5,000 (deterministic stride).
    insert into app.watchlist_item(watchlist_id, entity_id)
      select w.id, b.id from (select id, row_number() over (order by id) rn from app.watchlist) w
        cross join generate_series(0, ${ITEMS_PER_LIST - 1}) k
        join (select id, row_number() over (order by name) rn from entity where kind = 'bill') b
          on b.rn = ((w.rn * 97 + k * 101) % ${BILLS}) + 1
      on conflict do nothing;
    insert into app.alert_rule(watchlist_id, user_id, channel) select id, owner_user_id, 'email' from app.watchlist;
  `)
})
afterAll(async () => { await db.end() })

describe('alert pipeline under load', () => {
  it(`${TEAMS * LISTS_PER_TEAM} watchlists × ${BILLS} bills, burst of ${BURST} status changes, p95 under 60s`, async () => {
    const lists = (await db.one<{ n: number }>(`select count(*)::int n from app.watchlist`))!.n
    const items = (await db.one<{ n: number }>(`select count(*)::int n from app.watchlist_item`))!.n
    expect(lists).toBe(500)
    expect(items).toBeGreaterThan(20_000)
    await runMatcher(db) // watermark before the burst

    // One ingestion batch: 1,000 measures change status.
    const committedAt = Date.now()
    await db.exec(`
      insert into document(source, source_record_id, doc_type, title, raw, checksum)
        select 'capitol_measures', '2027:HB' || g, 'measure', 'HB' || g,
               jsonb_build_object('measure', 'HB' || g, 'session', '2027', 'currentStatus', 'Passed Second Reading.',
                                  'statusHistory', jsonb_build_array(jsonb_build_object('date', '2027-02-20', 'text', 'Passed Second Reading.'))),
               md5('burst' || g) || md5('x' || g)
          from generate_series(1, ${BURST}) g;`)

    const mail = new MemoryTransport()
    const match = await runMatcher(db)
    const delivery = await runDelivery(db, { email: mail, slack: { send: async () => ({ ok: true }) }, sms: new DisabledSmsSender() })
    const elapsed = Date.now() - committedAt

    expect(match.documents).toBe(BURST)
    expect(match.events).toBeGreaterThan(1000)
    expect(delivery.sent + delivery.collapsed).toBe(match.deliveries)
    expect(mail.sent.length).toBe(delivery.sent)
    const lat = await db.many<{ s: number }>(
      `select extract(epoch from (d.sent_at - ev.fetched_at))::float8 s from app.alert_delivery d join app.alert_event ev on ev.id = d.alert_event_id where d.status = 'sent' order by 1`)
    const p95 = lat[Math.ceil(lat.length * 0.95) - 1].s
    console.log(`[load] events=${match.events} deliveries=${match.deliveries} emails=${mail.sent.length} match=${match.durationMs}ms total=${elapsed}ms p95=${p95.toFixed(2)}s`)
    expect(p95).toBeLessThan(60)
    expect(elapsed).toBeLessThan(60_000)
  }, 180_000)
})
