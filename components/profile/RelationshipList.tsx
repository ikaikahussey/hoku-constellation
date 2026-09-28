import Link from 'next/link'
import type { EdgeWithEnds } from '@/lib/db/queries/edges'
import { otherEnd, isCurrent, typeLabel, dateRange } from './edges'

interface RelationshipListProps {
  edges: EdgeWithEnds[]
  entityId: string
  emptyMessage?: string
}

/** Groups an entity's position edges by type and renders the other party, role, and dates. */
export function RelationshipList({ edges, entityId, emptyMessage = 'No connections documented yet.' }: RelationshipListProps) {
  if (edges.length === 0) return <p className="text-sm text-muted py-4">{emptyMessage}</p>

  const grouped = new Map<string, EdgeWithEnds[]>()
  for (const edge of edges) {
    const list = grouped.get(edge.type) ?? []
    list.push(edge)
    grouped.set(edge.type, list)
  }

  return (
    <div className="space-y-8">
      {[...grouped.entries()].map(([type, list]) => (
        <section key={type}>
          <h3 className="text-xs font-bold uppercase tracking-wide mb-2 pb-1 border-b border-ink">
            {typeLabel(type)} <span className="text-muted font-normal tabular">({list.length})</span>
          </h3>
          <ul className="divide-y divide-rule">
            {list.map(edge => {
              const other = otherEnd(edge, entityId)
              const current = isCurrent(edge)
              const range = dateRange(edge)
              return (
                <li key={edge.id} className="py-2.5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-bold">
                      {other.href ? <Link href={other.href} className="link-quiet">{other.name}</Link> : other.name}
                      {edge.match_status !== 'matched' && <span className="ml-2 text-xs text-muted font-normal">(unverified match)</span>}
                    </p>
                    {edge.role && <p className="text-sm text-muted">{edge.role}</p>}
                  </div>
                  <div className="text-right text-xs text-muted flex-shrink-0 tabular">
                    {range && <div>{range}</div>}
                    {!current && <div>former</div>}
                    {edge.doc_url ? (
                      <a href={edge.doc_url} target="_blank" rel="noopener noreferrer">{edge.doc_source.replace(/_/g, ' ')}</a>
                    ) : (
                      <div>{edge.doc_source.replace(/_/g, ' ')}</div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
