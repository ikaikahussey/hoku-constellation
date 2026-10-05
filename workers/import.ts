/**
 * Generic ingestion worker: `npx tsx --tsconfig workers/tsconfig.json workers/import.ts <source> [--dry] [--limit=N] [--key=value]`
 * Each workers/import-<source>.ts is a one-line wrapper around this so launchd labels stay per-source.
 */
import { getWorkerDb, closeWorkerDb } from './lib/db'
import { log, logError } from './lib/logger'
import { runImporter, parseCliArgs } from '@/lib/import/run'
import { loadImporter } from '@/lib/import/sources'
import { getSource } from '@/lib/import/source-registry'
import { runAlertPipeline } from '@/lib/alerts'

export async function runWorker(source: string, argv = process.argv.slice(2)): Promise<void> {
  const args = parseCliArgs(argv.filter(a => a !== source))
  const def = getSource(source)
  for (const secret of def.secrets ?? []) if (!process.env[secret]) log(`warning: ${secret} not set`)
  const db = getWorkerDb()
  log(`import ${source} starting (dry=${!!args.dry}, limit=${args.limit ?? '∞'})`)
  try {
    const mod = await loadImporter(source)
    const summary = await runImporter(db, source, mod.importBatch, {
      // Snapshot sources (e.g. news feeds) start over once the previous run completed.
      restartIfComplete: def.restartOnComplete === true,
      ...args, log: (m) => log(`[${source}] ${m}`),
      // E2: match new documents/edges against alert rules as soon as each batch commits.
      onBatchCommitted: async () => {
        const r = await runAlertPipeline(db)
        if (r.match.events) log(`[${source}] alerts: events=${r.match.events} sent=${r.delivery.sent} collapsed=${r.delivery.collapsed}`)
      },
    })
    log(`import ${source} finished: documents=${summary.documents} edges=${summary.edges} entities=${summary.entitiesCreated} errors=${summary.errors} done=${summary.done}`)
  } catch (e) {
    logError(`import ${source} failed`, e)
    throw e
  } finally {
    await closeWorkerDb()
  }
}

if (process.argv[1]?.endsWith('workers/import.ts') || process.argv[1]?.endsWith('workers/import')) {
  const source = process.argv.slice(2).find(a => !a.startsWith('--'))
  if (!source) { console.error('usage: workers/import.ts <source> [--dry] [--limit=N]'); process.exit(2) }
  runWorker(source).then(() => process.exit(0)).catch(() => process.exit(1))
}
