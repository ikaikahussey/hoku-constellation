#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * Copies the legacy Supabase tables into a `legacy` schema on Neon using only the Supabase REST API
 * (service-role key) and a `pg` connection — no pg_dump, no database password, so it can run from a
 * Vercel Sandbox. Alternative to scripts/db/restore-legacy.sh.
 *
 *   1. creates schema `legacy` from db/legacy_migrations/*.sql (tables only; policies/indexes stripped)
 *   2. for every table the port reads, pages through PostgREST (1,000 rows, ordered by primary key)
 *      (keyset on `id` where present, so it resumes after the rows already copied) and inserts with
 *      json_populate_recordset … on conflict do nothing (idempotent)
 *   3. prints source count vs. copied count per table
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL_UNPOOLED (or DATABASE_URL)
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/db/export-supabase-rest.ts [--tables=person,organization] [--page=1000]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'

const LEGACY_DIR = join(process.cwd(), 'db', 'legacy_migrations')

/** Same stripping as tests/helpers/legacy.ts: tables, functions and triggers survive; Supabase RLS/index DDL does not. */
export function legacySchemaSql(): string {
  const files = readdirSync(LEGACY_DIR).filter(f => f.endsWith('.sql')).sort()
  return files.map(f => readFileSync(join(LEGACY_DIR, f), 'utf8')).join('\n')
    .replace(/create( unique)? index[\s\S]*?;\s*/gi, '')
    .replace(/create policy[\s\S]*?;\s*/gi, '')
    .replace(/drop policy[^;]*;\s*/gi, '')
    .replace(/alter table \w+ enable row level security;\s*/gi, '')
    .replace(/--.*$/gm, '')
}

/** Tables the port reads (scripts/db/port-legacy.sql), in dependency order. */
export const LEGACY_TABLES = [
  'person', 'organization', 'relationship', 'contribution', 'lobbyist_registration', 'lobbyist_expenditure',
  'org_lobbying_expenditure', 'financial_disclosure', 'puc_docket', 'puc_participant', 'article', 'article_entity_mention',
  'timeline_event', 'legislative_testimony', 'government_contract', 'property_ownership', 'data_source_record',
  'user_profile', 'staff_role', 'import_cursor',
]

interface Env { url: string; key: string; db: string }

function env(): Env {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const db = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  if (!url || !key || !db) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL_UNPOOLED are required')
  return { url: url.replace(/\/$/, ''), key, db }
}

async function restCount(e: Env, table: string): Promise<number | null> {
  const res = await fetch(`${e.url}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: e.key, authorization: `Bearer ${e.key}`, prefer: 'count=exact', 'range-unit': 'items', range: '0-0' } })
  if (res.status === 404) return null
  if (!res.ok && res.status !== 206) throw new Error(`${table}: count ${res.status} ${(await res.text()).slice(0, 200)}`)
  const cr = res.headers.get('content-range') ?? ''
  const total = cr.split('/')[1]
  return total && total !== '*' ? Number(total) : null
}

/**
 * Pages through a table. Tables with an `id` column use keyset pagination (`id > last`), which stays fast at
 * any depth and lets a re-run resume after the rows already copied; small tables without `id` use offsets.
 */
async function* restPages(e: Env, table: string, orderBy: string, page: number, startAfter: string | null): AsyncGenerator<Record<string, unknown>[]> {
  const keyset = orderBy === 'id'
  let last: string | null = startAfter
  let offset = 0
  for (;;) {
    const cursor = keyset ? (last ? `&id=gt.${encodeURIComponent(last)}` : '') : `&offset=${offset}`
    const url = `${e.url}/rest/v1/${table}?select=*&order=${orderBy}.asc&limit=${page}${cursor}`
    let res: Response | null = null
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        res = await fetch(url, { headers: { apikey: e.key, authorization: `Bearer ${e.key}` } })
      } catch { res = null }
      if (res?.ok) break
      const status = res?.status ?? 0
      if (status === 0 || status >= 500 || status === 429 || status === 408) { await new Promise(r => setTimeout(r, Math.min(60_000, 1000 * 2 ** attempt))); continue }
      throw new Error(`${table}: page ${status} ${(await res!.text()).slice(0, 200)}`)
    }
    if (!res?.ok) throw new Error(`${table}: gave up after retries (last=${last ?? offset})`)
    const rows = (await res.json()) as Record<string, unknown>[]
    if (!rows.length) return
    yield rows
    if (keyset) last = String(rows[rows.length - 1].id)
    else offset += rows.length
    if (rows.length < page) return
  }
}

export async function exportLegacy(opts: { tables?: string[]; page?: number; log?: (m: string) => void } = {}) {
  const e = env()
  const log = opts.log ?? console.log
  const page = opts.page ?? 1000
  const client = new Client({ connectionString: e.db, statement_timeout: 0 })
  await client.connect()
  const summary: Array<{ table: string; source: number | null; copied: number; inserted: number }> = []
  try {
    await client.query(`create schema if not exists legacy`)
    await client.query(`set search_path to legacy, public`)
    await client.query(legacySchemaSql())
    await client.query(`set search_path to public`)
    log('[export] legacy schema ready')
    for (const table of opts.tables ?? LEGACY_TABLES) {
      const exists = await client.query(`select 1 from information_schema.tables where table_schema = 'legacy' and table_name = $1`, [table])
      if (!exists.rowCount) { log(`[export] ${table}: not in legacy schema, skipped`); continue }
      const source = await restCount(e, table)
      if (source === null) { log(`[export] ${table}: not exposed by Supabase REST (404), skipped`); continue }
      const cols = await client.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'legacy' and table_name = $1 order by ordinal_position`, [table])
      const names = cols.rows.map(c => c.column_name)
      const orderBy = names.includes('id') ? 'id' : names[0]
      const before = Number((await client.query<{ n: string }>(`select count(*)::text n from legacy.${table}`)).rows[0].n)
      // Resume: keyset tables continue after the largest id already copied.
      const startAfter = orderBy === 'id' && before > 0 ? (await client.query<{ m: string | null }>(`select max(id)::text m from legacy.${table}`)).rows[0].m : null
      if (startAfter) log(`[export] ${table}: resuming after id ${startAfter} (${before} rows already copied)`)
      let copied = before
      for await (const rows of restPages(e, table, orderBy, page, startAfter)) {
        // Drop columns the legacy DDL does not know (REST may expose generated/newer columns).
        const clean = rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => names.includes(k))))
        await client.query(`insert into legacy.${table} select * from json_populate_recordset(null::legacy.${table}, $1::json) on conflict do nothing`, [JSON.stringify(clean)])
        copied += rows.length
        if (copied % 10000 === 0 || copied === source) log(`[export] ${table}: ${copied}/${source ?? '?'}`)
      }
      const after = Number((await client.query<{ n: string }>(`select count(*)::text n from legacy.${table}`)).rows[0].n)
      summary.push({ table, source, copied: after, inserted: after - before })
      log(`[export] ${table}: source=${source} copied=${copied} inserted=${after - before} total=${after}`)
    }
  } finally {
    await client.end()
  }
  return summary
}

async function main() {
  const args = process.argv.slice(2)
  const get = (f: string) => { const a = args.find(x => x.startsWith(`--${f}=`)); return a ? a.split('=')[1] : undefined }
  const summary = await exportLegacy({ tables: get('tables')?.split(','), page: get('page') ? Number(get('page')) : undefined })
  const mismatched = summary.filter(s => s.source != null && s.copied < s.source)
  console.log('\n| table | source rows | copied | inserted |\n|---|---|---|---|')
  for (const s of summary) console.log(`| ${s.table} | ${s.source ?? '?'} | ${s.copied} | ${s.inserted} |`)
  if (mismatched.length) { console.error(`[export] ${mismatched.length} table(s) copied fewer rows than the source reports`); process.exit(1) }
}

if (process.argv[1]?.endsWith('export-supabase-rest.ts')) main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
