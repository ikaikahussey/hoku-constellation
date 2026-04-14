/**
 * ProPublica Nonprofit Explorer — IRS Form 990 data.
 * Enriches `organization` with EIN; creates `relationship` rows for officers/directors/board.
 *
 * Usage: npx tsx scripts/import/propublica-990.ts [--dry] [--state=HI] [--limit=200]
 */
import { createClient } from '@supabase/supabase-js'
import { insertSourceRecord, updateCursor } from './utils/dedup'
import { matchOrganizationByExternalId, matchEntity } from '../../lib/entity-match'

const SOURCE = 'propublica_990'
const API_SEARCH = 'https://projects.propublica.org/nonprofits/api/v2/search.json'
const API_ORG = (ein: string) => `https://projects.propublica.org/nonprofits/api/v2/organizations/${ein}.json`

interface Args { dry: boolean; state: string; limit: number }
function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let dry = false, state = 'HI', limit = 200
  for (const a of argv) {
    if (a === '--dry') dry = true
    else if (a.startsWith('--state=')) state = a.split('=')[1]
    else if (a.startsWith('--limit=')) limit = parseInt(a.split('=')[1], 10)
  }
  return { dry, state, limit }
}

async function run() {
  const { dry, state, limit } = parseArgs()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  console.log(`[${SOURCE}] starting (dry=${dry}, state=${state}, limit=${limit})`)

  const { data: people } = await supabase.from('person').select('id, full_name, aliases').limit(20000)
  const personIndex = people ?? []

  let page = 0
  let enriched = 0
  let officers = 0
  let skipped = 0

  while (enriched < limit) {
    const res = await fetch(`${API_SEARCH}?state%5Bid%5D=${state}&page=${page}`)
    if (!res.ok) { console.error(`[${SOURCE}] search ${res.status}`); break }
    const json = (await res.json()) as { organizations: Array<{ ein: number; name: string; city: string }> }
    const orgs = json.organizations ?? []
    if (orgs.length === 0) break

    for (const orgHit of orgs) {
      if (enriched >= limit) break
      const einStr = String(orgHit.ein).padStart(9, '0')

      // Fetch the org detail
      const detailRes = await fetch(API_ORG(einStr))
      if (!detailRes.ok) { skipped++; continue }
      const detail = (await detailRes.json()) as {
        organization: { ein: number; name: string }
        filings_with_data?: Array<Record<string, unknown>>
      }

      if (!dry) {
        const { inserted } = await insertSourceRecord(supabase, {
          source_id: einStr, source_name: SOURCE, raw_data: detail,
        })
        if (!inserted) { skipped++; continue }
      }

      // Upsert org by EIN
      let orgId: string | null = null
      const existing = await matchOrganizationByExternalId(supabase, { ein: einStr })
      if (existing) {
        orgId = existing.orgId
      } else if (!dry) {
        const { data: inserted, error } = await supabase
          .from('organization')
          .insert({
            name: detail.organization.name,
            ein: einStr,
            org_type: 'nonprofit',
            slug: detail.organization.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) + '-' + einStr.slice(-4),
          })
          .select('id')
          .single()
        if (error) { console.error(`[${SOURCE}] org insert: ${error.message}`); continue }
        orgId = inserted.id
      }
      enriched++

      // Parse officers from latest filing
      const latest = detail.filings_with_data?.[0]
      if (!latest || !orgId) continue
      // ProPublica returns officer fields like officer_cmpnsatn_1, officer_nm_1, officer_ttl_1 etc.
      for (let i = 1; i <= 10; i++) {
        const name = latest[`officer_nm_${i}` as string] as string | undefined
        const title = latest[`officer_ttl_${i}` as string] as string | undefined
        if (!name) continue
        const match = matchEntity(name, personIndex)[0]
        if (dry) { officers++; continue }
        const rel = {
          source_person_id: match?.id ?? null,
          target_org_id: orgId,
          relationship_type: /director|board|trustee/i.test(title ?? '') ? 'board_member' : 'officer',
          title: title ?? null,
          is_current: true,
          source_description: 'ProPublica 990 filing',
        }
        if (!rel.source_person_id) continue // skip unresolved for now
        await supabase.from('relationship').insert(rel)
        officers++
      }
    }
    page++
    if (orgs.length < 100) break
  }

  if (!dry) await updateCursor(supabase, SOURCE, enriched, 'complete', { enriched, officers, skipped })
  console.log(`[${SOURCE}] done: enriched=${enriched} officers=${officers} skipped=${skipped}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
