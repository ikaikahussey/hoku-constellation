import { getWorkerDb, closeWorkerDb, workerArgs } from './lib/db'
import { log, logError } from './lib/logger'
import { recomputeAllScoresBatch, computeAllScores } from '@/lib/analytics'

async function main() {
  const { dry } = workerArgs()
  const db = getWorkerDb()
  log(`Recompute scores starting (dry=${dry})`)
  try {
    if (dry) {
      const rows = await computeAllScores(db)
      log(`Dry run: would score ${rows.length} persons`)
      return
    }
    const count = await recomputeAllScoresBatch(db)
    log(`Recompute scores complete: count=${count}`)
  } catch (e) {
    logError('Recompute scores failed', e)
    throw e
  } finally {
    await closeWorkerDb()
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(1))
