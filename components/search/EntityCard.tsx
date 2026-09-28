import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import type { EntityKind } from '@/lib/db/types'

export interface EntityCardProps {
  id: string
  kind: EntityKind
  name: string
  slug: string | null
  subtitle: string | null
  badges: string[]
  island: string | null
  status: string | null
}

const KIND_LABEL: Record<EntityKind, string> = {
  person: 'Person',
  org: 'Organization',
  bill: 'Bill',
  docket: 'Docket',
  parcel: 'Parcel',
  office: 'Office',
}

/** Public URL for an entity, or null when the kind has no page yet. */
export function entityHref(kind: EntityKind | string | null, slug: string | null, id: string): string | null {
  if (kind === 'person' && slug) return `/person/${slug}`
  if (kind === 'org' && slug) return `/org/${slug}`
  if (kind === 'bill') return `/bills/${id}`
  return null
}

export function EntityCard({ id, kind, name, slug, subtitle, badges, island, status }: EntityCardProps) {
  const href = entityHref(kind, slug, id)
  const body = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-muted uppercase tracking-wide">{KIND_LABEL[kind] ?? kind}</span>
        </div>
        <h3 className="text-lg font-bold truncate">
          {href ? <Link href={href}>{name}</Link> : name}
        </h3>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        {(badges.length > 0 || island) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {badges.map(badge => (
              <Badge key={badge} variant={kind === 'person' ? 'outline' : 'default'}>{badge.replace(/_/g, ' ')}</Badge>
            ))}
            {island && <Badge variant="muted">{island}</Badge>}
          </div>
        )}
      </div>
      {status && <span className="text-xs text-muted flex-shrink-0">{status}</span>}
    </div>
  )
  return <div className="card bg-paper border border-rule p-4 hover:border-ink transition-colors">{body}</div>
}
