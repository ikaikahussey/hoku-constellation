import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getServiceDb } from '@/lib/db/service'
import { searchEntities, listEntities } from '@/lib/db/queries'
import type { EntityKind, EntityRow } from '@/lib/db/types'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { SearchBar } from '@/components/search/SearchBar'
import { SearchFilters } from '@/components/search/SearchFilters'
import { SearchResults } from '@/components/search/SearchResults'
import type { EntityCardProps } from '@/components/search/EntityCard'

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

function str(a: Record<string, unknown>, k: string): string | null {
  return typeof a[k] === 'string' ? (a[k] as string) : null
}

function rowToCard(r: EntityRow): EntityCardProps {
  const a = r.attributes ?? {}
  const subtitle = r.kind === 'person'
    ? [str(a, 'office_held'), str(a, 'party'), str(a, 'district')].filter(Boolean).join(' · ')
    : r.kind === 'org'
      ? [str(a, 'org_type')?.replace(/_/g, ' '), str(a, 'sector')?.replace(/_/g, ' ')].filter(Boolean).join(' · ')
      : [str(a, 'measure_number'), str(a, 'session')].filter(Boolean).join(' · ')
  const badges = r.kind === 'person'
    ? (Array.isArray(a.entity_types) ? (a.entity_types as string[]) : [])
    : r.kind === 'org' ? [str(a, 'org_type')].filter((x): x is string => !!x) : [r.kind]
  return { id: r.id, kind: r.kind, name: r.name, slug: str(a, 'slug'), subtitle: subtitle || null, badges, island: str(a, 'island'), status: str(a, 'status') }
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

  // Browse mode (no query): list by kind and filter on attributes in memory.
  const kinds: EntityKind[] = kind ? [kind] : ['person', 'org']
  const lists = await Promise.all(kinds.map(k => listEntities(db, { kind: k, status: p.status || undefined, limit: 200, orderBy: 'name' })))
  let rows = lists.flatMap(l => l.rows)
  if (p.island) rows = rows.filter(r => str(r.attributes, 'island') === p.island)
  if (p.sector) rows = rows.filter(r => str(r.attributes, 'sector') === p.sector)
  if (p.entityType) rows = rows.filter(r => Array.isArray(r.attributes.entity_types) && (r.attributes.entity_types as string[]).includes(p.entityType!))
  return { results: rows.slice(0, 40).map(rowToCard), total: rows.length }
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
