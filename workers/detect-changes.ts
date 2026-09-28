import { getWorkerDb, closeWorkerDb, workerArgs } from './lib/db'
import { log, logError } from './lib/logger'
import { detectChanges } from '@/lib/analytics'

async function main() {
  const { dry } = workerArgs()
  const db = getWorkerDb()
  const since = new Date(Date.now() - 75 * 60 * 1000).toISOString()
  log(`Detect changes starting (since=${since}, dry=${dry})`)
  try {
    if (dry) {
      const n = await db.one<{ n: string }>(`select count(*)::text n from document where fetched_at >= $1`, [since])
      log(`Dry run: ${n?.n ?? 0} documents ingested since window start; no alerts written`)
      return
    }
    const { inserted } = await detectChanges(db, since)
    log(`Detect changes complete: inserted=${inserted}`)
  } catch (e) {
    logError('Detect changes failed', e)
    throw e
  } finally {
    await closeWorkerDb()
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(1))
