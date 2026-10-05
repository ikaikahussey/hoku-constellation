import Link from 'next/link'
import type { Metadata } from 'next'
import { getServiceDb } from '@/lib/db/service'
import { listNews, newsOutletCounts, getEntity } from '@/lib/db/queries'
import { getCurrentUser } from '@/lib/auth'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { NewsList } from '@/components/news/NewsList'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'News',
  description: 'Reporting from Hawaiʻi news outlets, summarized and tagged with the people, organizations, bills, and dockets HOKU Insider tracks.',
}

const PAGE_SIZE = 50
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RawParams = Record<string, string | string[] | undefined>
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? ''

function newsHref(q: { outlet?: string; entity?: string; page?: number }): string {
  const sp = new URLSearchParams()
  if (q.outlet) sp.set('outlet', q.outlet)
  if (q.entity) sp.set('entity', q.entity)
  if (q.page && q.page > 1) sp.set('page', String(q.page))
  const s = sp.toString()
  return s ? `/news?${s}` : '/news'
}

export default async function NewsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams
  const outlet = first(sp.outlet).slice(0, 64)
  const entityParam = first(sp.entity)
  const entity = UUID.test(entityParam) ? entityParam : ''
  const pageNum = Math.max(1, Number.parseInt(first(sp.page) || '1', 10) || 1)
  const [db, user] = await Promise.all([getServiceDb(), getCurrentUser()])
  const [{ rows, total }, outlets, tagged] = await Promise.all([
    listNews(db, { outlet: outlet || undefined, entityId: entity || undefined, limit: PAGE_SIZE, offset: (pageNum - 1) * PAGE_SIZE }),
    newsOutletCounts(db),
    entity ? getEntity(db, entity) : Promise.resolve(null),
  ])
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <Header signedIn={!!user} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">News</h1>
          <p className="text-muted max-w-3xl">
            Reporting from Hawaiʻi news outlets, read from their public feeds. Each story links to the outlet,
            carries a short summary, and is tagged with the people, organizations, bills, and dockets in HOKU Insider it names.
          </p>
          {tagged && (
            <p className="text-sm mt-2">
              Tagged <strong>{tagged.name}</strong> · <Link href={newsHref({ outlet })}>Clear</Link>
            </p>
          )}
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          <aside className="w-full md:w-64 flex-shrink-0" aria-label="Outlets">
            <h2 className="text-xs font-bold uppercase tracking-wide mb-3">Outlet</h2>
            <ul className="space-y-1 text-sm">
              <li>{outlet ? <Link href={newsHref({ entity })}>All outlets</Link> : <strong>All outlets</strong>}</li>
              {outlets.map(o => (
                <li key={o.outlet} className="flex justify-between gap-2">
                  {o.outlet === outlet ? <strong>{o.outlet_name}</strong> : <Link href={newsHref({ outlet: o.outlet, entity })}>{o.outlet_name}</Link>}
                  <span className="text-muted tabular">{o.n.toLocaleString('en-US')}</span>
                </li>
              ))}
            </ul>
          </aside>

          <section className="flex-1 min-w-0" aria-labelledby="news-heading">
            <h2 id="news-heading" className="sr-only">Stories</h2>
            <p className="text-sm text-muted mb-4 tabular" data-testid="news-count">
              {total.toLocaleString('en-US')} {total === 1 ? 'story' : 'stories'}
              {pageCount > 1 && ` · page ${pageNum} of ${pageCount}`}
            </p>
            <NewsList articles={rows} />
            {pageCount > 1 && (
              <nav aria-label="Pagination" className="flex items-center justify-between mt-8 text-sm">
                {pageNum > 1 ? <Link href={newsHref({ outlet, entity, page: pageNum - 1 })} rel="prev">← Previous</Link> : <span className="text-muted">← Previous</span>}
                <span className="text-muted tabular">Page {pageNum} of {pageCount}</span>
                {pageNum < pageCount ? <Link href={newsHref({ outlet, entity, page: pageNum + 1 })} rel="next">Next →</Link> : <span className="text-muted">Next →</span>}
              </nav>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </>
  )
}
