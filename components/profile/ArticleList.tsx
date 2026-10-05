'use client'

import type { DocumentForEntity } from '@/lib/db/queries/documents'
import { formatShortDate } from '@/lib/format'
import { track, EVENTS } from '@/lib/analytics-events'

interface ArticleListProps {
  articles: DocumentForEntity[]
}

export function ArticleList({ articles }: ArticleListProps) {
  if (articles.length === 0) return <p className="text-sm text-muted py-4">No linked reporting yet.</p>

  return (
    <ul className="divide-y divide-rule">
      {articles.map(article => {
        const title = article.title ?? 'Untitled'
        const outletName = article.raw?.outlet_name
        const source = typeof outletName === 'string' ? outletName : article.source.replace(/_/g, ' ')
        return (
          <li key={article.id} className="py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold">
                  {article.url ? (
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-quiet"
                      onClick={() => track(EVENTS.DOCUMENT_OPENED, { source: article.source, doc_type: article.doc_type })}
                    >
                      {title}
                    </a>
                  ) : title}
                </h3>
                {article.body_text && <p className="text-sm text-muted mt-1 line-clamp-2">{article.body_text}</p>}
                <p className="text-xs text-muted mt-2 tabular">
                  {source}{article.doc_date ? ` · ${formatShortDate(article.doc_date)}` : ''}
                </p>
              </div>
              {article.role && <span className="text-xs text-muted flex-shrink-0 uppercase tracking-wide">{article.role.replace(/_/g, ' ')}</span>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
