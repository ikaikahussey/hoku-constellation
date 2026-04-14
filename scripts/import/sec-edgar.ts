/**
 * SEC EDGAR — enriches organization with sec_cik; creates relationship rows
 * from DEF 14A proxy statement officer/director tables.
 *
 * Usage: npx tsx scripts/import/sec-edgar.ts [--dry] [--ciks=0000046619,0000003906]
 *
 * SEC requires a descriptive User-Agent and ≤10 req/sec.
 */
import { createClient } from '@supabase/supabase-js'
import { insertSourceRecord, updateCursor } from './utils/dedup'
import { matchOrganizationByExternalId } from '../../lib/entity-match'

const SOURCE = 'sec_edgar'
const UA = 'Hoku Constellation research@hoku.fm'
const SUBMISSIONS = (cik: string) => `https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`

// Default target CIKs per DATA_STRATEGY: HEI, A&B, Matson, BOH, FHB.
const DEFAULT_CIKS = ['0000046619', '0000003906', '0001616862', '0000046195', '0000036377']

interface Args { dry: boolean; ciks: string[] }
function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let dry = false
  let ciks = DEFAULT_CIKS
  for (const a of argv) {
    if (a === '--dry') dry = true
    else if (a.startsWith('--ciks=')) ciks = a.split('=')[1].split(',')
  }
  return { dry, ciks }
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function run() {
  const { dry, ciks } = parseArgs()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  console.log(`[${SOURCE}] starting (dry=${dry}, ciks=${ciks.length})`)

  let enriched = 0
  let skipped = 0

  for (const cik of ciks) {
    await sleep(150) // rate limit ~7 req/s
    const res = await fetch(SUBMISSIONS(cik), { headers: { 'user-agent': UA, accept: 'application/json' } })
    if (!res.ok) { console.error(`[${SOURCE}] ${cik}: ${res.status}`); skipped++; continue }
    const detail = (await res.json()) as { name: string; cik: string; tickers?: string[]; sicDescription?: string }

    if (!dry) {
      const { inserted } = await insertSourceRecord(supabase, {
        source_id: cik, source_name: SOURCE, raw_data: detail as unknown,
      })
      if (!inserted) { skipped++; continue }
    }

    // Upsert organization by sec_cik
    const existing = await matchOrganizationByExternalId(supabase, { sec_cik: cik })
    if (existing) {
      if (!dry) {
        await supabase
          .from('organization')
          .update({ sec_cik: cik, sector: detail.sicDescription ?? null })
          .eq('id', existing.orgId)
      }
      enriched++
    } else {
      if (dry) {
        console.log('[dry]', 'would insert org', detail.name, cik)
      } else {
        const { error } = await supabase.from('organization').insert({
          name: detail.name,
          sec_cik: cik,
          org_type: 'corporation',
          sector: detail.sicDescription ?? null,
          slug: detail.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) + '-' + cik.slice(-4),
        })
        if (error) { console.error(`[${SOURCE}] insert: ${error.message}`); skipped++; continue }
      }
      enriched++
    }

    // NOTE: DEF 14A parsing requires HTML scraping of proxy statements; stubbed.
    // A future pass would pull recent 14A accession + parse director/officer tables.
  }

  if (!dry) await updateCursor(supabase, SOURCE, enriched, 'complete', { enriched, skipped })
  console.log(`[${SOURCE}] done: enriched=${enriched} skipped=${skipped}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
