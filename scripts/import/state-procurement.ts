/**
 * Hawaiʻi state procurement awards → government_contract (source='state_procurement').
 *
 * State Procurement Office publishes awards via hands.ehawaii.gov. This scaffold
 * accepts a normalized JSON file of award records; future passes can swap in a
 * direct scraper.
 *
 * Usage: npx tsx scripts/import/state-procurement.ts --file=awards.json [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { insertSourceRecord, updateCursor } from './utils/dedup'
import { matchEntity, autoMatchThreshold } from '../../lib/entity-match'

const SOURCE = 'state_procurement'

interface AwardRow {
  solicitation_id: string
  vendor_name: string
  awarding_agency: string
  contract_amount?: number
  description?: string
  award_date?: string
}

interface Args { dry: boolean; file?: string; limit: number }
function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let dry = false, file: string | undefined, limit = 1000
  for (const a of argv) {
    if (a === '--dry') dry = true
    else if (a.startsWith('--file=')) file = a.split('=')[1]
    else if (a.startsWith('--limit=')) limit = parseInt(a.split('=')[1], 10)
  }
  return { dry, file, limit }
}

async function run() {
  const { dry, file, limit } = parseArgs()
  if (!file) {
    console.error('--file=<path> required')
    process.exit(1)
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  console.log(`[${SOURCE}] starting (dry=${dry}, file=${file})`)

  const fs = await import('fs/promises')
  const rows = JSON.parse(await fs.readFile(file, 'utf-8')) as AwardRow[]
  const { data: orgs } = await supabase.from('organization').select('id, name, aliases').limit(10000)
  const orgIndex = orgs ?? []

  let inserted = 0, skipped = 0, errors = 0
  for (const row of rows.slice(0, limit)) {
    if (!dry) {
      const { inserted: isNew } = await insertSourceRecord(supabase, {
        source_id: row.solicitation_id, source_name: SOURCE, raw_data: row,
      })
      if (!isNew) { skipped++; continue }
    }

    const match = matchEntity(row.vendor_name, orgIndex)[0]
    const record = {
      vendor_org_id: match?.id ?? null,
      vendor_name_raw: row.vendor_name,
      match_confidence: match?.confidence ?? null,
      match_status: match ? autoMatchThreshold(match.confidence) : 'unmatched',
      awarding_agency: row.awarding_agency,
      contract_amount: row.contract_amount ?? null,
      description: row.description ?? null,
      award_date: row.award_date ?? null,
      source: SOURCE,
      source_record_id: row.solicitation_id,
      raw_record: row,
    }

    if (dry) { inserted++; continue }
    const { error } = await supabase.from('government_contract').insert(record)
    if (error) { errors++; console.error(`[${SOURCE}] ${error.message}`) }
    else inserted++
  }

  if (!dry) await updateCursor(supabase, SOURCE, inserted + skipped, 'complete', { inserted, skipped, errors })
  console.log(`[${SOURCE}] done: inserted=${inserted} skipped=${skipped} errors=${errors}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
