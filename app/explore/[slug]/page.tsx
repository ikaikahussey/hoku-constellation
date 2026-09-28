import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServiceDb } from '@/lib/db/service'
import { listEntities } from '@/lib/db/queries'
import { GROUP_LABEL, categoriesInGroup, categoryListOptions, exploreHref, getExploreCategory } from '@/lib/explore/categories'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { EntityCard, entityRowToCard } from '@/components/search/EntityCard'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

interface Props { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const category = getExploreCategory(slug)
  if (!category) return { title: 'Not found' }
  return {
    title: `${category.label} — Explore`,
    description: category.description,
    alternates: { canonical: exploreHref(category.slug) },
    openGraph: { title: `${category.label} — HOKU Insider`, description: category.description },
  }
}

function pageNumber(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export default async function ExploreCategoryPage({ params, searchParams }: Props) {
  const [{ slug }, { page: rawPage }] = await Promise.all([params, searchParams])
  const category = getExploreCategory(slug)
  if (!category) notFound()

  const page = pageNumber(rawPage)
  const db = await getServiceDb()
  const { rows, total } = await listEntities(db, {
    ...categoryListOptions(category),
    orderBy: 'name',
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const siblings = categoriesInGroup(category.group).filter(c => c.slug !== category.slug)
  const href = (p: number) => (p === 1 ? exploreHref(category.slug) : `${exploreHref(category.slug)}?page=${p}`)

  return (
    <>
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <nav aria-label="Breadcrumb" className="text-sm text-muted mb-4">
          <Link href="/explore" className="link-quiet">Explore</Link>
          <span aria-hidden="true" className="mx-2">/</span>
          <span>{GROUP_LABEL[category.group]}</span>
          <span aria-hidden="true" className="mx-2">/</span>
          <span className="text-ink">{category.label}</span>
        </nav>

        <h1 className="text-3xl font-bold mb-2">{category.label}</h1>
        <p className="text-muted mb-8 max-w-2xl">{category.description}</p>

        <div className="flex flex-col md:flex-row gap-8">
          <aside className="w-full md:w-56 flex-shrink-0" aria-label={GROUP_LABEL[category.group]}>
            <h2 className="text-xs font-bold uppercase tracking-wide mb-3 pb-1 border-b border-ink">{GROUP_LABEL[category.group]}</h2>
            <ul className="space-y-1.5 text-sm">
              <li aria-current="page" className="font-bold">{category.label}</li>
              {siblings.map(c => (
                <li key={c.slug}><Link href={exploreHref(c.slug)} className="link-quiet">{c.label}</Link></li>
              ))}
            </ul>
          </aside>

          <section className="flex-1 min-w-0" aria-labelledby="results-heading">
            <h2 id="results-heading" className="sr-only">{category.label} results</h2>
            <p className="text-sm text-muted mb-4 tabular" data-testid="explore-count">
              {total.toLocaleString('en-US')} {total === 1 ? 'entry' : 'entries'}
              {pageCount > 1 && ` · page ${page} of ${pageCount}`}
            </p>
            {rows.length === 0 ? (
              <p className="py-16 text-center text-muted">No entries in this category yet.</p>
            ) : (
              <ul className="space-y-3">
                {rows.map(r => <li key={r.id}><EntityCard {...entityRowToCard(r)} /></li>)}
              </ul>
            )}
            {pageCount > 1 && (
              <nav aria-label="Pagination" className="flex items-center justify-between mt-8 text-sm">
                {page > 1 ? <Link href={href(page - 1)} rel="prev">← Previous</Link> : <span className="text-muted">← Previous</span>}
                <span className="text-muted tabular">Page {page} of {pageCount}</span>
                {page < pageCount ? <Link href={href(page + 1)} rel="next">Next →</Link> : <span className="text-muted">Next →</span>}
              </nav>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </>
  )
}
