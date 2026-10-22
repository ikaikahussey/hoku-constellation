import Link from 'next/link'
import type { Metadata } from 'next'
import { getServiceDb } from '@/lib/db/service'
import { listEntities } from '@/lib/db/queries'
import type { EntityRow } from '@/lib/db/types'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { ExploreFacetPanel, ExploreSearchBar } from '@/components/explore/ExploreFilterBar'
import { entityHref } from '@/components/search/EntityCard'
import { EXPLORE_CATEGORIES, exploreHref } from '@/lib/explore/categories'
import {
  EXPLORE_PAGE_SIZE, exploreUrl, filtersToListOptions, hasActiveFilters, islandKey, islandLabel, parseExploreFilters, sortToOrderBy,
  type ExploreFilters,
} from '@/lib/explore/filters'
import { exploreFacets } from '@/lib/explore/facets'
import { humanize, tagLabel, tokenLabel, visibleTags } from '@/lib/entity-tags'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Explore',
  description: 'Every person and organization HOKU Insider tracks, filterable by tags, island, organization type, sector, and status.',
}

interface Props { searchParams: Promise<Record<string, string | string[] | undefined>> }

function str(a: Record<string, unknown>, k: string): string | null {
  return typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : null
}

function rowDetails(e: EntityRow) {
  const a = e.attributes ?? {}
  const island = str(a, 'island')
  return {
    href: entityHref(e.kind, str(a, 'slug'), e.id),
    type: e.kind === 'person' ? 'Person' : 'Organization',
    detail: e.kind === 'person'
      ? [str(a, 'office_held'), str(a, 'party')].filter(Boolean).join(' · ')
      : [str(a, 'org_type'), str(a, 'sector')].filter((x): x is string => !!x).map(humanize).join(' · '),
    tags: visibleTags(a.entity_types),
    island: island ? islandLabel(islandKey(island)) : '',
    status: str(a, 'status') ? humanize(str(a, 'status')!) : '',
  }
}

/** One removable chip per active filter value. */
function activeChips(f: ExploreFilters): { key: string; label: string; href: string }[] {
  const chips: { key: string; label: string; href: string }[] = []
  if (f.q) chips.push({ key: 'q', label: `Name: “${f.q}”`, href: exploreUrl(f, { q: '' }) })
  if (f.kind) chips.push({ key: 'kind', label: f.kind === 'person' ? 'People' : 'Organizations', href: exploreUrl(f, { kind: null }) })
  for (const t of f.tags) chips.push({ key: `tag:${t}`, label: tokenLabel(t), href: exploreUrl(f, { tags: f.tags.filter(x => x !== t) }) })
  for (const v of f.islands) chips.push({ key: `island:${v}`, label: islandLabel(v), href: exploreUrl(f, { islands: f.islands.filter(x => x !== v) }) })
  for (const v of f.orgTypes) chips.push({ key: `orgType:${v}`, label: humanize(v), href: exploreUrl(f, { orgTypes: f.orgTypes.filter(x => x !== v) }) })
  for (const v of f.sectors) chips.push({ key: `sector:${v}`, label: humanize(v), href: exploreUrl(f, { sectors: f.sectors.filter(x => x !== v) }) })
  for (const v of f.statuses) chips.push({ key: `status:${v}`, label: humanize(v), href: exploreUrl(f, { statuses: f.statuses.filter(x => x !== v) }) })
  return chips
}

export default async function ExplorePage({ searchParams }: Props) {
  const filters = parseExploreFilters(await searchParams)
  const db = await getServiceDb()
  const { rows, total } = await listEntities(db, {
    ...filtersToListOptions(filters),
    orderBy: sortToOrderBy(filters.sort),
    limit: EXPLORE_PAGE_SIZE,
    offset: (filters.page - 1) * EXPLORE_PAGE_SIZE,
  })
  const facets = await exploreFacets(db, filters)
  const pageCount = Math.max(1, Math.ceil(total / EXPLORE_PAGE_SIZE))
  const page = Math.min(filters.page, pageCount)
  const first = total === 0 ? 0 : (page - 1) * EXPLORE_PAGE_SIZE + 1
  const last = Math.min(total, page * EXPLORE_PAGE_SIZE)
  const chips = activeChips(filters)

  return (
    <>
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-2">Explore</h1>
        <p className="text-muted mb-6 max-w-2xl">Every person and organization in the database. Tags overlap: one entry can be a candidate, a donor, and a lobbyist. Select any number of filters; the URL is shareable.</p>

        <nav aria-label="Quick views" className="mb-6 text-sm flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xs font-bold uppercase tracking-wide">Quick views</span>
          {EXPLORE_CATEGORIES.map(c => (
            <Link key={c.slug} href={exploreHref(c.slug)} className="link-quiet whitespace-nowrap">{c.label}</Link>
          ))}
        </nav>

        <div className="mb-6 pb-6 border-b border-ink">
          <ExploreSearchBar filters={filters} facets={facets} />
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          <aside className="w-full md:w-64 flex-shrink-0" aria-label="Filters">
            <ExploreFacetPanel filters={filters} facets={facets} activeCount={chips.length} />
          </aside>

          <section className="flex-1 min-w-0" aria-labelledby="results-heading">
            <h2 id="results-heading" className="sr-only">Results</h2>

            {chips.length > 0 && (
              <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2 mb-3 text-sm">
                {chips.map(c => (
                  <li key={c.key}>
                    <Link href={c.href} scroll={false} className="link-quiet inline-flex items-center gap-1.5 border border-ink px-2 py-0.5" aria-label={`Remove filter ${c.label}`}>
                      {c.label}<span aria-hidden="true">×</span>
                    </Link>
                  </li>
                ))}
                {filters.tags.length > 1 && <li className="text-xs text-muted">{filters.match === 'all' ? 'Matching all tags' : 'Matching any tag'}</li>}
                <li><Link href="/explore" scroll={false} className="text-sm">Clear all</Link></li>
              </ul>
            )}

            <p className="text-sm text-muted mb-3 tabular" data-testid="explore-count" aria-live="polite">
              {total === 0 ? 'No matches' : `${first.toLocaleString('en-US')}–${last.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ${total === 1 ? 'entry' : 'entries'}`}
            </p>

            {rows.length === 0 ? (
              <div className="py-16 text-center text-muted">
                <p>No people or organizations match these filters.</p>
                {hasActiveFilters(filters) && <p className="mt-2"><Link href="/explore">Clear filters</Link></p>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">People and organizations</caption>
                  <thead>
                    <tr className="border-b border-ink text-left">
                      <th scope="col" className="py-2 pr-3 text-xs font-bold uppercase tracking-wide">Name</th>
                      <th scope="col" className="py-2 px-3 text-xs font-bold uppercase tracking-wide">Details</th>
                      <th scope="col" className="py-2 px-3 text-xs font-bold uppercase tracking-wide hidden md:table-cell">Tags</th>
                      <th scope="col" className="py-2 px-3 text-xs font-bold uppercase tracking-wide hidden sm:table-cell">Island</th>
                      <th scope="col" className="py-2 pl-3 text-xs font-bold uppercase tracking-wide hidden lg:table-cell">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(e => {
                      const d = rowDetails(e)
                      return (
                        <tr key={e.id} className="border-b border-rule align-top">
                          <td className="py-2.5 pr-3">
                            <span className="font-bold">{d.href ? <Link href={d.href}>{e.name}</Link> : e.name}</span>
                            <span className="block text-xs text-muted">{d.type}</span>
                          </td>
                          <td className="py-2.5 px-3">{d.detail}</td>
                          <td className="py-2.5 px-3 hidden md:table-cell">
                            {d.tags.length > 0 && (
                              <ul className="flex flex-wrap gap-1">
                                {d.tags.map(t => (
                                  <li key={t}>
                                    {filters.tags.includes(t)
                                      ? <span className="inline-block border border-ink px-1.5 text-xs font-bold">{tagLabel(t)}</span>
                                      : <Link href={exploreUrl(filters, { tags: [...filters.tags, t] })} scroll={false} className="link-quiet inline-block border border-rule px-1.5 text-xs" title={`Add filter: ${tagLabel(t)}`}>{tagLabel(t)}</Link>}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap hidden sm:table-cell">{d.island}</td>
                          <td className="py-2.5 pl-3 text-muted hidden lg:table-cell">{d.status}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {pageCount > 1 && (
              <nav aria-label="Pagination" className="flex items-center justify-between mt-8 text-sm">
                {page > 1 ? <Link href={exploreUrl(filters, { page: page - 1 })} rel="prev">← Previous</Link> : <span className="text-muted">← Previous</span>}
                <span className="text-muted tabular">Page {page} of {pageCount}</span>
                {page < pageCount ? <Link href={exploreUrl(filters, { page: page + 1 })} rel="next">Next →</Link> : <span className="text-muted">Next →</span>}
              </nav>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </>
  )
}
