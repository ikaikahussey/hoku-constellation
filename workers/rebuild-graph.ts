import { getWorkerDb, closeWorkerDb, workerArgs } from './lib/db'
import { log, logError } from './lib/logger'
import { rebuildGraph, deriveEdges } from '@/lib/analytics'

async function main() {
  const { dry } = workerArgs()
  const db = getWorkerDb()
  log(`Rebuild graph starting (dry=${dry})`)
  try {
    if (dry) {
      const edges = await deriveEdges(db)
      log(`Dry run: would write ${edges.length} derived edges`)
      return
    }
    const r = await rebuildGraph(db)
    log(`Rebuild graph complete: edges=${r.edges}, nodes=${r.nodes}, clusters=${r.clusters}`)
  } catch (e) {
    logError('Rebuild graph failed', e)
    throw e
  } finally {
    await closeWorkerDb()
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(1))
