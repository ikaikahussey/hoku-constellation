import Link from 'next/link'
import type { DocumentFacets } from '@/lib/db/queries/documents'
import { inputClass } from '@/components/ui/Input'
import { buttonClass } from '@/components/ui/Button'
import { docTypeLabel, sourceLabel, sourceTitle } from './labels'

export interface DocumentQuery {
  q: string
  source: string
  type: string
  from: string
  to: string
  page: number
}

export function documentsHref(query: Partial<DocumentQuery>): string {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  if (query.source) params.set('source', query.source)
  if (query.type) params.set('type', query.type)
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  if (query.page && query.page > 1) params.set('page', String(query.page))
  const s = params.toString()
  return s ? `/documents?${s}` : '/documents'
}

interface Props {
  query: DocumentQuery
  facets: DocumentFacets
  /** Doc types hidden from this visitor. Shown as locked entries linking to pricing. */
  lockedDocTypes: string[]
}

function FacetLink({ href, active, label, count, title }: { href: string; active: boolean; label: string; count?: number; title?: string }) {
  return (
    <li>
      <Link
        href={href}
        title={title}
        aria-current={active ? 'true' : undefined}
        className={`flex items-baseline justify-between gap-2 px-3 py-1 text-sm border-l-2 link-quiet ${active ? 'border-ink font-bold' : 'border-transparent text-muted hover:text-ink'}`}
      >
        <span className="truncate">{label}</span>
        {count !== undefined && <span className="tabular text-xs text-muted flex-shrink-0">{count.toLocaleString('en-US')}</span>}
      </Link>
    </li>
  )
}

/** Server-rendered filters: a GET form for text and dates, facet links for source and type. */
export function DocumentFilters({ query, facets, lockedDocTypes }: Props) {
  const base = { q: query.q, source: query.source, type: query.type, from: query.from, to: query.to }
  return (
    <div className="space-y-8">
      <form method="get" action="/documents" className="space-y-3" role="search" aria-label="Search documents">
        {query.source && <input type="hidden" name="source" value={query.source} />}
        {query.type && <input type="hidden" name="type" value={query.type} />}
        <div>
          <label htmlFor="doc-q" className="block text-xs font-bold uppercase tracking-wide mb-1">Search</label>
          <input id="doc-q" name="q" type="search" defaultValue={query.q} placeholder="Title, record id, or text" className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="doc-from" className="block text-xs font-bold uppercase tracking-wide mb-1">From</label>
            <input id="doc-from" name="from" type="date" defaultValue={query.from} className={inputClass} />
          </div>
          <div>
            <label htmlFor="doc-to" className="block text-xs font-bold uppercase tracking-wide mb-1">To</label>
            <input id="doc-to" name="to" type="date" defaultValue={query.to} className={inputClass} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className={buttonClass('primary', 'sm')}>Apply</button>
          {(query.q || query.source || query.type || query.from || query.to) && <Link href="/documents" className="text-sm link-quiet">Clear all</Link>}
        </div>
      </form>

      <nav aria-label="Document type">
        <h2 className="text-xs font-bold uppercase tracking-wide mb-2 pb-1 border-b border-ink">Type</h2>
        <ul>
          <FacetLink href={documentsHref({ ...base, type: '' })} active={!query.type} label="All types" />
          {facets.docTypes.map(f => (
            <FacetLink key={f.value} href={documentsHref({ ...base, type: query.type === f.value ? '' : f.value })} active={query.type === f.value} label={docTypeLabel(f.value)} count={f.n} />
          ))}
          {lockedDocTypes.map(t => (
            <li key={t}>
              <Link href="/pricing" className="flex items-baseline justify-between gap-2 px-3 py-1 text-sm border-l-2 border-transparent text-muted link-quiet" title="Available to subscribers">
                <span className="truncate">{docTypeLabel(t)}</span>
                <span className="text-xs uppercase tracking-wide flex-shrink-0">subscribers</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-label="Source">
        <h2 className="text-xs font-bold uppercase tracking-wide mb-2 pb-1 border-b border-ink">Source</h2>
        <ul>
          <FacetLink href={documentsHref({ ...base, source: '' })} active={!query.source} label="All sources" />
          {facets.sources.map(f => (
            <FacetLink key={f.value} href={documentsHref({ ...base, source: query.source === f.value ? '' : f.value })} active={query.source === f.value} label={sourceLabel(f.value)} title={sourceTitle(f.value)} count={f.n} />
          ))}
        </ul>
      </nav>
    </div>
  )
}
