import { createAdminClient } from '@/lib/supabase/admin'

const CKAN_BASE = 'https://opendata.hawaii.gov/api/3/action'
const RESOURCE_ID = 'aed69d13-fe07-4e91-8abf-a51c8a408e1f'

export async function importLobbyistFull(): Promise<{ inserted: number }> {
  const supabase = createAdminClient()

  // Get org lookups for matching
  const { data: orgs } = await supabase.from('organization').select('id, name')
  const orgMap = new Map<string, string>()
  for (const o of orgs || []) {
    orgMap.set(o.name.toLowerCase(), o.id)
  }

  let offset = 0
  const LIMIT = 1000
  let totalInserted = 0

  while (true) {
    const url = `${CKAN_BASE}/datastore_search?resource_id=${RESOURCE_ID}&limit=${LIMIT}&offset=${offset}`
    const res = await fetch(url)
    const data = await res.json()
    const records: Record<string, string>[] = data?.result?.records || []

    if (records.length === 0) break

    const registrations = records.map((row) => {
      const clientName = row['Client'] || row['client_name'] || ''
      const orgId = orgMap.get(clientName.toLowerCase()) || null

      return {
        lobbyist_name_raw: row['Lobbyist'] || row['lobbyist_name'] || null,
        client_name_raw: clientName,
        client_org_id: orgId,
        registration_period: row['Period'] || row['Registration Period'] || null,
        filing_year: parseInt(row['Year'] || '0') || null,
        issues: row['Issues'] ? row['Issues'].split(';').map((s: string) => s.trim()).filter(Boolean) : [],
        source: 'hawaii_ethics',
        raw_record: row,
      }
    })

    for (let i = 0; i < registrations.length; i += 200) {
      const batch = registrations.slice(i, i + 200)
      const { data: result, error } = await supabase
        .from('lobbyist_registration')
        .insert(batch)
        .select('id')

      if (!error) totalInserted += (result || []).length
    }

    offset += LIMIT
    if (records.length < LIMIT) break
  }

  return { inserted: totalInserted }
}
