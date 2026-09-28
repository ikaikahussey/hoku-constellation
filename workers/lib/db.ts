/**
 * Worker database access: `pg` Pool over DATABASE_URL (direct or pooled). Same `Db` interface as the
 * app, so lib/analytics and lib/import run unchanged on the Mac mini.
 */
import { Pool } from 'pg'
import { wrapPg } from '@/lib/db/pg-adapter'
import type { Db } from '@/lib/db/types'

let pool: Pool | null = null
let db: Db | null = null

export function getWorkerDb(): Db {
  if (db) return db
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!url) throw new Error('Missing DATABASE_URL (or DATABASE_URL_UNPOOLED) in workers/.env')
  pool = new Pool({ connectionString: url, max: 4 })
  db = wrapPg(pool as never)
  return db
}

export async function closeWorkerDb(): Promise<void> {
  await pool?.end()
  pool = null
  db = null
}

/** Parsed worker CLI flags: --dry, --limit=N */
export function workerArgs(): { dry: boolean; limit: number | null } {
  const argv = process.argv.slice(2)
  const dry = argv.includes('--dry')
  const lim = argv.find(a => a.startsWith('--limit='))
  return { dry, limit: lim ? Number(lim.split('=')[1]) : null }
}
