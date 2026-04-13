interface TimelineViewProps {
  events: Record<string, unknown>[]
}

export function TimelineView({ events }: TimelineViewProps) {
  if (events.length === 0) {
    return <p className="text-white/30 text-sm py-4">No timeline events documented yet.</p>
  }

  const typeColors: Record<string, string> = {
    elected: 'bg-gold',
    appointed: 'bg-gold',
    resigned: 'bg-error',
    indicted: 'bg-error',
    convicted: 'bg-error',
    founded_org: 'bg-ocean',
    joined_board: 'bg-ocean',
    major_donation: 'bg-gold-light',
    legislation_passed: 'bg-success',
    achievement: 'bg-success',
  }

  return (
    <div className="relative">
      <div className="absolute left-4 top-0 bottom-0 w-px bg-white/10" />
      <div className="space-y-6">
        {events.map((event) => (
          <div key={event.id as string} className="relative pl-10">
            <div className={`absolute left-[11px] top-1.5 w-2.5 h-2.5 rounded-full ${typeColors[event.event_type as string] || 'bg-white/30'}`} />
            <div>
              <div className="flex items-center gap-2">
                <time className="text-xs text-white/30">
                  {event.event_date ? new Date(event.event_date as string).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''}
                </time>
                <span className="text-xs rounded-full bg-white/5 px-2 py-0.5 text-white/40">
                  {(event.event_type as string || '').replace(/_/g, ' ')}
                </span>
              </div>
              <h3 className="text-sm font-medium text-white mt-1">{event.title as string}</h3>
              {event.description ? (
                <p className="text-xs text-white/50 mt-1">{String(event.description)}</p>
              ) : null}
              {event.source_url ? (
                <a href={String(event.source_url)} target="_blank" rel="noopener noreferrer" className="text-xs text-gold/50 hover:text-gold mt-1 inline-block">
                  Source
                </a>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
