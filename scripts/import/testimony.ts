/**
 * Legislative testimony ingestion (capitol.hawaii.gov).
 * Target: legislative_testimony.
 *
 * NOTE: full PDF parsing requires `pdf-parse` (not currently in deps).
 * This script is scaffolded to ingest structured CSV/JSON testimony feeds first;
 * PDF fallback is left as a TODO hook.
 *
 * Usage: npx tsx scripts/import/testimony.ts --session=2026 [--dry] [--limit=500]
 */
import { createClient } from '@supabase/supabase-js'
import { insertSourceRecord, updateCursor } from './utils/dedup'
import { matchEntity, autoMatchThreshold } from '../../lib/entity-match'

const SOURCE = 'testimony'

interface Args { dry: boolean; session: string; limit: number; file?: string }
function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let dry = false, session = String(new Date().getFullYear()), limit = 500, file: string | undefined
  for (const a of argv) {
    if (a === '--dry') dry = true
    else if (a.startsWith('--session=')) session = a.split('=')[1]
    else if (a.startsWith('--limit=')) limit = parseInt(a.split('=')[1], 10)
    else if (a.startsWith('--file=')) file = a.split('=')[1]
  }
  return { dry, session, limit, file }
}

interface TestimonyRow {
  bill_number: string
  committee?: string
  hearing_date?: string
  testifier_name?: string
  testifier_org?: string
  position: 'support' | 'oppose' | 'comment'
  testimony_url?: string
}

async function loadRows(file: string | undefined): Promise<TestimonyRow[]> {
  if (file) {
    const fs = await import('fs/promises')
    const raw = await fs.readFile(file, 'utf-8')
    return JSON.parse(raw) as TestimonyRow[]
  }
  // TODO: scrape capitol.hawaii.gov bill index and download hearing notices / testimony packets.
  // Return empty in the default path so the script is idempotent and exits cleanly.
  return []
}

async function run() {
  const { dry, session, limit, file } = parseArgs()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  console.log(`[${SOURCE}] starting (dry=${dry}, session=${session}, file=${file ?? 'none'})`)

  const [{ data: people }, { data: orgs }] = await Promise.all([
    supabase.from('person').select('id, full_name, aliases').limit(20000),
    supabase.from('organization').select('id, name, aliases').limit(10000),
  ])
  const personIndex = people ?? []
  const orgIndex = orgs ?? []

  const rows = (await loadRows(file)).slice(0, limit)
  let inserted = 0, skipped = 0, errors = 0

  for (const row of rows) {
    if (!dry) {
      const { inserted: isNew } = await insertSourceRecord(supabase, {
        source_id: `${row.bill_number}:${row.testifier_name ?? 'anon'}:${row.hearing_date ?? ''}`,
        source_name: SOURCE,
        raw_data: row,
      })
      if (!isNew) { skipped++; continue }
    }

    const personMatch = row.testifier_name ? matchEntity(row.testifier_name, personIndex)[0] : undefined
    const orgMatch = row.testifier_org ? matchEntity(row.testifier_org, orgIndex)[0] : undefined
    const confidence = personMatch?.confidence ?? orgMatch?.confidence ?? null

    const record = {
      person_id: personMatch?.id ?? null,
      organization_id: orgMatch?.id ?? null,
      person_name_raw: row.testifier_name ?? null,
      org_name_raw: row.testifier_org ?? null,
      match_confidence: confidence,
      match_status: confidence ? autoMatchThreshold(confidence) : 'unmatched',
      bill_number: row.bill_number,
      session,
      committee: row.committee ?? null,
      position: row.position,
      hearing_date: row.hearing_date ?? null,
      testimony_url: row.testimony_url ?? null,
      raw_record: row,
    }

    if (dry) { inserted++; continue }
    const { error } = await supabase.from('legislative_testimony').insert(record)
    if (error) { errors++; console.error(`[${SOURCE}] ${error.message}`) }
    else inserted++
  }

  if (!dry) await updateCursor(supabase, SOURCE, inserted + skipped, 'complete', { inserted, skipped, errors })
  console.log(`[${SOURCE}] done: inserted=${inserted} skipped=${skipped} errors=${errors}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
