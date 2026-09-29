/**
 * Priority-entity pass (lib/import/priority.ts): pulls records for staff-flagged entities from the
 * name-searchable sources before the regular sweeps. launchd runs it daily ahead of import-csc/import-fec.
 *   npx tsx --tsconfig workers/tsconfig.json workers/import-priority.ts [--dry] [--source=csc,fec] [--fec-state=HI|all]
 */
import { getWorkerDb, closeWorkerDb } from './lib/db'
import { log, logError } from './lib/logger'
import { parseCliArgs } from '@/lib/import/run'
import { dryDb } from '@/lib/import/dry'
import { runPriorityPassIfDue, PRIORITY_SOURCES, type PrioritySource } from '@/lib/import/priority'
import { runAlertPipeline } from '@/lib/alerts'

async function main(): Promise<void> {
  const args = parseCliArgs()
  const real = getWorkerDb()
  const db = args.dry ? dryDb(real) : real
  const sources = args.params.source?.split(',').filter((s): s is PrioritySource => (PRIORITY_SOURCES as readonly string[]).includes(s))
  const fecState = args.params['fec-state'] === 'all' ? null : (args.params['fec-state'] ?? 'HI')
  try {
    const summary = await runPriorityPassIfDue(db, { force: true, sources, fecState, log: m => log(`[priority] ${m}`) })
    if (!summary) { log('priority: no entities flagged'); return }
    log(`priority finished: targets=${summary.targets} documents=${summary.documents} edges=${summary.edges} errors=${summary.errors}`)
    if (!args.dry && summary.documents + summary.edges > 0) {
      const r = await runAlertPipeline(db)
      log(`priority alerts: events=${r.match.events} sent=${r.delivery.sent}`)
    }
  } catch (e) {
    logError('priority failed', e)
    throw e
  } finally {
    await closeWorkerDb()
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(1))
