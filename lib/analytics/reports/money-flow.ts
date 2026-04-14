import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Bill landscape: for a given bill, show the testimony → lobbying → money chain.
 * Returns testifiers grouped by position, the orgs behind them, and any
 * contributions from those orgs' officers to legislators on record for the bill.
 */
export async function getBillLandscape(
  supabase: SupabaseClient,
  billNumber: string,
  session: string
) {
  const { data: testimony } = await supabase
    .from('legislative_testimony')
    .select('*, person:person_id(full_name), organization:organization_id(name)')
    .eq('bill_number', billNumber)
    .eq('session', session)

  const orgIds = [
    ...new Set(
      ((testimony ?? []) as Array<{ organization_id?: string | null }>)
        .map(t => t.organization_id)
        .filter((x): x is string => !!x)
    ),
  ]

  let lobbying: Array<Record<string, unknown>> = []
  let officers: Array<Record<string, unknown>> = []
  let contributions: Array<Record<string, unknown>> = []

  if (orgIds.length > 0) {
    const [lob, off] = await Promise.all([
      supabase.from('lobbyist_registration').select('*').in('client_org_id', orgIds),
      supabase
        .from('relationship')
        .select('source_person_id, target_org_id, title')
        .in('target_org_id', orgIds)
        .in('relationship_type', ['officer', 'director', 'board_member']),
    ])
    lobbying = lob.data ?? []
    officers = off.data ?? []

    const officerIds = [...new Set((officers as Array<{ source_person_id: string }>).map(o => o.source_person_id))]
    if (officerIds.length > 0) {
      const { data: contribs } = await supabase
        .from('contribution')
        .select('*')
        .in('donor_person_id', officerIds)
        .neq('match_status', 'unmatched')
      contributions = contribs ?? []
    }
  }

  const byPosition = {
    support: (testimony ?? []).filter(t => t.position === 'support'),
    oppose: (testimony ?? []).filter(t => t.position === 'oppose'),
    comment: (testimony ?? []).filter(t => t.position === 'comment'),
  }

  return { bill: billNumber, session, byPosition, lobbying, officers, contributions }
}
