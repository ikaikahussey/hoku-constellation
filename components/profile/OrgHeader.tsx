import { Badge } from '@/components/ui/Badge'
import type { EntityRow } from '@/lib/db/types'
import { attr } from './edges'

interface OrgHeaderProps {
  org: EntityRow
  connectionCount: number
}

export function OrgHeader({ org, connectionCount }: OrgHeaderProps) {
  const orgType = attr(org, 'org_type')
  const sector = attr(org, 'sector')
  const island = attr(org, 'island')
  const status = attr(org, 'status')
  const website = attr(org, 'website_url')

  return (
    <header className="mb-8 pb-8 border-b border-ink">
      <div className="flex items-start gap-6">
        <div className="w-20 h-20 border border-ink flex items-center justify-center flex-shrink-0 bg-paper" aria-hidden="true">
          <span className="text-3xl font-bold">{org.name.charAt(0)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted uppercase tracking-wide mb-1">Organization</p>
          <h1 className="text-3xl sm:text-4xl font-bold">{org.name}</h1>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {orgType && <Badge variant="outline">{orgType.replace(/_/g, ' ')}</Badge>}
            {sector && <Badge>{sector.replace(/_/g, ' ')}</Badge>}
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
