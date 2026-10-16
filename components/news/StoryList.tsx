'use client'

import Link from 'next/link'
import type { NewsStory } from '@/lib/db/queries/news'
import { formatShortDate } from '@/lib/format'
import { track, EVENTS } from '@/lib/analytics-events'
import { entityHref } from '@/components/search/EntityCard'

const openArticle = () => track(EVENTS.DOCUMENT_OPENED, { source: 'news', doc_type: 'article' })

/** News stories: one headline and summary per event, with every outlet's article linked beneath. */
export function StoryList({ stories }: { stories: NewsStory[] }) {
  if (stories.length === 0) return <p className="text-sm text-muted py-4">No stories yet.</p>
  return (
    <ul className="divide-y divide-rule">
      {stories.map(s => {
        const single = s.articles.length === 1 ? s.articles[0] : null
        const date = s.last_published?.slice(0, 10) ?? s.articles[s.articles.length - 1]?.doc_date ?? null
        return (
          <li key={s.id} className="py-5" data-testid="news-story">
            <p className="text-xs text-muted uppercase tracking-wide tabular">
              {single
                ? <>{single.outlet_name ?? single.outlet}{single.author ? ` · ${single.author}` : ''}</>
                : <>{s.outlet_count} {s.outlet_count === 1 ? 'outlet' : 'outlets'} · {s.articles.length} articles</>}
              {date ? ` · ${formatShortDate(date)}` : ''}
            </p>
            <h3 className="text-lg font-bold mt-1">
              {single?.url ? (
                <a href={single.url} target="_blank" rel="noopener noreferrer" className="link-quiet" onClick={openArticle}>{s.headline}</a>
              ) : s.headline}
            </h3>
            {s.summary && <p className="text-sm mt-2 max-w-3xl">{s.summary}</p>}
            {s.summary_author?.startsWith('model:') && (
              <p className="text-xs text-muted mt-1">
                {single ? 'Summary generated from the article text.' : 'Summary generated from the outlets’ reports.'}
              </p>
            )}
            {!single && (
              <ul className="mt-3 space-y-1 text-sm" aria-label="Coverage">
                {s.articles.map(a => (
                  <li key={a.id} className="flex flex-wrap gap-x-2">
                    <span className="font-bold">{a.outlet_name ?? a.outlet}</span>
                    {a.url
                      ? <a href={a.url} target="_blank" rel="noopener noreferrer" onClick={openArticle}>{a.title ?? 'Untitled'}</a>
                      : <span>{a.title ?? 'Untitled'}</span>}
                    {a.doc_date && <span className="text-muted tabular">{formatShortDate(a.doc_date)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {s.tags.length > 0 && (
              <ul className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-sm" aria-label="Tagged in HOKU Insider">
                {s.tags.map(t => {
                  const href = entityHref(t.kind, t.slug, t.id)
                  const cls = t.role === 'subject' ? 'font-bold' : undefined
                  return (
                    <li key={t.id}>
                      {href ? <Link href={href} className={cls}>{t.name}</Link> : <span className={cls}>{t.name}</span>}
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
