import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { SearchBar } from '@/components/search/SearchBar'
import { SearchFilters } from '@/components/search/SearchFilters'
import { SearchResults } from '@/components/search/SearchResults'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search Hoku Constellation for people and organizations in Hawaiʻi public life.',
}

interface SearchResult {
  id: string
  type: 'person' | 'organization'
  name: string
  slug: string | null
  subtitle: string | null
  badges: string[]
  island: string | null
  status: string
}

async function getSearchResults(
  query: string,
  type: string,
  island: string,
  status: string,
  entityType: string
): Promise<{ results: SearchResult[]; total: number }> {
  if (!query) return { results: [], total: 0 }

  const supabase = await createClient()
  const results: SearchResult[] = []

  if (!type || type === 'person') {
    let q = supabase
      .from('person')
      .select('id, full_name, slug, office_held, entity_types, island, status, party, district')
      .ilike('full_name', `%${query}%`)
      .order('is_featured', { ascending: false })
      .order('full_name')
      .limit(20)

    if (island) q = q.eq('island', island)
    if (status) q = q.eq('status', status)
    if (entityType) q = q.contains('entity_types', [entityType])

    const { data: people } = await q
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

  if (!type || type === 'organization') {
    let q = supabase
      .from('organization')
      .select('id, name, slug, org_type, island, sector, status')
      .ilike('name', `%${query}%`)
      .order('is_featured', { ascending: false })
      .order('name')
      .limit(20)

    if (island) q = q.eq('island', island)
    if (status) q = q.eq('status', status)

    const { data: orgs } = await q
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

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; island?: string; status?: string; entityType?: string }>
}) {
  const params = await searchParams
  const query = params.q || ''
  const { results, total } = await getSearchResults(
    query,
    params.type || '',
    params.island || '',
    params.status || '',
    params.entityType || ''
  )

  return (
    <>
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-4">Search</h1>
          <Suspense fallback={<div className="h-12 bg-navy-light rounded-lg animate-pulse" />}>
            <SearchBar size="lg" />
          </Suspense>
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          <aside className="w-full md:w-56 flex-shrink-0">
            <Suspense fallback={null}>
              <SearchFilters />
            </Suspense>
          </aside>

          <div className="flex-1 min-w-0">
            <SearchResults results={results} query={query} total={total} />
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
