'use client'

import { useRouter } from 'next/navigation'
import { ConstellationGraph } from './ConstellationGraph'
import { ConstellationLegend } from './ConstellationLegend'

interface ConstellationWrapperProps {
  centerId: string
  centerName: string
  centerType: 'person' | 'organization'
  centerSlug: string | null
  relationships: Record<string, unknown>[]
}

export function ConstellationWrapper({
  centerId,
  centerName,
  centerType,
  centerSlug,
  relationships,
}: ConstellationWrapperProps) {
  const router = useRouter()

  // Build nodes and edges from relationships
  const nodeMap = new Map<string, { id: string; name: string; type: 'person' | 'organization'; slug: string | null; isCenter: boolean }>()

  nodeMap.set(centerId, {
    id: centerId,
    name: centerName,
    type: centerType,
    slug: centerSlug,
    isCenter: true,
  })

  const edges: { source: string; target: string; label: string; isCurrent: boolean }[] = []

  for (const rel of relationships) {
    const srcPerson = rel.source_person as Record<string, unknown> | null
    const srcOrg = rel.source_org as Record<string, unknown> | null
    const tgtPerson = rel.target_person as Record<string, unknown> | null
    const tgtOrg = rel.target_org as Record<string, unknown> | null

    const sourceId = (rel.source_person_id || rel.source_org_id) as string
    const targetId = (rel.target_person_id || rel.target_org_id) as string

    if (srcPerson && !nodeMap.has(srcPerson.id as string)) {
      nodeMap.set(srcPerson.id as string, {
        id: srcPerson.id as string,
        name: srcPerson.full_name as string,
        type: 'person',
        slug: srcPerson.slug as string,
        isCenter: false,
      })
    }
    if (srcOrg && !nodeMap.has(srcOrg.id as string)) {
      nodeMap.set(srcOrg.id as string, {
        id: srcOrg.id as string,
        name: srcOrg.name as string,
        type: 'organization',
        slug: srcOrg.slug as string,
        isCenter: false,
      })
    }
    if (tgtPerson && !nodeMap.has(tgtPerson.id as string)) {
      nodeMap.set(tgtPerson.id as string, {
        id: tgtPerson.id as string,
        name: tgtPerson.full_name as string,
        type: 'person',
        slug: tgtPerson.slug as string,
        isCenter: false,
      })
    }
    if (tgtOrg && !nodeMap.has(tgtOrg.id as string)) {
      nodeMap.set(tgtOrg.id as string, {
        id: tgtOrg.id as string,
        name: tgtOrg.name as string,
        type: 'organization',
        slug: tgtOrg.slug as string,
        isCenter: false,
      })
    }

    edges.push({
      source: sourceId,
      target: targetId,
      label: rel.relationship_type as string,
      isCurrent: rel.is_current as boolean,
    })
  }

  const nodes = Array.from(nodeMap.values())

  if (nodes.length <= 1) {
    return (
      <div className="text-center py-12 text-white/30">
        <p>Not enough connections to render a constellation map.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <ConstellationGraph
        nodes={nodes}
        edges={edges}
        onNodeClick={(node) => {
          if (node.slug) {
            const path = node.type === 'person' ? `/person/${node.slug}` : `/org/${node.slug}`
            router.push(path)
          }
        }}
      />
      <ConstellationLegend />
    </div>
  )
}
