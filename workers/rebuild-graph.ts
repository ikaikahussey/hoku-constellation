import { createAdminClient } from './lib/supabase'
import { log, logError } from './lib/logger'
import {
  rebuildRelationshipEdges,
  buildAdjacency,
  betweennessCentrality,
  eigenvectorCentrality,
  detectCommunities,
} from '@/lib/analytics'
import type { GraphLink } from '@/lib/analytics'

async function main() {
  const supabase = createAdminClient()
  log('Rebuild graph starting')

  try {
    const { edges } = await rebuildRelationshipEdges(supabase)
    log(`Rebuilt ${edges} edges`)

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

    log(`Computing centrality across ${nodeIds.size} nodes`)
    const adj = buildAdjacency([...nodeIds], links)
    const between = betweennessCentrality(adj)
    const eigen = eigenvectorCentrality(adj)
    const communities = detectCommunities(adj)

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

    log(`Rebuild graph complete: edges=${edges}, nodes=${nodeIds.size}, clusters=${clusterCount}`)
  } catch (e) {
    logError('Rebuild graph failed', e)
    throw e
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1))
