/**
 * Dry-run support: wraps a Db so writes are simulated. Inserts return synthetic ids; reads pass through.
 * Used by every importer when opts.dry is set so `--dry` never touches the database.
 */
import type { Db, QueryResult } from '@/lib/db/types'

const WRITE = /^\s*(insert|update|delete|truncate|alter|create|drop)\b/i

export function dryDb(db: Db): Db {
  const fakeId = () => `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`
  const wrapped: Db = {
    async query<T>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
      if (WRITE.test(text)) {
        const returning = /returning\s+id/i.test(text)
        return { rows: returning ? ([{ id: fakeId() }] as unknown as T[]) : [], rowCount: 1 }
      }
      return db.query<T>(text, params)
    },
    async one<T>(text: string, params?: readonly unknown[]) { return (await wrapped.query<T>(text, params)).rows[0] ?? null },
    async many<T>(text: string, params?: readonly unknown[]) { return (await wrapped.query<T>(text, params)).rows },
    async transaction<T>(fn: (tx: Db) => Promise<T>) { return fn(wrapped) },
    async end() {},
  }
  return wrapped
}
