import { describe, it, expect } from 'vitest'
import { diffSnapshots, explain } from '@/scripts/db/parity-diff'
import { stripVolatile } from '@/scripts/db/parity-snapshot'
import { migrateUsers } from '@/scripts/db/migrate-users'
import { createTestDb } from './helpers/pglite'

describe('parity tools', () => {
  it('strips volatile fields and sorts keys', () => {
    expect(stripVolatile({ b: 1, a: { computed_at: 'x', z: [ { updated_at: 1, k: 2 } ] } })).toEqual({ a: { z: [{ k: 2 }] }, b: 1 })
  })
  it('classifies expected differences and flags the rest', () => {
    const before = { entities: { e1: { '/api/v1/person/{id}': { full_name: 'A', relationships: [{ relationship_type: 'officer', match_status: 'recipient_matched' }] } } } }
    const after = { entities: { e1: { '/api/v1/person/{id}': { name: 'A', relationships: [{ type: 'officer_of', match_status: 'review' }, { type: 'extra' }] } } } }
    const diffs = diffSnapshots(before, after)
    const unexplained = diffs.filter(d => !d.explained)
    expect(diffs.length).toBeGreaterThan(0)
    expect(unexplained.map(d => d.path)).toEqual(['relationships.length'])
    expect(explain('x.match_status', 'recipient_matched', 'review')).toMatch(/review/)
    expect(explain('x.amount', 100, 100.0000001)).toBe('float rounding')
    expect(explain('x.amount', 100, 200)).toBeNull()
  })
})

describe('migrate-users', () => {
  it('maps legacy auth users to Neon Auth ids and inserts user_account rows', async () => {
    const db = await createTestDb()
    try {
      await db.query(`create schema legacy`)
      await db.query(`create table legacy.users (id uuid primary key, email text, created_at timestamptz default now(), email_confirmed_at timestamptz, raw_user_meta_data jsonb)`)
      await db.query(`create table legacy.user_profile (id uuid primary key, subscription_tier text, subscription_status text, stripe_customer_id text, stripe_subscription_id text, trial_ends_at timestamptz, alert_person_ids uuid[], alert_org_ids uuid[], created_at timestamptz)`)
      await db.query(`create table legacy.staff_role (user_id uuid, role text)`)
      await db.query(`insert into legacy.users (id, email, raw_user_meta_data) values ('11111111-1111-1111-1111-111111111111', 'a@example.com', '{"full_name":"A"}'), ('22222222-2222-2222-2222-222222222222', 'b@example.com', null)`)
      await db.query(`insert into legacy.user_profile (id, subscription_tier, subscription_status, stripe_customer_id) values ('11111111-1111-1111-1111-111111111111', 'professional', 'active', 'cus_1'), ('22222222-2222-2222-2222-222222222222', 'bogus', null, null)`)
      await db.query(`insert into legacy.staff_role values ('11111111-1111-1111-1111-111111111111', 'admin')`)
      const created: string[] = []
      const r = await migrateUsers(db, { dry: false, sendEmail: false, create: async (email) => { created.push(email); return `neon_${email.split('@')[0]}` } })
      expect(r).toEqual({ total: 2, migrated: 2 })
      expect(created).toEqual(['a@example.com', 'b@example.com'])
      const accounts = await db.many<{ user_id: string; subscription_tier: string; is_staff: boolean; stripe_customer_id: string | null }>(`select user_id, subscription_tier, is_staff, stripe_customer_id from user_account order by user_id`)
      expect(accounts).toEqual([
        { user_id: 'neon_a', subscription_tier: 'professional', is_staff: true, stripe_customer_id: 'cus_1' },
        { user_id: 'neon_b', subscription_tier: 'free', is_staff: false, stripe_customer_id: null },
      ])
      // Re-run: nothing new
      const again = await migrateUsers(db, { dry: false, sendEmail: false, create: async () => { throw new Error('should not create') } })
      expect(again.migrated).toBe(0)
    } finally { await db.end() }
  })
})
