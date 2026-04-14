import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateCron } from '../../_lib/auth'
import {
  rebuildRelationshipEdges,
  buildAdjacency,
  betweennessCentrality,
  eigenvectorCentrality,
  detectCommunities,
} from '@/lib/analytics'
import type { GraphLink } from '@/lib/analytics'

export const maxDuration = 300

async function handle(request: NextRequest) {
  const unauth = authenticateCron(request)
  if (unauth) return unauth
  const supabase = createAdminClient()
  try {
    const { edges } = await rebuildRelationshipEdges(supabase)

    // Pull rebuilt edges and compute centrality in-memory
    const { data: rawEdges } = await supabase
      .from('ax_relationship_edge')
      .select('source_person_id, target_person_id, relationship_type, weight')

    const nodeIds = new Set<string>()
    const links: GraphLink[] = []
    for (const e of rawEdges ?? []) {
      nodeIds.add(e.source_person_id!)
      nodeIds.add(e.target_person_id!)
      links.push({
        source: e.source_person_id!,
        target: e.target_person_id!,
        type: e.relationship_type,
        value: Number(e.weight),
      })
    }
    const adj = buildAdjacency([...nodeIds], links)
    const between = betweennessCentrality(adj)
    const eigen = eigenvectorCentrality(adj)
    const communities = detectCommunities(adj)

    // Persist centrality back to ax_influence_score (0–100 scale)
    // Take max normalized value for scaling.
    const maxBetween = Math.max(...between.values(), 0) || 1
    const maxEigen = Math.max(...eigen.values(), 0) || 1
    for (const personId of nodeIds) {
      const b = ((between.get(personId) ?? 0) / maxBetween) * 100
      const ev = ((eigen.get(personId) ?? 0) / maxEigen) * 100
      const score = (b + ev) / 2
      await supabase
        .from('ax_influence_score')
        .upsert(
          { person_id: personId, network_centrality_score: Math.round(score * 10) / 10 },
          { onConflict: 'person_id' }
        )
    }

    // Snapshot
    const snapshot_date = new Date().toISOString().slice(0, 10)
    const clusterCount = new Set(communities.values()).size
    await supabase.from('ax_graph_snapshot').upsert(
      {
        snapshot_date,
        node_count: nodeIds.size,
        edge_count: edges,
        graph_data: { nodes: nodeIds.size, edges },
        metrics: { cluster_count: clusterCount },
      },
      { onConflict: 'snapshot_date' }
    )

    return NextResponse.json({ ok: true, edges, nodes: nodeIds.size, clusters: clusterCount })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
