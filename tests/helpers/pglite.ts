/**
 * In-process Postgres for tests (PGlite with pgvector + pg_trgm). Applies db/migrations/*.sql.
 *
 * When TEST_DATABASE_URL is set (a Neon test branch), the same helpers run against it with `pg`
 * so the RLS suite can be executed against real Neon roles before cutover.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import type { Db, QueryResult } from '@/lib/db/types'
import { wrapPg } from '@/lib/db/pg-adapter'

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations')

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
}

export function readMigrations(): string {
  return migrationFiles().map(f => readFileSync(join(MIGRATIONS_DIR, f), 'utf8')).join('\n\n')
}

export interface TestDb extends Db {
  /** Execute a multi-statement SQL script. */
  exec(sql: string): Promise<void>
  /** Impersonate a Neon Auth user (or anonymous) for RLS tests. Returns a function that runs a query under that identity. */
  as(role: 'authenticated' | 'anonymous' | 'owner', userId?: string | null): <T = Record<string, unknown>>(text: string, params?: readonly unknown[]) => Promise<QueryResult<T>>
  raw: PGlite | null
}

function pgliteDb(pg: PGlite): TestDb {
  const base: Db = {
    async query<T>(text: string, params?: readonly unknown[]) {
      const res = await pg.query<T>(text, params ? [...params] : undefined)
      return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length }
    },
    async one<T>(text: string, params?: readonly unknown[]) {
      return (await base.query<T>(text, params)).rows[0] ?? null
    },
    async many<T>(text: string, params?: readonly unknown[]) {
      return (await base.query<T>(text, params)).rows
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      return pg.transaction(async tx => {
        const txDb: Db = {
          async query<U>(text: string, params?: readonly unknown[]) {
            const res = await tx.query<U>(text, params ? [...params] : undefined)
            return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length }
          },
          async one<U>(text: string, params?: readonly unknown[]) { return (await txDb.query<U>(text, params)).rows[0] ?? null },
          async many<U>(text: string, params?: readonly unknown[]) { return (await txDb.query<U>(text, params)).rows },
          transaction: () => Promise.reject(new Error('nested transaction')),
          end: async () => {},
        }
        return fn(txDb)
      })
    },
    async end() { await pg.close() },
  }
  return {
    ...base,
    raw: pg,
    async exec(sql: string) { await pg.exec(sql) },
    as(role, userId = null) {
      return async <T>(text: string, params?: readonly unknown[]) => {
        return pg.transaction(async tx => {
          if (role !== 'owner') {
            const claims = userId ? JSON.stringify({ sub: userId, role }) : ''
            await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
            await tx.query(`set local role ${role}`)
          }
          const res = await tx.query<T>(text, params ? [...params] : undefined)
          return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length } as QueryResult<T>
        })
      }
    },
  }
}

async function realPgDb(url: string): Promise<TestDb> {
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: url, max: 4 })
  const base = wrapPg(pool as never)
  return {
    ...base,
    raw: null,
    async exec(sql: string) { await pool.query(sql) },
    as(role, userId = null) {
      return async <T>(text: string, params?: readonly unknown[]) => {
        const client = await pool.connect()
        try {
          await client.query('begin')
          if (role !== 'owner') {
            const claims = userId ? JSON.stringify({ sub: userId, role }) : ''
            await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
            await client.query(`set local role ${role}`)
          }
          const res = await client.query(text, params ? [...params] : undefined)
          await client.query('rollback')
          return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length }
        } catch (e) {
          await client.query('rollback').catch(() => {})
          throw e
        } finally {
          client.release()
        }
      }
    },
  }
}

/** Fresh database with the core schema applied. */
export async function createTestDb(opts: { migrate?: boolean } = {}): Promise<TestDb> {
  const migrate = opts.migrate ?? true
  if (process.env.TEST_DATABASE_URL) {
    const db = await realPgDb(process.env.TEST_DATABASE_URL)
    if (migrate) await db.exec(readMigrations())
    return db
  }
  const pg = await PGlite.create({ extensions: { vector, pg_trgm } })
  const db = pgliteDb(pg)
  if (migrate) await db.exec(readMigrations())
  return db
}
