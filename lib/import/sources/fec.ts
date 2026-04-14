import { createAdminClient } from '@/lib/supabase/admin'

const FEC_BASE = 'https://api.open.fec.gov/v1'
const FEC_API_KEY = process.env.FEC_API_KEY || 'DEMO_KEY'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

const CANDIDATES = [
  { name: 'Brian Schatz', slug: 'brian-schatz', searchName: 'schatz', office: 'S' as const },
  { name: 'Mazie Hirono', slug: 'mazie-hirono', searchName: 'hirono', office: 'S' as const },
  { name: 'Ed Case', slug: 'ed-case', searchName: 'case', office: 'H' as const },
]

export async function importFECFull(): Promise<{ inserted: number; candidates: string[] }> {
  const supabase = createAdminClient()

  // Get person IDs from Supabase
  const { data: persons } = await supabase.from('person').select('id, slug')
  const personMap = new Map<string, string>()
  for (const p of persons || []) {
    if (p.slug) personMap.set(p.slug, p.id)
  }

  let totalInserted = 0

  for (const c of CANDIDATES) {
    try {
      // Find candidate ID
      const searchRes = await fetch(
        `${FEC_BASE}/candidates/search/?name=${c.searchName}&state=HI&office=${c.office}&api_key=${FEC_API_KEY}`
      )
      const searchData = await searchRes.json()
      const match = (searchData.results || []).find((r: { name: string }) =>
        r.name.toLowerCase().includes(c.searchName.toLowerCase())
      ) || searchData.results?.[0]

      if (!match) continue
      await delay(1000)

      // Find committee
      const commRes = await fetch(
        `${FEC_BASE}/candidate/${match.candidate_id}/committees/?api_key=${FEC_API_KEY}`
      )
      const commData = await commRes.json()
      const principal = (commData.results || []).find(
        (cm: { designation: string }) => cm.designation === 'P'
      ) || commData.results?.[0]

      if (!principal) continue
      await delay(1000)

      // Fetch contributions (paginated)
      let lastIndex: string | null = null
      let lastDate: string | null = null

      for (let page = 0; page < 10; page++) {
        let contribUrl = `${FEC_BASE}/schedules/schedule_a/?committee_id=${principal.committee_id}&sort=-contribution_receipt_date&per_page=100&min_date=2022-01-01&api_key=${FEC_API_KEY}`
        if (lastIndex && lastDate) {
          contribUrl += `&last_index=${lastIndex}&last_contribution_receipt_date=${lastDate}`
        }

        const contribRes = await fetch(contribUrl)
        const contribData = await contribRes.json()
        const contributions = contribData.results || []

        if (contributions.length === 0) break

        const personId = personMap.get(c.slug) || null
        const records = contributions.map((contrib: Record<string, unknown>) => ({
          donor_name_raw: contrib.contributor_name || null,
          recipient_name_raw: c.name,
          recipient_person_id: personId,
          amount: contrib.contribution_receipt_amount || null,
          contribution_date: contrib.contribution_receipt_date || null,
          contribution_type: (contrib.receipt_type_full as string) || (contrib.receipt_type as string) || 'individual',
          election_period: contrib.two_year_transaction_period || null,
          source: 'fec',
          match_status: personId ? 'recipient_matched' : 'unmatched',
          raw_record: contrib,
          source_file: null,
        }))

        const { data: result, error } = await supabase
          .from('contribution')
          .insert(records)
          .select('id')

        if (!error) totalInserted += (result || []).length

        const pagination = contribData.pagination || {}
        lastIndex = pagination.last_indexes?.last_index || null
        lastDate = pagination.last_indexes?.last_contribution_receipt_date || null
        if (!lastIndex || contributions.length < 100) break

        await delay(1000)
      }
    } catch (e) {
      console.error(`FEC error for ${c.name}:`, e)
    }
  }

  return { inserted: totalInserted, candidates: CANDIDATES.map(c => c.name) }
}
