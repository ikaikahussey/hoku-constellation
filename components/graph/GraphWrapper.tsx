'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { EntityGraph, type GraphNode, type GraphEdge } from './EntityGraph'
import { GraphLegend } from './GraphLegend'
import { entityHref } from '@/components/search/EntityCard'
import { track, EVENTS } from '@/lib/analytics-events'

/** Minimal, serializable slice of an EdgeWithEnds needed to draw the graph. */
export interface GraphEdgeInput {
  id: string
  type: string
  from_id: string | null
  to_id: string | null
  from_name: string | null
  to_name: string | null
  from_kind: string | null
  to_kind: string | null
  from_slug: string | null
  to_slug: string | null
  end_date: string | null
  is_current?: boolean
}

interface GraphWrapperProps {
  centerId: string
  centerName: string
  centerKind: string
  centerSlug: string | null
  edges: GraphEdgeInput[]
}

export function GraphWrapper({ centerId, centerName, centerKind, centerSlug, edges }: GraphWrapperProps) {
  const router = useRouter()

  useEffect(() => {
    track(EVENTS.NETWORK_GRAPH_OPENED, { entity_id: centerId })
  }, [centerId])

  const { nodes, graphEdges } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>()
    nodeMap.set(centerId, { id: centerId, name: centerName, kind: centerKind, slug: centerSlug, isCenter: true })
    const graphEdges: GraphEdge[] = []
    for (const e of edges) {
      if (!e.from_id || !e.to_id) continue
      if (!nodeMap.has(e.from_id)) nodeMap.set(e.from_id, { id: e.from_id, name: e.from_name ?? 'Unknown', kind: e.from_kind ?? 'org', slug: e.from_slug })
      if (!nodeMap.has(e.to_id)) nodeMap.set(e.to_id, { id: e.to_id, name: e.to_name ?? 'Unknown', kind: e.to_kind ?? 'org', slug: e.to_slug })
      // Callers pass is_current computed on the server; fall back to "no end date" to keep render pure.
      const isCurrent = e.is_current ?? !e.end_date
      graphEdges.push({ source: e.from_id, target: e.to_id, label: e.type, isCurrent })
    }
    return { nodes: [...nodeMap.values()], graphEdges }
  }, [centerId, centerName, centerKind, centerSlug, edges])

  const handleNodeClick = useCallback((node: GraphNode) => {
    track(EVENTS.NETWORK_GRAPH_NODE_CLICKED, { kind: node.kind })
    const href = entityHref(node.kind, node.slug, node.id)
    if (href) router.push(href)
  }, [router])

  if (nodes.length <= 1) {
    return <p className="text-sm text-muted py-12 text-center">Not enough connections to draw a graph.</p>
  }

  return (
    <div className="space-y-3">
      <EntityGraph nodes={nodes} edges={graphEdges} onNodeClick={handleNodeClick} />
      <GraphLegend />
    </div>
  )
}
