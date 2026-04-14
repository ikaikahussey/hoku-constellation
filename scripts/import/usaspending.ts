/**
 * USAspending.gov — federal contract awards (place of performance = Hawaii).
 * Target table: government_contract (source='usaspending').
 *
 * Usage:
 *   npx tsx scripts/import/usaspending.ts [--dry] [--limit=100]
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js'
import { sha256, insertSourceRecord, updateCursor } from './utils/dedup'
import { matchOrganizationByExternalId, matchEntity, autoMatchThreshold } from '../../lib/entity-match'

const SOURCE = 'usaspending'
const API = 'https://api.usaspending.gov/api/v2/search/spending_by_award/'

interface Args {
  dry: boolean
  limit: number
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let dry = false
  let limit = 500
  for (const a of argv) {
    if (a === '--dry') dry = true
    else if (a.startsWith('--limit=')) limit = parseInt(a.split('=')[1], 10)
  }
  return { dry, limit }
}

async function run() {
  const { dry, limit } = parseArgs()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  console.log(`[${SOURCE}] starting (dry=${dry}, limit=${limit})`)

  // Fetch org index once for fuzzy fallback (small-ish cohort)
  const { data: orgs } = await supabase.from('organization').select('id, name, aliases').limit(10000)
  const orgIndex = orgs ?? []

  // Query USAspending search API: contracts to HI recipients, paginated.
  let page = 1
  let inserted = 0
  let skipped = 0
  let errors = 0

  while (inserted + skipped < limit) {
    const body = {
      filters: {
        award_type_codes: ['A', 'B', 'C', 'D'],
        place_of_performance_locations: [{ country: 'USA', state: 'HI' }],
        time_period: [{ start_date: '2020-01-01', end_date: new Date().toISOString().slice(0, 10) }],
      },
      fields: [
        'Award ID',
        'Recipient Name',
        'Award Amount',
        'Awarding Agency',
        'Description',
        'Start Date',
        'recipient_id',
      ],
      page,
      limit: 100,
      sort: 'Award Amount',
      order: 'desc',
    }

    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.error(`[${SOURCE}] fetch ${res.status}: ${await res.text()}`)
      errors++
      break
    }
    const json = (await res.json()) as { results: Record<string, unknown>[] }
    const rows = json.results ?? []
    if (rows.length === 0) break

    for (const row of rows) {
      const checksum = sha256(row)
      if (!dry) {
        const { inserted: newRec } = await insertSourceRecord(supabase, {
          source_id: String(row['Award ID'] ?? checksum),
          source_name: SOURCE,
          raw_data: row,
        })
        if (!newRec) {
          skipped++
          continue
        }
      }

      const vendorNameRaw = String(row['Recipient Name'] ?? '')
      const idMatch = await matchOrganizationByExternalId(supabase, {})
      const fuzzy = idMatch ? null : matchEntity(vendorNameRaw, orgIndex)[0]
      const vendorOrgId = idMatch?.orgId ?? fuzzy?.id ?? null
      const confidence = idMatch?.confidence ?? fuzzy?.confidence ?? null
      const status = confidence ? autoMatchThreshold(confidence) : 'unmatched'

      const record = {
        vendor_org_id: vendorOrgId,
        vendor_name_raw: vendorNameRaw,
        match_confidence: confidence,
        match_status: status,
        awarding_agency: String(row['Awarding Agency'] ?? 'unknown'),
        contract_amount: Number(row['Award Amount'] ?? 0) || null,
        description: row['Description'] ? String(row['Description']) : null,
        award_date: row['Start Date'] ? String(row['Start Date']) : null,
        source: SOURCE,
        source_record_id: String(row['Award ID'] ?? ''),
        raw_record: row,
      }

      if (dry) {
        console.log('[dry]', record.vendor_name_raw, record.contract_amount)
        inserted++
        continue
      }

      const { error } = await supabase.from('government_contract').insert(record)
      if (error) {
        console.error(`[${SOURCE}] insert: ${error.message}`)
        errors++
      } else {
        inserted++
      }
    }

    page++
    if (rows.length < 100) break
  }

  if (!dry) {
    await updateCursor(supabase, SOURCE, inserted + skipped, 'complete', { inserted, skipped, errors })
  }
  console.log(`[${SOURCE}] done: inserted=${inserted} skipped=${skipped} errors=${errors}`)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
