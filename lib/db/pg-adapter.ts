/**
 * Wraps any node-postgres compatible pool/client (`pg`, `@neondatabase/serverless`) into the `Db`
 * interface. Kept driver-agnostic so workers (pg) and Vercel functions (neon serverless) share it.
 */
import type { Db, QueryResult } from './types'

export interface PgLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>
}

export interface PgPoolLike extends PgLike {
  connect(): Promise<PgClientLike>
  end(): Promise<void>
}

export interface PgClientLike extends PgLike {
  release(): void
}

export function wrapPg(pool: PgPoolLike): Db {
  return makeDb(pool, async fn => {
    const client = await pool.connect()
    try {
      await client.query('begin')
      const result = await fn(makeDb(client, async inner => inner(makeDb(client, () => Promise.reject(new Error('nested transaction')), async () => {})), async () => {}))
      await client.query('commit')
      return result
    } catch (e) {
      try { await client.query('rollback') } catch { /* ignore */ }
      throw e
    } finally {
      client.release()
    }
  }, () => pool.end())
}

export function makeDb(
  conn: PgLike,
  transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>,
  end: () => Promise<void>
): Db {
  const db: Db = {
    async query<T>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
      const res = await conn.query(text, params ? [...params] : undefined)
      return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length }
    },
    async one<T>(text: string, params?: readonly unknown[]): Promise<T | null> {
      const res = await db.query<T>(text, params)
      return res.rows[0] ?? null
    },
    async many<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
      return (await db.query<T>(text, params)).rows
    },
    transaction,
    end,
  }
  return db
}
