import type { SupabaseClient } from '@supabase/supabase-js'
import type { PersonProfile, ScoreBreakdown } from '../types'

/**
 * Core product output: a complete dossier for one person, assembled in parallel.
 * All queries go through the provided supabase client — caller controls auth/RLS.
 */
export async function getPersonProfile(
  supabase: SupabaseClient,
  personId: string
): Promise<PersonProfile> {
  const [
    person,
    roles,
    donationsGiven,
    donationsReceived,
    lobbying,
    testimony,
    boards,
    property,
    disclosure,
    scoreRow,
    connections,
    alerts,
  ] = await Promise.all([
    supabase.from('person').select('*').eq('id', personId).maybeSingle(),
    supabase
      .from('relationship')
      .select('*, organization:target_org_id(id, name, org_type)')
      .eq('source_person_id', personId)
      .order('start_date', { ascending: false }),
    supabase
      .from('contribution')
      .select('*')
      .eq('donor_person_id', personId)
      .neq('match_status', 'unmatched')
      .order('contribution_date', { ascending: false })
      .limit(500),
    supabase
      .from('contribution')
      .select('*')
      .eq('recipient_person_id', personId)
      .neq('match_status', 'unmatched')
      .order('contribution_date', { ascending: false })
      .limit(500),
    supabase
      .from('lobbyist_registration')
      .select('*, organization:client_org_id(name)')
      .eq('lobbyist_person_id', personId),
    supabase
      .from('legislative_testimony')
      .select('*')
      .eq('person_id', personId)
      .order('hearing_date', { ascending: false })
      .limit(200),
    supabase
      .from('relationship')
      .select('*')
      .eq('source_person_id', personId)
      .eq('relationship_type', 'appointed_to'),
    supabase.from('property_ownership').select('*').eq('owner_person_id', personId),
    supabase
      .from('financial_disclosure')
      .select('*')
      .eq('person_id', personId)
      .order('filing_year', { ascending: false })
      .limit(1),
    supabase.from('ax_influence_score').select('*').eq('person_id', personId).maybeSingle(),
    supabase
      .from('ax_relationship_edge')
      .select('*')
      .or(`source_person_id.eq.${personId},target_person_id.eq.${personId}`)
      .order('weight', { ascending: false })
      .limit(10),
    supabase
      .from('ax_alert')
      .select('*')
      .eq('person_id', personId)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  // Contracts via orgs where this person has an officer/board role
  const orgIds = ((roles.data ?? []) as Array<{ target_org_id?: string | null }>)
    .map(r => r.target_org_id)
    .filter((x): x is string => !!x)
  let contracts: Array<Record<string, unknown>> = []
  if (orgIds.length) {
    const { data } = await supabase
      .from('government_contract')
      .select('*')
      .in('vendor_org_id', orgIds)
    contracts = data ?? []
  }

  const score: ScoreBreakdown | null = scoreRow.data
    ? {
        composite: Number(scoreRow.data.composite_score),
        political_money: Number(scoreRow.data.political_money_score),
        institutional_position: Number(scoreRow.data.institutional_position_score),
        lobbying: Number(scoreRow.data.lobbying_score),
        economic_footprint: Number(scoreRow.data.economic_footprint_score),
        network_centrality: Number(scoreRow.data.network_centrality_score),
        public_visibility: Number(scoreRow.data.public_visibility_score),
      }
    : null

  return {
    person: person.data ?? {},
    roles: roles.data ?? [],
    donationsGiven: donationsGiven.data ?? [],
    donationsReceived: donationsReceived.data ?? [],
    lobbying: lobbying.data ?? [],
    testimony: testimony.data ?? [],
    boards: boards.data ?? [],
    property: property.data ?? [],
    disclosure: disclosure.data ?? [],
    contracts,
    score,
    connections: connections.data ?? [],
    alerts: alerts.data ?? [],
  }
}
