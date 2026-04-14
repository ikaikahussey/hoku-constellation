import { createAdminClient } from '@/lib/supabase/admin'
import { slugify } from '@/lib/slugify'
import { ensurePersons, parseName } from '@/lib/import/auto-create'

const CKAN_BASE = 'https://opendata.hawaii.gov/api/3/action'

async function findCSCResourceId(): Promise<string> {
  const searchRes = await fetch(`${CKAN_BASE}/package_search?q=campaign+contributions+received`)
  const searchData = await searchRes.json()
  for (const ds of searchData?.result?.results || []) {
    for (const r of ds.resources || []) {
      if (r.format === 'CSV' && (r.name || '').toLowerCase().includes('contribution')) {
        return r.id
      }
    }
  }
  // Fallback search
  const altSearch = await fetch(`${CKAN_BASE}/package_search?q=campaign+spending+commission`)
  const altData = await altSearch.json()
  for (const ds of altData?.result?.results || []) {
    for (const r of ds.resources || []) {
      if (r.datastore_active) return r.id
    }
  }
  throw new Error('Could not find CSC contributions resource on opendata.hawaii.gov')
}

/**
 * Import a single batch of CSC contribution records.
 * Auto-creates person records for candidates and donors.
 */
export async function importCSCBatch(
  offset: number,
  limit: number
): Promise<{ inserted: number; nextOffset: number; done: boolean; personsCreated: number }> {
  const supabase = createAdminClient()
  const resourceId = await findCSCResourceId()

  const url = `${CKAN_BASE}/datastore_search?resource_id=${resourceId}&limit=${limit}&offset=${offset}`
  const res = await fetch(url)
  const data = await res.json()
  const records: Record<string, string>[] = data?.result?.records || []

  if (records.length === 0) {
    return { inserted: 0, nextOffset: offset, done: true, personsCreated: 0 }
  }

  // Collect unique names for person creation
  const personEntries: { rawName: string; tag: string }[] = []

  for (const row of records) {
    const candidateName = row['Candidate Name'] || row['candidate_name'] || ''
    const donorName = row['Contributor Name'] || row['contributor_name'] || ''

    if (candidateName.trim()) {
      personEntries.push({ rawName: candidateName, tag: 'elected_official' })
    }
    if (donorName.trim()) {
      personEntries.push({ rawName: donorName, tag: 'donor' })
    }
  }

  // Auto-create persons (deduplicates internally)
  const personMap = await ensurePersons(supabase, personEntries)
  const personsCreated = personMap.size

  // Build contribution records with linked person IDs
  const contributions = records.map((row) => {
    const candidateName = row['Candidate Name'] || row['candidate_name'] || ''
    const donorName = row['Contributor Name'] || row['contributor_name'] || ''

    const candidateSlug = candidateName.trim() ? slugify(parseName(candidateName).full_name) : ''
    const donorSlug = donorName.trim() ? slugify(parseName(donorName).full_name) : ''

    const recipientPersonId = candidateSlug ? personMap.get(candidateSlug) || null : null
    const donorPersonId = donorSlug ? personMap.get(donorSlug) || null : null

    return {
      donor_name_raw: donorName || null,
      recipient_name_raw: candidateName || null,
      recipient_person_id: recipientPersonId,
      donor_person_id: donorPersonId,
      amount: parseFloat(row['Amount'] || row['amount'] || '0') || null,
      contribution_date: row['Date'] || row['date'] || row['Receipt Date'] || null,
      contribution_type: row['Contributor Type'] || row['contributor_type'] || 'other',
      election_period: row['Election Period'] || row['election_period'] || null,
      source: 'hawaii_csc',
      match_status: recipientPersonId ? 'recipient_matched' : 'unmatched',
      raw_record: row,
      source_file: `ckan:${resourceId}`,
    }
  })

  // Insert contributions in sub-batches of 200
  let totalInserted = 0
  for (let i = 0; i < contributions.length; i += 200) {
    const batch = contributions.slice(i, i + 200)
    try {
      const { data: result, error } = await supabase
        .from('contribution')
        .insert(batch)
        .select('id')

      if (error) throw error
      totalInserted += (result || []).length
    } catch {
      // Try individual inserts on batch failure
      for (const row of batch) {
        try {
          const { error } = await supabase.from('contribution').insert(row)
          if (!error) totalInserted++
        } catch {
          // skip
        }
      }
    }
  }

  return {
    inserted: totalInserted,
    nextOffset: offset + records.length,
    done: records.length < limit,
    personsCreated,
  }
}

/**
 * Full CSC import — loops through all records.
 * Used by admin manual trigger.
 */
export async function importCSCFull(): Promise<{
  inserted: number
  total: number
  personsCreated: number
}> {
  let offset = 0
  const LIMIT = 1000
  let totalInserted = 0
  let totalFetched = 0
  let totalPersonsCreated = 0

  while (true) {
    const result = await importCSCBatch(offset, LIMIT)
    totalInserted += result.inserted
    totalPersonsCreated = result.personsCreated // cumulative from ensurePersons
    totalFetched += result.inserted

    if (result.done) break
    offset = result.nextOffset
  }

  return { inserted: totalInserted, total: totalFetched, personsCreated: totalPersonsCreated }
}
