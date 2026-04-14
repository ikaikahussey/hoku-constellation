import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrgProfile } from '../types'

export async function getOrgProfile(
  supabase: SupabaseClient,
  orgId: string
): Promise<OrgProfile> {
  const [organization, contributions, lobbying, officers, contracts, properties, mentions] =
    await Promise.all([
      supabase.from('organization').select('*').eq('id', orgId).maybeSingle(),
      supabase
        .from('contribution')
        .select('*')
        .or(`donor_org_id.eq.${orgId},recipient_org_id.eq.${orgId}`)
        .order('contribution_date', { ascending: false })
        .limit(500),
      supabase
        .from('lobbyist_registration')
        .select('*')
        .eq('client_org_id', orgId),
      supabase
        .from('relationship')
        .select('*, person:source_person_id(id, full_name)')
        .eq('target_org_id', orgId),
      supabase.from('government_contract').select('*').eq('vendor_org_id', orgId),
      supabase.from('property_ownership').select('*').eq('owner_org_id', orgId),
      supabase.from('article_entity_mention').select('*').eq('organization_id', orgId).limit(100),
    ])
  return {
    organization: organization.data ?? {},
    contributions: contributions.data ?? [],
    lobbying: lobbying.data ?? [],
    officers: officers.data ?? [],
    contracts: contracts.data ?? [],
    properties: properties.data ?? [],
    mentions: mentions.data ?? [],
  }
}
