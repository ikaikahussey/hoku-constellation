import { Badge } from '@/components/ui/Badge'

interface PersonHeaderProps {
  person: Record<string, unknown>
  relationshipCount: number
}

export function PersonHeader({ person, relationshipCount }: PersonHeaderProps) {
  return (
    <div className="mb-8">
      <div className="flex items-start gap-6">
        <div className="w-20 h-20 rounded-full bg-navy-light border border-white/10 flex items-center justify-center flex-shrink-0">
          {person.photo_url ? (
            <img src={person.photo_url as string} alt="" className="w-20 h-20 rounded-full object-cover" />
          ) : (
            <svg className="w-10 h-10 text-white/20" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold text-white">{person.full_name as string}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {person.office_held ? (
              <span className="text-gold">{String(person.office_held)}</span>
            ) : null}
            {person.party ? <span className="text-white/40">·</span> : null}
            {person.party ? <span className="text-white/50">{String(person.party)}</span> : null}
            {person.district ? <span className="text-white/40">·</span> : null}
            {person.district ? <span className="text-white/50">{String(person.district)}</span> : null}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {((person.entity_types as string[]) || []).map((type) => (
              <Badge key={type} variant="gold">{type.replace(/_/g, ' ')}</Badge>
            ))}
            {person.island ? <Badge variant="outline">{String(person.island)}</Badge> : null}
            <Badge variant={person.status === 'active' ? 'success' : 'default'}>
              {person.status as string}
            </Badge>
          </div>
          <div className="flex items-center gap-6 mt-4 text-sm text-white/40">
            <span>{relationshipCount} connection{relationshipCount !== 1 ? 's' : ''}</span>
            {person.website_url ? (
              <a href={String(person.website_url)} target="_blank" rel="noopener noreferrer" className="text-gold/60 hover:text-gold">
                Website
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
