#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * CLI: npx tsx --tsconfig tsconfig.scripts.json scripts/import/priority.ts [--dry] [--source=csc,fec] [--fec-state=HI|all] [--max-pages=N]
 * Runs the priority-entity pass now (lib/import/priority.ts) against DATABASE_URL, regardless of cadence.
 */
import { getServiceDb, closeServiceDb } from '@/lib/db/service'
import { parseCliArgs } from '@/lib/import/run'
import { dryDb } from '@/lib/import/dry'
import { runPriorityPassIfDue, PRIORITY_SOURCES, type PrioritySource } from '@/lib/import/priority'

const args = parseCliArgs()
;(async () => {
  const real = await getServiceDb()
  const db = args.dry ? dryDb(real) : real
  try {
    const sources = args.params.source?.split(',').filter((s): s is PrioritySource => (PRIORITY_SOURCES as readonly string[]).includes(s))
    const summary = await runPriorityPassIfDue(db, {
      force: true, sources,
      fecState: args.params['fec-state'] === 'all' ? null : (args.params['fec-state'] ?? 'HI'),
      maxPages: args.params['max-pages'] ? Number(args.params['max-pages']) : undefined,
      log: m => console.log(`[priority] ${m}`),
    })
    console.log(JSON.stringify(summary ?? { message: 'no entities flagged as priority' }, null, 2))
  } finally {
    await closeServiceDb()
  }
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
