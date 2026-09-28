/**
 * Privileged database access (owner or `ingest_writer` role) over the Neon connection string.
 *
 *   - Vercel functions / edge-adjacent runtimes: @neondatabase/serverless Pool (WebSocket).
 *   - Mac mini workers, CLIs, scripts: `pg` Pool.
 *
 * Selection: HOKU_DB_DRIVER=pg|neon overrides; otherwise `neon` when running on Vercel.
 * Replaces SUPABASE_SERVICE_ROLE_KEY everywhere. Never import this from client components.
 */
import type { Db } from './types'
import { wrapPg, type PgPoolLike } from './pg-adapter'

// One pool per process even when the bundler instantiates this module once per route chunk
// (Next.js/Turbopack does): otherwise every route group opens its own connections.
const g = globalThis as unknown as { __hokuServiceDb?: Db | null; __hokuServiceDbOverride?: Db | null }

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

function pickDriver(): 'pg' | 'neon' {
  const forced = process.env.HOKU_DB_DRIVER
  if (forced === 'pg' || forced === 'neon') return forced
  return process.env.VERCEL ? 'neon' : 'pg'
}

async function createPool(): Promise<PgPoolLike> {
  const connectionString = getDatabaseUrl()
  if (pickDriver() === 'neon') {
    const { Pool, neonConfig } = await import('@neondatabase/serverless')
    if (typeof WebSocket === 'undefined') {
      const ws = await import('ws')
      neonConfig.webSocketConstructor = ws.default as unknown as typeof WebSocket
    }
    return new Pool({ connectionString, max: 5 }) as unknown as PgPoolLike
  }
  const { Pool } = await import('pg')
  return new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 8), idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000) }) as unknown as PgPoolLike
}

/**
 * Pooled direct connection with a typed query helper. Lazily created once per process.
 */
export async function getServiceDb(): Promise<Db> {
  if (g.__hokuServiceDbOverride) return g.__hokuServiceDbOverride
  if (!g.__hokuServiceDb) g.__hokuServiceDb = wrapPg(await createPool())
  return g.__hokuServiceDb
}

/** Test hook: route getServiceDb() to an in-process database. */
export function setServiceDbForTests(db: Db | null): void {
  g.__hokuServiceDbOverride = db
}

/** Close the pool (workers/CLIs call this before exit). */
export async function closeServiceDb(): Promise<void> {
  if (g.__hokuServiceDb) {
    await g.__hokuServiceDb.end()
    g.__hokuServiceDb = null
  }
}
