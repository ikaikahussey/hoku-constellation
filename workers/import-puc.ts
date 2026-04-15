import { createAdminClient } from './lib/supabase'
import { log, logError } from './lib/logger'
import { importPUCFull } from '@/lib/import/sources/puc'

const SOURCE = 'puc'

async function main() {
  const supabase = createAdminClient()

  await supabase.from('import_cursor').upsert({
    source: SOURCE,
    status: 'running',
    last_run_at: new Date().toISOString(),
  })

  log('PUC import starting')

  try {
    const result = await importPUCFull()
    await supabase.from('import_cursor').upsert({
      source: SOURCE,
      status: 'complete',
      last_run_at: new Date().toISOString(),
      metadata: { inserted: result.inserted },
    })
    log(`PUC import complete: inserted=${result.inserted}`)
  } catch (e) {
    logError('PUC import failed', e)
    await supabase.from('import_cursor').upsert({
      source: SOURCE,
      status: 'idle',
      last_run_at: new Date().toISOString(),
      metadata: { error: e instanceof Error ? e.message : 'Unknown error' },
    })
    throw e
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1))
