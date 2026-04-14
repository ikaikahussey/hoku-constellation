/**
 * Property ownership ingestion — county real property assessment records.
 * Target: property_ownership (TMK = canonical HI property identifier).
 *
 * Each county publishes its own parcel data. This scaffold accepts a JSON file
 * of normalized records and handles the entity resolution + canonical insert.
 *
 * Usage: npx tsx scripts/import/property.ts --file=path/to/parcels.json [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { insertSourceRecord, updateCursor } from './utils/dedup'
import { matchEntity, autoMatchThreshold } from '../../lib/entity-match'

const SOURCE = 'property'

interface ParcelRow {
  tmk: string
  owner_name: string
  address?: string
  county?: string
  assessed_value?: number
  tax_class?: string
  assessment_year?: number
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
    console.error('--file=<path> is required until county API scrapers are wired up')
    process.exit(1)
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  console.log(`[${SOURCE}] starting (dry=${dry}, file=${file})`)

  const fs = await import('fs/promises')
  const rows = JSON.parse(await fs.readFile(file, 'utf-8')) as ParcelRow[]

  const [{ data: people }, { data: orgs }] = await Promise.all([
    supabase.from('person').select('id, full_name, aliases').limit(20000),
    supabase.from('organization').select('id, name, aliases').limit(10000),
  ])
  const personIndex = people ?? []
  const orgIndex = orgs ?? []

  let inserted = 0, skipped = 0, errors = 0
  for (const row of rows.slice(0, limit)) {
    if (!dry) {
      const { inserted: isNew } = await insertSourceRecord(supabase, {
        source_id: row.tmk, source_name: SOURCE, raw_data: row,
      })
      if (!isNew) { skipped++; continue }
    }

    // Try person first, then org. Whichever has higher confidence wins.
    const personMatch = matchEntity(row.owner_name, personIndex)[0]
    const orgMatch = matchEntity(row.owner_name, orgIndex)[0]
    const pc = personMatch?.confidence ?? 0
    const oc = orgMatch?.confidence ?? 0
    const asOrg = oc > pc

    const record = {
      owner_person_id: !asOrg && personMatch ? personMatch.id : null,
      owner_org_id: asOrg && orgMatch ? orgMatch.id : null,
      owner_name_raw: row.owner_name,
      match_confidence: Math.max(pc, oc) || null,
      match_status: autoMatchThreshold(Math.max(pc, oc)),
      tmk: row.tmk,
      address: row.address ?? null,
      county: row.county ?? null,
      assessed_value: row.assessed_value ?? null,
      tax_class: row.tax_class ?? null,
      assessment_year: row.assessment_year ?? null,
      raw_record: row,
    }

    if (dry) { inserted++; continue }
    const { error } = await supabase.from('property_ownership').insert(record)
    if (error) { errors++; console.error(`[${SOURCE}] ${error.message}`) }
    else inserted++
  }

  if (!dry) await updateCursor(supabase, SOURCE, inserted + skipped, 'complete', { inserted, skipped, errors })
  console.log(`[${SOURCE}] done: inserted=${inserted} skipped=${skipped} errors=${errors}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
