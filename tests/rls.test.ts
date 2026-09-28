/**
 * Row Level Security suite. Runs against PGlite by default; set TEST_DATABASE_URL to a Neon test
 * branch to exercise the real `authenticated` / `anonymous` roles and Neon's auth.user_id().
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'

let db: TestDb
const FREE = 'user_free', PAID = 'user_paid', STAFF = 'user_staff', LAPSED = 'user_lapsed'
let ids: Record<string, string> = {}
const sha = (s: string) => Array.from({ length: 64 }, (_, i) => s.charCodeAt(i % s.length).toString(16).slice(-1)).join('')

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    insert into user_account(user_id, subscription_tier, subscription_status, is_staff) values
      ('${FREE}', 'free', 'inactive', false),
      ('${PAID}', 'individual', 'active', false),
      ('${LAPSED}', 'professional', 'canceled', false),
      ('${STAFF}', 'free', 'inactive', true);
  `)
  const person = (await db.one<{ id: string }>(`insert into entity(kind,name) values ('person','Public Person') returning id`))!.id
  const org = (await db.one<{ id: string }>(`insert into entity(kind,name) values ('org','Some Org') returning id`))!.id
  const pubDoc = (await db.one<{ id: string }>(`insert into document(source, doc_type, raw, checksum) values ('t','article','{}',$1) returning id`, [sha('pub')]))!.id
  const paidDoc = (await db.one<{ id: string }>(`insert into document(source, doc_type, raw, checksum) values ('t','contribution','{}',$1) returning id`, [sha('paid')]))!.id
  const pubEdge = (await db.one<{ id: string }>(`insert into edge(type, from_id, to_id, document_id) values ('officer_of',$1,$2,$3) returning id`, [person, org, pubDoc]))!.id
  const paidEdge = (await db.one<{ id: string }>(`insert into edge(type, from_id, to_id, document_id, amount) values ('contributed_to',$1,$2,$3, 100) returning id`, [person, org, paidDoc]))!.id
  await db.query(`insert into summary(entity_id, body, author, status, tier) values ($1,'free published','model:x','published','free'), ($1,'paid published','model:x','published','paid'), ($1,'draft','staff:${STAFF}','draft','paid')`, [person])
  await db.query(`insert into ax_influence_score(entity_id, composite_score) values ($1, 50)`, [person])
  await db.query(`insert into import_cursor(source) values ('csc')`)
  ids = { person, org, pubDoc, paidDoc, pubEdge, paidEdge }
})
afterAll(async () => { await db.end() })

const count = async (role: 'authenticated' | 'anonymous', uid: string | null, sql: string) => {
  const r = await db.as(role, uid)<{ n: string }>(`select count(*)::text n from (${sql}) x`)
  return Number(r.rows[0].n)
}

describe('RLS: canonical tables', () => {
  it('entity is readable by everyone', async () => {
    expect(await count('anonymous', null, 'select * from entity')).toBe(2)
    expect(await count('authenticated', FREE, 'select * from entity')).toBe(2)
  })

  it('paid document/edge types are hidden from anonymous, free and lapsed users', async () => {
    for (const [role, uid] of [['anonymous', null], ['authenticated', FREE], ['authenticated', LAPSED]] as const) {
      expect(await count(role, uid, 'select * from document')).toBe(1)
      expect(await count(role, uid, `select * from document where doc_type = 'contribution'`)).toBe(0)
      expect(await count(role, uid, 'select * from edge')).toBe(1)
      expect(await count(role, uid, `select * from edge where type = 'contributed_to'`)).toBe(0)
    }
  })

  it('paid and staff users see paid documents and edges', async () => {
    for (const uid of [PAID, STAFF]) {
      expect(await count('authenticated', uid, 'select * from document')).toBe(2)
      expect(await count('authenticated', uid, 'select * from edge')).toBe(2)
    }
  })

  it('no user can write entity, document, edge, or ax_* tables', async () => {
    const writes = [
      `insert into entity(kind,name) values ('person','Hacker')`,
      `update entity set name = 'x' where id = '${ids.person}'`,
      `delete from entity where id = '${ids.person}'`,
      `insert into document(source, doc_type, raw, checksum) values ('t','article','{}','${sha('hack')}')`,
      `insert into edge(type, from_id, to_id, document_id) values ('officer_of','${ids.person}','${ids.org}','${ids.pubDoc}')`,
      `update edge set amount = 1 where id = '${ids.pubEdge}'`,
      `insert into ax_influence_score(entity_id, composite_score) values ('${ids.org}', 99)`,
      `update ax_influence_score set composite_score = 1`,
      `delete from ax_alert`,
      `insert into summary(entity_id, body, author) values ('${ids.person}','x','staff:${STAFF}')`,
    ]
    for (const uid of [FREE, PAID, STAFF]) {
      for (const sql of writes) {
        await expect(db.as('authenticated', uid)(sql)).rejects.toThrow(/permission denied|row-level security/i)
      }
    }
    for (const sql of writes) {
      await expect(db.as('anonymous', null)(sql)).rejects.toThrow(/permission denied|row-level security/i)
    }
  })
})

describe('RLS: summary', () => {
  it('free published summaries are visible to everyone', async () => {
    expect(await count('anonymous', null, `select * from summary where tier = 'free'`)).toBe(1)
    expect(await count('authenticated', FREE, `select * from summary where tier = 'free'`)).toBe(1)
  })
  it('paid summaries are hidden from anonymous and free users', async () => {
    expect(await count('anonymous', null, `select * from summary where tier = 'paid'`)).toBe(0)
    expect(await count('authenticated', FREE, `select * from summary where tier = 'paid'`)).toBe(0)
    expect(await count('authenticated', LAPSED, `select * from summary where tier = 'paid'`)).toBe(0)
    expect(await count('authenticated', PAID, `select * from summary where tier = 'paid' and status = 'published'`)).toBe(1)
  })
  it('drafts are staff-only', async () => {
    expect(await count('authenticated', PAID, `select * from summary where status = 'draft'`)).toBe(0)
    expect(await count('authenticated', FREE, `select * from summary where status = 'draft'`)).toBe(0)
    expect(await count('anonymous', null, `select * from summary where status = 'draft'`)).toBe(0)
    expect(await count('authenticated', STAFF, `select * from summary where status = 'draft'`)).toBe(1)
    expect(await count('authenticated', STAFF, `select * from summary`)).toBe(3)
  })
})

describe('RLS: user_account and ax_*', () => {
  it('user_account is owner-only; staff read all; anonymous sees nothing', async () => {
    expect(await count('authenticated', FREE, 'select * from user_account')).toBe(1)
    const own = await db.as('authenticated', FREE)<{ user_id: string }>('select user_id from user_account')
    expect(own.rows[0].user_id).toBe(FREE)
    expect(await count('authenticated', STAFF, 'select * from user_account')).toBe(4)
    await expect(db.as('anonymous', null)('select * from user_account')).rejects.toThrow(/permission denied/i)
  })
  it('users may update only their own watch list, not their tier', async () => {
    const r = await db.as('authenticated', FREE)(`update user_account set watch_entity_ids = array['${ids.person}']::uuid[] where user_id = '${FREE}'`)
    expect(r.rowCount).toBe(1)
    const other = await db.as('authenticated', FREE)(`update user_account set watch_entity_ids = '{}' where user_id = '${PAID}'`)
    expect(other.rowCount).toBe(0)
    await expect(db.as('authenticated', FREE)(`update user_account set subscription_tier = 'institutional' where user_id = '${FREE}'`)).rejects.toThrow(/permission denied/i)
    await expect(db.as('authenticated', FREE)(`update user_account set is_staff = true where user_id = '${FREE}'`)).rejects.toThrow(/permission denied/i)
  })
  it('ax_* tables are readable by paid and staff only', async () => {
    expect(await count('authenticated', FREE, 'select * from ax_influence_score')).toBe(0)
    expect(await count('authenticated', PAID, 'select * from ax_influence_score')).toBe(1)
    expect(await count('authenticated', STAFF, 'select * from ax_influence_score')).toBe(1)
    await expect(db.as('anonymous', null)('select * from ax_influence_score')).rejects.toThrow(/permission denied/i)
  })
  it('import_cursor and migration_user_map are staff-only / hidden', async () => {
    expect(await count('authenticated', PAID, 'select * from import_cursor')).toBe(0)
    expect(await count('authenticated', STAFF, 'select * from import_cursor')).toBe(1)
    await expect(db.as('authenticated', STAFF)('select * from migration_user_map')).rejects.toThrow(/permission denied/i)
  })
})
