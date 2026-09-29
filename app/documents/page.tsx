import Link from 'next/link'
import type { Metadata } from 'next'
import { getServiceDb } from '@/lib/db/service'
import { listDocuments, documentFacets } from '@/lib/db/queries'
import { PAID_DOC_TYPES, DOCUMENT_BROWSER_GATED } from '@/lib/db/gating'
import { getCurrentUser } from '@/lib/auth'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { DocumentFilters, documentsHref, type DocumentQuery } from '@/components/documents/DocumentFilters'
import { DocumentTable } from '@/components/documents/DocumentTable'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Documents',
  description: 'Every public record HOKU Insider tracks: filings, measures, contracts, dockets, and disclosures, searchable by title, type, source, and date.',
}

const PAGE_SIZE = 50
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

type RawParams = Record<string, string | string[] | undefined>

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? ''
}

function parseDocumentQuery(sp: RawParams): DocumentQuery {
  const page = Number.parseInt(first(sp.page) || '1', 10)
  const from = first(sp.from)
  const to = first(sp.to)
  return {
    q: first(sp.q).slice(0, 200),
    source: first(sp.source).slice(0, 64),
    type: first(sp.type).slice(0, 64),
    from: ISO_DATE.test(from) ? from : '',
    to: ISO_DATE.test(to) ? to : '',
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  }
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const query = parseDocumentQuery(await searchParams)
  const [db, user] = await Promise.all([getServiceDb(), getCurrentUser()])
  const hasAccess = !DOCUMENT_BROWSER_GATED || !!user?.canAccessGated
  const excludeDocTypes = hasAccess ? [] : [...PAID_DOC_TYPES]

  const opts = {
    q: query.q || undefined,
    sources: query.source ? [query.source] : undefined,
    docTypes: query.type ? [query.type] : undefined,
    from: query.from || undefined,
    to: query.to || undefined,
    excludeDocTypes,
  }
  const [{ rows, total }, facets] = await Promise.all([
    listDocuments(db, { ...opts, limit: PAGE_SIZE, offset: (query.page - 1) * PAGE_SIZE }),
    documentFacets(db, opts),
  ])
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const lockedDocTypes = hasAccess ? [] : [...PAID_DOC_TYPES].sort()

  return (
    <>
      <Header signedIn={!!user} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Documents</h1>
          <p className="text-muted max-w-3xl">
            Every source record behind the facts on HOKU Insider. Each document is one filing, measure, contract,
            docket entry, or disclosure fetched from a government source; the facts column counts the relationships drawn from it.
          </p>
          {!hasAccess && (
            <p className="text-sm text-muted mt-2">
              Campaign finance, lobbying, contract, property, and ethics records are listed for <Link href="/pricing">subscribers</Link>.
            </p>
          )}
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          <aside className="w-full md:w-64 flex-shrink-0" aria-label="Filters">
            <DocumentFilters query={query} facets={facets} lockedDocTypes={lockedDocTypes} />
          </aside>

          <section className="flex-1 min-w-0" aria-labelledby="documents-heading">
            <h2 id="documents-heading" className="sr-only">Results</h2>
            <p className="text-sm text-muted mb-4 tabular" data-testid="documents-count">
              {total.toLocaleString('en-US')} {total === 1 ? 'document' : 'documents'}
              {query.q && <> matching <q>{query.q}</q></>}
              {pageCount > 1 && ` · page ${query.page} of ${pageCount}`}
            </p>
            <DocumentTable rows={rows} />
            {pageCount > 1 && (
              <nav aria-label="Pagination" className="flex items-center justify-between mt-8 text-sm">
                {query.page > 1 ? <Link href={documentsHref({ ...query, page: query.page - 1 })} rel="prev">← Previous</Link> : <span className="text-muted">← Previous</span>}
                <span className="text-muted tabular">Page {query.page} of {pageCount}</span>
                {query.page < pageCount ? <Link href={documentsHref({ ...query, page: query.page + 1 })} rel="next">Next →</Link> : <span className="text-muted">Next →</span>}
              </nav>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </>
  )
}
