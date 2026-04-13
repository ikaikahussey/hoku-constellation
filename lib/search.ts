import { SupabaseClient } from '@supabase/supabase-js'

export interface SearchFilters {
  type?: 'person' | 'organization'
  entityTypes?: string[]
  orgTypes?: string[]
  island?: string
  sector?: string
  status?: string
}

export interface SearchResult {
  id: string
  type: 'person' | 'organization'
  name: string
  slug: string | null
  subtitle: string | null
  badges: string[]
  island: string | null
  status: string
  connectionCount?: number
}

export async function searchEntities(
  supabase: SupabaseClient,
  query: string,
  filters: SearchFilters = {},
  limit = 20,
  offset = 0
): Promise<{ results: SearchResult[]; total: number }> {
  const results: SearchResult[] = []
  const tsQuery = query.split(/\s+/).filter(Boolean).join(' & ')

  if (!filters.type || filters.type === 'person') {
    let personQuery = supabase
      .from('person')
      .select('id, full_name, slug, office_held, entity_types, island, status, party, district', { count: 'exact' })

    if (tsQuery) {
      personQuery = personQuery.textSearch('full_name', query, { type: 'websearch' })
    }
    if (filters.entityTypes?.length) {
      personQuery = personQuery.overlaps('entity_types', filters.entityTypes)
    }
    if (filters.island) {
      personQuery = personQuery.eq('island', filters.island)
    }
    if (filters.status) {
      personQuery = personQuery.eq('status', filters.status)
    }

    const { data: people, count } = await personQuery
      .range(offset, offset + limit - 1)
      .order('is_featured', { ascending: false })
      .order('full_name')

    if (people) {
      for (const p of people) {
        results.push({
          id: p.id,
          type: 'person',
          name: p.full_name,
          slug: p.slug,
          subtitle: [p.office_held, p.party, p.district].filter(Boolean).join(' · '),
          badges: p.entity_types || [],
          island: p.island,
          status: p.status,
        })
      }
    }
  }

  if (!filters.type || filters.type === 'organization') {
    let orgQuery = supabase
      .from('organization')
      .select('id, name, slug, org_type, description, island, sector, status', { count: 'exact' })

    if (tsQuery) {
      orgQuery = orgQuery.textSearch('name', query, { type: 'websearch' })
    }
    if (filters.orgTypes?.length) {
      orgQuery = orgQuery.in('org_type', filters.orgTypes)
    }
    if (filters.island) {
      orgQuery = orgQuery.eq('island', filters.island)
    }
    if (filters.sector) {
      orgQuery = orgQuery.eq('sector', filters.sector)
    }
    if (filters.status) {
      orgQuery = orgQuery.eq('status', filters.status)
    }

    const { data: orgs } = await orgQuery
      .range(offset, offset + limit - 1)
      .order('is_featured', { ascending: false })
      .order('name')

    if (orgs) {
      for (const o of orgs) {
        results.push({
          id: o.id,
          type: 'organization',
          name: o.name,
          slug: o.slug,
          subtitle: [o.org_type?.replace(/_/g, ' '), o.sector?.replace(/_/g, ' ')].filter(Boolean).join(' · '),
          badges: [o.org_type].filter(Boolean),
          island: o.island,
          status: o.status,
        })
      }
    }
  }

  return { results, total: results.length }
}
