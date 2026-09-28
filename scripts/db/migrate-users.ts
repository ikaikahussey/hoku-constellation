#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * Migrates Supabase auth users to Neon Auth and fills migration_user_map, then re-runs the
 * user_account section of the port so tiers, Stripe ids and staff flags follow the user.
 *
 * Neon Auth (Better Auth) does not import bcrypt hashes. Each user is created through the admin API
 * without a password and receives a password-reset email, so they choose a new password on first login.
 *
 * Env: DATABASE_URL_UNPOOLED (Neon, with the `legacy` schema restored), NEON_AUTH_BASE_URL,
 * NEON_AUTH_ADMIN_KEY (server key for /admin/create-user), NEXT_PUBLIC_SITE_URL.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/db/migrate-users.ts [--dry] [--no-email]
 */
import { Pool } from 'pg'
import { wrapPg } from '@/lib/db/pg-adapter'

const DRY = process.argv.includes('--dry')
const SEND_EMAIL = !process.argv.includes('--no-email')

interface LegacyUser { id: string; email: string; created_at: string; email_confirmed_at: string | null; raw_user_meta_data: Record<string, unknown> | null }

async function createNeonUser(email: string, name: string | null): Promise<string> {
  const base = process.env.NEON_AUTH_BASE_URL
  const key = process.env.NEON_AUTH_ADMIN_KEY
  if (!base || !key) throw new Error('NEON_AUTH_BASE_URL and NEON_AUTH_ADMIN_KEY are required')
  const res = await fetch(`${base}/admin/create-user`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ email, name: name ?? email.split('@')[0], password: cryptoRandom(), emailVerified: true }),
  })
  if (!res.ok) throw new Error(`create-user ${email}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const json = await res.json() as { user?: { id: string }; id?: string }
  const id = json.user?.id ?? json.id
  if (!id) throw new Error(`create-user ${email}: no id in response`)
  return id
}

async function requestReset(email: string): Promise<void> {
  const base = process.env.NEON_AUTH_BASE_URL!
  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://constellation.hoku.fm'}/auth/reset-password`
  const res = await fetch(`${base}/request-password-reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, redirectTo }) })
  if (!res.ok) console.warn(`  reset email for ${email} failed: ${res.status}`)
}

function cryptoRandom(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('')
}

const USER_ACCOUNT_SQL = `
insert into user_account (user_id, subscription_tier, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, watch_entity_ids, is_staff, created_at)
select m.neon_user_id,
       case when up.subscription_tier in ('free','individual','professional','institutional') then up.subscription_tier else 'free' end,
       coalesce(up.subscription_status, 'inactive'), up.stripe_customer_id, up.stripe_subscription_id, up.trial_ends_at,
       coalesce(up.alert_person_ids, '{}') || coalesce(up.alert_org_ids, '{}'),
       exists (select 1 from legacy.staff_role s where s.user_id = up.id),
       coalesce(up.created_at, now())
  from legacy.user_profile up
  join migration_user_map m on m.legacy_user_id = up.id
on conflict (user_id) do nothing`

export async function migrateUsers(db: ReturnType<typeof wrapPg>, opts: { dry: boolean; sendEmail: boolean; create?: (email: string, name: string | null) => Promise<string> }) {
  const hasAuth = await db.one(`select 1 from information_schema.tables where table_schema = 'legacy' and table_name = 'users'`)
  const users = hasAuth
    ? await db.many<LegacyUser>(`select id, email, created_at, email_confirmed_at, raw_user_meta_data from legacy.users where email is not null order by created_at`)
    : []
  const already = new Set((await db.many<{ legacy_user_id: string }>(`select legacy_user_id from migration_user_map`)).map(r => r.legacy_user_id))
  const pending = users.filter(u => !already.has(u.id))
  console.log(`[users] legacy auth users: ${users.length}; already mapped: ${already.size}; to migrate: ${pending.length}`)
  let migrated = 0
  for (const u of pending) {
    const name = (u.raw_user_meta_data?.full_name as string | undefined) ?? (u.raw_user_meta_data?.name as string | undefined) ?? null
    if (opts.dry) { console.log(`  [dry] would create ${u.email}`); continue }
    const neonId = await (opts.create ?? createNeonUser)(u.email, name)
    await db.query(`insert into migration_user_map (legacy_user_id, neon_user_id, email) values ($1, $2, $3) on conflict (legacy_user_id) do nothing`, [u.id, neonId, u.email])
    if (opts.sendEmail) await requestReset(u.email)
    migrated++
  }
  if (!opts.dry) {
    const r = await db.query(USER_ACCOUNT_SQL)
    console.log(`[users] user_account rows inserted: ${r.rowCount}`)
  }
  console.log(`[users] migrated ${migrated} user(s)`)
  return { total: users.length, migrated }
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL required')
  const pool = new Pool({ connectionString: url, max: 2 })
  try { await migrateUsers(wrapPg(pool as never), { dry: DRY, sendEmail: SEND_EMAIL }) } finally { await pool.end() }
}

if (process.argv[1]?.endsWith('migrate-users.ts')) main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
