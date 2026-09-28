/**
 * Runs scripts/db/port-legacy.sql against DATABASE_URL_UNPOOLED (or DATABASE_URL) and prints a
 * reconciliation report. Re-running is safe: every insert is ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   npx tsx scripts/db/port-legacy.ts               # port + report
 *   npx tsx scripts/db/port-legacy.ts --reconcile   # report only
 *   npx tsx scripts/db/port-legacy.ts --markdown docs/PORT_RECONCILIATION.md
 *
 * Prerequisite: the Supabase public schema restored into a `legacy` schema:
 *   pg_dump --schema=public --no-owner --no-privileges -Fc "$SUPABASE_DB_URL" -f legacy.dump
 *   pg_restore --no-owner --no-acl -d "$DATABASE_URL_UNPOOLED" legacy.dump     (then: alter schema public rename …)
 * See docs/NEON_CUTOVER.md for the exact sequence.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { wrapPg } from '../../lib/db/pg-adapter'
import type { Db } from '../../lib/db/types'

export interface ReconcileRow {
  legacy_table: string
  legacy_rows: string
  documents: string
  edges: string
  entities: string
  legacy_sum: string | null
  core_sum: string | null
  matched: string
  review: string
  unmatched: string
  legacy_distinct_entities: string
  core_distinct_entities: string
  other_rows: string | null
}

export const PORT_SQL = readFileSync(join(process.cwd(), 'scripts/db/port-legacy.sql'), 'utf8')
export const RECONCILE_SQL = readFileSync(join(process.cwd(), 'scripts/db/reconcile.sql'), 'utf8')

export interface CoreCounts { entity: number; document: number; edge: number; user_account: number; import_cursor: number }

export async function coreCounts(db: Db): Promise<CoreCounts> {
  const r = await db.one<Record<keyof CoreCounts, string>>(
    `select (select count(*) from entity)::text entity, (select count(*) from document)::text document,
            (select count(*) from edge)::text edge, (select count(*) from user_account)::text user_account,
            (select count(*) from import_cursor)::text import_cursor`)
  return { entity: +r!.entity, document: +r!.document, edge: +r!.edge, user_account: +r!.user_account, import_cursor: +r!.import_cursor }
}

/** Apply the port. Returns how many rows each core table gained. */
export async function runPort(db: Db, exec: (sql: string) => Promise<void>): Promise<{ before: CoreCounts; after: CoreCounts; inserted: CoreCounts }> {
  const before = await coreCounts(db)
  await exec(PORT_SQL)
  const after = await coreCounts(db)
  const inserted = Object.fromEntries(Object.keys(after).map(k => [k, after[k as keyof CoreCounts] - before[k as keyof CoreCounts]])) as unknown as CoreCounts
  return { before, after, inserted }
}

export async function reconcile(db: Db): Promise<ReconcileRow[]> {
  return db.many<ReconcileRow>(RECONCILE_SQL)
}

/**
 * Expected relationship between legacy rows and core rows for each table. Returns the list of
 * unexplained differences (empty = clean).
 */
export function checkReconciliation(rows: ReconcileRow[]): string[] {
  const problems: string[] = []
  const num = (v: string | null | undefined) => (v == null ? null : Number(v))
  const near = (a: number | null, b: number | null) => a == null || b == null ? a === b : Math.abs(a - b) < 0.005
  for (const r of rows) {
    const legacy = num(r.legacy_rows)!
    const docs = num(r.documents)!
    const edges = num(r.edges)!
    const ents = num(r.entities)!
    switch (r.legacy_table) {
      case 'person':
      case 'organization':
      case 'puc_docket':
        if (ents !== legacy) problems.push(`${r.legacy_table}: ${legacy} legacy rows but ${ents} entities`)
        if (r.legacy_table === 'puc_docket' && docs !== legacy) problems.push(`puc_docket: ${legacy} rows but ${docs} docket_filing documents`)
        break
      case 'article':
      case 'data_source_record':
        if (docs !== legacy) problems.push(`${r.legacy_table}: ${legacy} legacy rows but ${docs} documents`)
        break
      case 'article_entity_mention':
        // Mentions attach to the article's document; one edge per mention.
        if (edges !== legacy) problems.push(`article_entity_mention: ${legacy} rows but ${edges} mentioned_in edges`)
        break
      case 'user_profile':
        // Only rows with a migration_user_map entry can be ported (needs a Neon Auth id).
        break
      case 'import_cursor':
        if (num(r.other_rows)! < legacy) problems.push(`import_cursor: ${legacy} rows but ${r.other_rows} in core`)
        break
      default:
        if (docs !== legacy) problems.push(`${r.legacy_table}: ${legacy} legacy rows but ${docs} documents`)
        if (edges !== legacy) problems.push(`${r.legacy_table}: ${legacy} legacy rows but ${edges} edges`)
        if (!near(num(r.legacy_sum), num(r.core_sum))) problems.push(`${r.legacy_table}: sum(amount) ${r.legacy_sum} vs ${r.core_sum}`)
        if (num(r.legacy_distinct_entities) !== num(r.core_distinct_entities) && !['legislative_testimony', 'property_ownership', 'puc_participant', 'government_contract'].includes(r.legacy_table)) {
          problems.push(`${r.legacy_table}: distinct entities ${r.legacy_distinct_entities} vs ${r.core_distinct_entities}`)
        }
    }
  }
  return problems
}

export function toMarkdown(rows: ReconcileRow[], meta: { inserted?: CoreCounts; secondRun?: CoreCounts; problems: string[]; generatedAt: string }): string {
  const fmt = (v: string | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }))
  const lines = [
    '# Port reconciliation — legacy → core',
    '',
    `Generated ${meta.generatedAt} by \`scripts/db/port-legacy.ts\`.`,
    '',
    '| Legacy table | Legacy rows | Documents | Edges | Entities | Σ amount (legacy) | Σ amount (core) | matched | review | unmatched | distinct entities (legacy → core) |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...rows.map(r => `| ${r.legacy_table} | ${fmt(r.legacy_rows)} | ${fmt(r.documents)} | ${fmt(r.edges)} | ${fmt(r.entities)} | ${fmt(r.legacy_sum)} | ${fmt(r.core_sum)} | ${fmt(r.matched)} | ${fmt(r.review)} | ${fmt(r.unmatched)} | ${fmt(r.legacy_distinct_entities)} → ${fmt(r.core_distinct_entities)} |`),
    '',
  ]
  if (meta.inserted) {
    lines.push('## Rows inserted by this run', '', `entity ${meta.inserted.entity}, document ${meta.inserted.document}, edge ${meta.inserted.edge}, user_account ${meta.inserted.user_account}, import_cursor ${meta.inserted.import_cursor}`, '')
  }
  if (meta.secondRun) {
    lines.push('## Re-run (idempotency check)', '', `entity ${meta.secondRun.entity}, document ${meta.secondRun.document}, edge ${meta.secondRun.edge}, user_account ${meta.secondRun.user_account}, import_cursor ${meta.secondRun.import_cursor} rows inserted`, '')
  }
  lines.push('## Unexplained differences', '')
  lines.push(meta.problems.length ? meta.problems.map(p => `- ${p}`).join('\n') : 'None.')
  lines.push('', '## Explained differences', '',
    '- `article_entity_mention` rows do not get their own document: the mention edge cites the article document (one document per article, one edge per mention).',
    '- `user_profile` rows are ported only where `migration_user_map` maps the legacy `auth.users` id to a Neon Auth user id. Production had 0 users at inventory time.',
    '- `ax_*` tables are not ported; they are rebuilt by `rebuild-graph` and `recompute-scores` after cutover.',
    '- `legislative_testimony`, `property_ownership`, `puc_participant` and `government_contract` reference new `bill` / `parcel` / `docket` / agency entities, so core distinct-entity counts exceed the legacy count by the number of such entities created.',
    '- Legacy `contribution.match_status = recipient_matched` (recipient resolved, donor not) maps to core `review`; `rejected` maps to `unmatched`. Both endpoints resolved → `matched`.',
    '- `import_cursor` rows are carried over and later extended by new sources, so core may hold more rows than legacy.',
  )
  return lines.join('\n') + '\n'
}

async function main() {
  const args = process.argv.slice(2)
  const reconcileOnly = args.includes('--reconcile')
  const mdIdx = args.indexOf('--markdown')
  const mdPath = mdIdx >= 0 ? args[mdIdx + 1] : null
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL required')
  const pool = new Pool({ connectionString: url, max: 2 })
  const db = wrapPg(pool as never)
  const exec = async (sql: string) => { await pool.query(sql) }
  try {
    let inserted: CoreCounts | undefined
    let secondRun: CoreCounts | undefined
    if (!reconcileOnly) {
      console.log('[port] applying scripts/db/port-legacy.sql …')
      inserted = (await runPort(db, exec)).inserted
      console.log('[port] inserted', inserted)
      console.log('[port] re-running for idempotency check …')
      secondRun = (await runPort(db, exec)).inserted
      console.log('[port] second run inserted', secondRun)
    }
    const rows = await reconcile(db)
    const problems = checkReconciliation(rows)
    const md = toMarkdown(rows, { inserted, secondRun, problems, generatedAt: new Date().toISOString() })
    if (mdPath) { writeFileSync(mdPath, md); console.log(`[port] wrote ${mdPath}`) }
    else console.log(md)
    if (problems.length || (secondRun && Object.values(secondRun).some(n => n > 0))) {
      console.error('[port] reconciliation FAILED')
      process.exitCode = 1
    }
  } finally {
    await pool.end()
  }
}

if (process.argv[1]?.endsWith('port-legacy.ts')) {
  main().catch(e => { console.error(e); process.exit(1) })
}
