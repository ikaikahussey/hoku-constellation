/**
 * Alerts worker (Mac mini, launchd KeepAlive): every 15 seconds runs the matcher, sends due instant
 * alerts (including quiet-hours deferrals and retries), and sends daily/weekly digests when due.
 * Import workers also run the pipeline after every batch commit, so this loop is the safety net and
 * the digest clock rather than the primary latency path.
 *
 *   npx tsx --tsconfig workers/tsconfig.json workers/alerts.ts [--once]
 */
import { getWorkerDb, closeWorkerDb } from './lib/db'
import { log, logError } from './lib/logger'
import { runAlertPipeline } from '@/lib/alerts'

const TICK_MS = Number(process.env.ALERTS_TICK_MS ?? 15_000)

async function tick() {
  const db = getWorkerDb()
  const r = await runAlertPipeline(db, { digests: true })
  if (r.match.events || r.delivery.claimed || r.digests?.messages) {
    log(`alerts: docs=${r.match.documents} edges=${r.match.edges} events=${r.match.events} deliveries=${r.match.deliveries} sent=${r.delivery.sent} collapsed=${r.delivery.collapsed} failed=${r.delivery.failed} digests=${r.digests?.messages ?? 0} match_ms=${r.match.durationMs}`)
  }
}

async function main() {
  const once = process.argv.includes('--once')
  let stop = false
  process.on('SIGTERM', () => { stop = true })
  process.on('SIGINT', () => { stop = true })
  do {
    try { await tick() } catch (e) { logError('alerts tick failed', e) }
    if (once) break
    await new Promise(r => setTimeout(r, TICK_MS))
  } while (!stop)
  await closeWorkerDb()
}

main().then(() => process.exit(0)).catch(() => process.exit(1))
