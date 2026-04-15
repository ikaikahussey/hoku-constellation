import { createAdminClient } from './lib/supabase'
import { log, logError } from './lib/logger'
import { importCSCBatch } from '@/lib/import/sources/csc'

const SOURCE = 'hawaii_csc'
const BATCH_SIZE = 2000

async function main() {
  const supabase = createAdminClient()

  const { data: cursor } = await supabase
    .from('import_cursor')
    .select('*')
    .eq('source', SOURCE)
    .single()

  let offset = 0

  if (cursor) {
    const lastRun = cursor.last_run_at ? new Date(cursor.last_run_at) : null
    const today = new Date().toISOString().split('T')[0]
    const lastRunDay = lastRun?.toISOString().split('T')[0]

    if (lastRunDay === today && cursor.status === 'complete') {
      log('CSC import already complete for today')
      return
    }

    if (lastRunDay !== today) {
      offset = 0
    } else {
      offset = cursor.cursor_offset || 0
    }
  }

  await supabase.from('import_cursor').upsert({
    source: SOURCE,
    cursor_offset: offset,
    status: 'running',
    last_run_at: new Date().toISOString(),
  })

  log(`CSC import starting at offset ${offset}`)

  let totalInserted = 0
  let totalPersons = 0
  let batches = 0

  try {
    while (true) {
      const result = await importCSCBatch(offset, BATCH_SIZE)
      batches++
      totalInserted += result.inserted
      totalPersons += result.personsCreated
      offset = result.nextOffset

      log(
        `Batch ${batches}: inserted=${result.inserted}, persons=${result.personsCreated}, nextOffset=${offset}, done=${result.done}`
      )

      const newStatus = result.done ? 'complete' : 'running'
      await supabase.from('import_cursor').upsert({
        source: SOURCE,
        cursor_offset: offset,
        status: newStatus,
        last_run_at: new Date().toISOString(),
        metadata: { last_inserted: result.inserted, last_persons_created: result.personsCreated },
      })

      if (result.done) break
    }

    log(
      `CSC import complete. Batches=${batches}, total inserted=${totalInserted}, persons created=${totalPersons}`
    )
  } catch (e) {
    logError('CSC import failed', e)
    await supabase.from('import_cursor').upsert({
      source: SOURCE,
      cursor_offset: offset,
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
