'use client'

import Link from 'next/link'
import type { NewsArticle } from '@/lib/db/queries/news'
import { formatShortDate } from '@/lib/format'
import { track, EVENTS } from '@/lib/analytics-events'
import { entityHref } from '@/components/search/EntityCard'

export function NewsList({ articles }: { articles: NewsArticle[] }) {
  if (articles.length === 0) return <p className="text-sm text-muted py-4">No stories yet.</p>
  return (
    <ul className="divide-y divide-rule">
      {articles.map(a => {
        const summary = a.summary ?? a.description
        return (
          <li key={a.id} className="py-5" data-testid="news-item">
            <p className="text-xs text-muted uppercase tracking-wide tabular">
              {a.outlet_name ?? a.outlet}{a.doc_date ? ` · ${formatShortDate(a.doc_date)}` : ''}{a.author ? ` · ${a.author}` : ''}
            </p>
            <h3 className="text-lg font-bold mt-1">
              {a.url ? (
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="link-quiet"
                  onClick={() => track(EVENTS.DOCUMENT_OPENED, { source: 'news', doc_type: 'article' })}>
                  {a.title ?? 'Untitled'}
                </a>
              ) : (a.title ?? 'Untitled')}
            </h3>
            {summary && <p className="text-sm mt-2 max-w-3xl">{summary}</p>}
            {a.summary_author?.startsWith('model:') && <p className="text-xs text-muted mt-1">Summary generated from the article text.</p>}
            {a.tags.length > 0 && (
              <ul className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-sm" aria-label="Tagged in HOKU Insider">
                {a.tags.map(t => {
                  const href = entityHref(t.kind, t.slug, t.id)
                  return (
                    <li key={t.id}>
                      {href ? <Link href={href} className={t.role === 'subject' ? 'font-bold' : undefined}>{t.name}</Link>
                        : <span className={t.role === 'subject' ? 'font-bold' : undefined}>{t.name}</span>}
                      {' '}<Link href={`/news?entity=${t.id}`} className="text-xs link-quiet text-muted" aria-label={`More stories tagged ${t.name}`}>+</Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
