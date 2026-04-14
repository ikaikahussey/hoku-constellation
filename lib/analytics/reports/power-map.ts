import type { SupabaseClient } from '@supabase/supabase-js'

type Dimension =
  | 'composite'
  | 'political_money'
  | 'institutional_position'
  | 'lobbying'
  | 'economic_footprint'
  | 'network_centrality'
  | 'public_visibility'

const COLUMN: Record<Dimension, string> = {
  composite: 'composite_score',
  political_money: 'political_money_score',
  institutional_position: 'institutional_position_score',
  lobbying: 'lobbying_score',
  economic_footprint: 'economic_footprint_score',
  network_centrality: 'network_centrality_score',
  public_visibility: 'public_visibility_score',
}

export async function getPowerMap(
  supabase: SupabaseClient,
  opts: {
    dimension?: Dimension
    limit?: number
    island?: string
    entity_type?: string
  } = {}
) {
  const dim = opts.dimension ?? 'composite'
  const { data: scores, error } = await supabase
    .from('ax_influence_score')
    .select('*, person:person_id(id, full_name, office_held, island, entity_types, photo_url)')
    .order(COLUMN[dim], { ascending: false })
    .limit(opts.limit ?? 50)
  if (error) throw new Error(`getPowerMap: ${error.message}`)

  return (scores ?? []).filter(row => {
    const person = (row as { person?: { island?: string; entity_types?: string[] } }).person
    if (opts.island && person?.island !== opts.island) return false
    if (opts.entity_type && !person?.entity_types?.includes(opts.entity_type)) return false
    return true
  })
}
