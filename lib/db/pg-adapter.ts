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
  const tx = async <T,>(fn: (tx: Db) => Promise<T>): Promise<T> => {
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
  }
  return makeDb(pool, tx, () => pool.end(), { retryConnectionErrors: true })
}

/** Connection-level failures (idle connection dropped by Neon/PgBouncer, socket reset) — safe to retry once on a fresh pooled client. */
export function isConnectionError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null
  if (!err) return false
  return ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '57P01', '08006', '08003'].includes(err.code ?? '') || /Connection terminated|terminating connection|socket hang up/i.test(err.message ?? '')
}

export function makeDb(
  conn: PgLike,
  transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>,
  end: () => Promise<void>,
  opts: { retryConnectionErrors?: boolean } = {}
): Db {
  const db: Db = {
    async query<T>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
      const run = async () => {
        const res = await conn.query(text, params ? [...params] : undefined)
        return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length }
      }
      try { return await run() } catch (e) {
        if (opts.retryConnectionErrors && isConnectionError(e)) {
          await new Promise(r => setTimeout(r, 50)) // let the pool evict the dead client
          return run()
        }
        throw e
      }
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
