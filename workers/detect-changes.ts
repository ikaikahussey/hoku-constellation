import { createAdminClient } from './lib/supabase'
import { log, logError } from './lib/logger'
import { detectChanges } from '@/lib/analytics'

async function main() {
  const supabase = createAdminClient()
  const since = new Date(Date.now() - 75 * 60 * 1000).toISOString()
  log(`Detect changes starting (since=${since})`)
  try {
    const { inserted } = await detectChanges(supabase, since)
    log(`Detect changes complete: inserted=${inserted}`)
  } catch (e) {
    logError('Detect changes failed', e)
    throw e
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1))
