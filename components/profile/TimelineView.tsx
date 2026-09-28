import type { DocumentForEntity } from '@/lib/db/queries/documents'
import { formatShortDate } from '@/lib/format'

interface TimelineViewProps {
  events: DocumentForEntity[]
}

function str(raw: Record<string, unknown> | undefined, key: string): string | null {
  const v = raw?.[key]
  return typeof v === 'string' && v.length ? v : null
}

/** Renders `doc_type = 'event'` documents (from getEventsForEntity) as a vertical timeline. */
export function TimelineView({ events }: TimelineViewProps) {
  if (events.length === 0) return <p className="text-sm text-muted py-4">No timeline events documented yet.</p>

  return (
    <ol className="relative border-l border-ink ml-2">
      {events.map(event => {
        const eventType = event.role ?? str(event.raw, 'event_type')
        const description = str(event.raw, 'description') ?? event.body_text
        const sourceUrl = event.url ?? str(event.raw, 'source_url')
        return (
          <li key={event.id} className="relative pl-6 pb-6 last:pb-0">
            <span className="absolute -left-[5px] top-2 w-2 h-2 bg-ink" aria-hidden="true" />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted tabular">
              {event.doc_date && <time dateTime={event.doc_date}>{formatShortDate(event.doc_date)}</time>}
              {eventType && <span className="uppercase tracking-wide">{eventType.replace(/_/g, ' ')}</span>}
            </div>
            <h3 className="font-bold mt-1">{event.title ?? 'Event'}</h3>
            {description && <p className="text-sm text-muted mt-1">{description}</p>}
            {sourceUrl && (
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs mt-1 inline-block">Source</a>
            )}
          </li>
        )
      })}
    </ol>
  )
}
