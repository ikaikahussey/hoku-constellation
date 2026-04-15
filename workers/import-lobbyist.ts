import { createAdminClient } from './lib/supabase'
import { log, logError } from './lib/logger'
import { importLobbyistFull } from '@/lib/import/sources/lobbyist'

const SOURCE = 'lobbyist'

async function main() {
  const supabase = createAdminClient()

  await supabase.from('import_cursor').upsert({
    source: SOURCE,
    status: 'running',
    last_run_at: new Date().toISOString(),
  })

  log('Lobbyist import starting')

  try {
    const result = await importLobbyistFull()
    await supabase.from('import_cursor').upsert({
      source: SOURCE,
      status: 'complete',
      last_run_at: new Date().toISOString(),
      metadata: { inserted: result.inserted },
    })
    log(`Lobbyist import complete: inserted=${result.inserted}`)
  } catch (e) {
    logError('Lobbyist import failed', e)
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
