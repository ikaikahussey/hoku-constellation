import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getServiceDb } from '@/lib/db/service'
import { searchEntities, listEntities } from '@/lib/db/queries'
import type { EntityKind } from '@/lib/db/types'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { SearchBar } from '@/components/search/SearchBar'
import { SearchFilters } from '@/components/search/SearchFilters'
import { SearchResults } from '@/components/search/SearchResults'
import { entityRowToCard, type EntityCardProps } from '@/components/search/EntityCard'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search HOKU Insider for people, organizations, and bills in Hawaiʻi public life.',
}

interface Params { q?: string; type?: string; island?: string; status?: string; entityType?: string; sector?: string }

function kindFromType(type: string | undefined): EntityKind | undefined {
  if (type === 'person' || type === 'bill' || type === 'docket' || type === 'parcel' || type === 'office') return type
  if (type === 'organization' || type === 'org') return 'org'
  return undefined
}

async function getResults(p: Params): Promise<{ results: EntityCardProps[]; total: number }> {
  const db = await getServiceDb()
  const query = (p.q ?? '').trim()
  const kind = kindFromType(p.type)
  const hasFilters = !!(p.island || p.status || p.entityType || p.sector || kind)

  if (query) {
    const { results, total } = await searchEntities(db, query, {
      kind: kind ?? ['person', 'org', 'bill'],
      entityTypes: p.entityType ? [p.entityType] : undefined,
      island: p.island || undefined,
      sector: p.sector || undefined,
      status: p.status || undefined,
      limit: 40,
    })
    return { results: results.map(h => ({ id: h.id, kind: h.kind, name: h.name, slug: h.slug, subtitle: h.subtitle, badges: h.badges, island: h.island, status: h.status })), total }
  }

  if (!hasFilters) return { results: [], total: 0 }

  // Browse mode (no query): filter on attributes in SQL.
  const kinds: EntityKind[] = kind ? [kind] : ['person', 'org']
  const { rows, total } = await listEntities(db, {
    kind: kinds,
    status: p.status || undefined,
    island: p.island ? [p.island] : undefined,
    sector: p.sector || undefined,
    entityTypes: p.entityType ? [p.entityType] : undefined,
    limit: 40,
    orderBy: 'name',
  })
  return { results: rows.map(entityRowToCard), total }
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams
  const query = (params.q ?? '').trim()
  const { results, total } = await getResults(params)

  return (
    <>
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-4">Search</h1>
          <Suspense fallback={<div className="h-12 bg-gray-100 animate-pulse" />}>
            <SearchBar size="lg" />
          </Suspense>
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          <aside className="w-full md:w-56 flex-shrink-0" aria-label="Filters">
            <Suspense fallback={null}>
              <SearchFilters />
            </Suspense>
          </aside>
          <div className="flex-1 min-w-0">
            <SearchResults results={results} query={query} total={total} kind={params.type} />
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
