#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * Applies db/migrations/*.sql in order over a plain `pg` connection (no psql required, so it runs
 * from Vercel Sandbox or any Node host). Every migration file is written to be idempotent
 * (`create … if not exists`, `create or replace`), so re-running is safe.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/db/migrate.ts [--dry]
 * Env: DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'

const DIR = join(process.cwd(), 'db', 'migrations')

export function migrationFiles(): string[] {
  return readdirSync(DIR).filter(f => /^\d+_.*\.sql$/.test(f)).sort().map(f => join(DIR, f))
}

async function main() {
  const dry = process.argv.includes('--dry')
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL required')
  const files = migrationFiles()
  console.log(`[migrate] ${files.length} file(s): ${files.map(f => f.split('/').pop()).join(', ')}`)
  if (dry) return
  const client = new Client({ connectionString: url, statement_timeout: 0 })
  await client.connect()
  try {
    for (const f of files) {
      const started = Date.now()
      await client.query(readFileSync(f, 'utf8'))
      console.log(`[migrate] applied ${f.split('/').pop()} in ${Date.now() - started}ms`)
    }
    const tables = await client.query<{ n: string }>(`select count(*)::text n from information_schema.tables where table_schema = 'public'`)
    console.log(`[migrate] public tables: ${tables.rows[0].n}`)
  } finally {
    await client.end()
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
