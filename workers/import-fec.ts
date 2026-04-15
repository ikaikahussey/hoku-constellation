import { createAdminClient } from './lib/supabase'
import { log, logError } from './lib/logger'
import { importFECFull } from '@/lib/import/sources/fec'

const SOURCE = 'fec'

async function main() {
  const supabase = createAdminClient()

  const { data: cursor } = await supabase
    .from('import_cursor')
    .select('*')
    .eq('source', SOURCE)
    .single()

  if (cursor) {
    const lastRun = cursor.last_run_at ? new Date(cursor.last_run_at) : null
    const today = new Date().toISOString().split('T')[0]
    if (lastRun?.toISOString().split('T')[0] === today && cursor.status === 'complete') {
      log('FEC import already complete for today')
      return
    }
  }

  await supabase.from('import_cursor').upsert({
    source: SOURCE,
    status: 'running',
    last_run_at: new Date().toISOString(),
  })

  log('FEC import starting')

  try {
    const result = await importFECFull()
    await supabase.from('import_cursor').upsert({
      source: SOURCE,
      status: 'complete',
      last_run_at: new Date().toISOString(),
      metadata: { inserted: result.inserted, candidates: result.candidates },
    })
    log(`FEC import complete: inserted=${result.inserted}, candidates=${result.candidates}`)
  } catch (e) {
    logError('FEC import failed', e)
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
