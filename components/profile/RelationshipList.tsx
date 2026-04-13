import Link from 'next/link'

interface RelationshipListProps {
  relationships: Record<string, unknown>[]
  centerId: string
  centerType: 'person' | 'organization'
}

export function RelationshipList({ relationships, centerId, centerType }: RelationshipListProps) {
  if (relationships.length === 0) {
    return <p className="text-white/30 text-sm py-4">No connections documented yet.</p>
  }

  // Group by relationship type
  const grouped: Record<string, Record<string, unknown>[]> = {}
  for (const rel of relationships) {
    const type = (rel.relationship_type as string) || 'other'
    if (!grouped[type]) grouped[type] = []
    grouped[type].push(rel)
  }

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([type, rels]) => (
        <div key={type}>
          <h3 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">
            {type.replace(/_/g, ' ')}
          </h3>
          <div className="space-y-2">
            {rels.map((rel) => {
              // Determine the "other" entity in this relationship
              const isSource = (centerType === 'person' && (rel.source_person_id === centerId)) ||
                               (centerType === 'organization' && (rel.source_org_id === centerId))

              const targetPerson = isSource ? rel.target_person as Record<string, unknown> | null : rel.source_person as Record<string, unknown> | null
              const targetOrg = isSource ? rel.target_org as Record<string, unknown> | null : rel.source_org as Record<string, unknown> | null
              const target = targetPerson || targetOrg
              const targetType = targetPerson ? 'person' : 'organization'

              if (!target) return null

              const name = (target.full_name || target.name) as string
              const slug = target.slug as string
              const href = targetType === 'person' ? `/person/${slug}` : `/org/${slug}`

              return (
                <div key={rel.id as string} className="flex items-center justify-between bg-navy-light rounded-md border border-white/5 p-3">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${targetType === 'person' ? 'bg-gold' : 'bg-ocean'}`} />
                    <div>
                      <Link href={href} className="text-sm font-medium text-white hover:text-gold transition-colors">
                        {name}
                      </Link>
                      {rel.title ? (
                        <p className="text-xs text-white/40">{String(rel.title)}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!rel.is_current ? (
                      <span className="text-xs text-white/30">former</span>
                    ) : null}
                    {rel.source_description ? (
                      <span className="text-xs text-white/20" title={String(rel.source_description)}>
                        sourced
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
