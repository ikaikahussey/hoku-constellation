import Image from 'next/image'
import { Badge } from '@/components/ui/Badge'
import type { EntityRow } from '@/lib/db/types'
import { attr, attrList } from './edges'

interface PersonHeaderProps {
  person: EntityRow
  connectionCount: number
}

export function PersonHeader({ person, connectionCount }: PersonHeaderProps) {
  const officeHeld = attr(person, 'office_held')
  const party = attr(person, 'party')
  const district = attr(person, 'district')
  const island = attr(person, 'island')
  const status = attr(person, 'status')
  const photo = attr(person, 'photo_url')
  const website = attr(person, 'website_url')
  const entityTypes = attrList(person, 'entity_types')
  const subtitle = [officeHeld, party, district].filter(Boolean).join(' · ')

  return (
    <header className="mb-8 pb-8 border-b border-ink">
      <div className="flex items-start gap-6">
        <div className="w-20 h-20 border border-ink flex items-center justify-center flex-shrink-0 overflow-hidden bg-gray-100">
          {photo ? (
            <Image src={photo} alt="" width={80} height={80} unoptimized className="w-20 h-20 object-cover" />
          ) : (
            <span className="text-3xl font-bold" aria-hidden="true">{person.name.charAt(0)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted uppercase tracking-wide mb-1">Person</p>
          <h1 className="text-3xl sm:text-4xl font-bold">{person.name}</h1>
          {subtitle && <p className="mt-2 text-lg">{subtitle}</p>}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {entityTypes.map(type => <Badge key={type} variant="outline">{type.replace(/_/g, ' ')}</Badge>)}
            {island && <Badge variant="muted">{island}</Badge>}
            {status && <Badge variant={status === 'active' ? 'solid' : 'muted'}>{status}</Badge>}
          </div>
          <div className="flex items-center gap-6 mt-4 text-sm text-muted tabular">
            <span>{connectionCount} connection{connectionCount !== 1 ? 's' : ''}</span>
            {website && <a href={website} target="_blank" rel="noopener noreferrer">Website</a>}
          </div>
        </div>
      </div>
    </header>
  )
}
