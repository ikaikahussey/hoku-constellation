import { createAdminClient } from './lib/supabase'
import { log, logError } from './lib/logger'
import { recomputeAllScoresBatch } from '@/lib/analytics'

async function main() {
  const supabase = createAdminClient()
  log('Recompute scores starting')
  try {
    const count = await recomputeAllScoresBatch(supabase)
    log(`Recompute scores complete: count=${count}`)
  } catch (e) {
    logError('Recompute scores failed', e)
    throw e
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1))
