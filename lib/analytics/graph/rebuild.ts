/**
 * Full graph rebuild: derive ax_relationship_edge, compute centralities + communities, persist
 * network_centrality_score and a daily ax_graph_snapshot. Shared by the cron route and the worker.
 */
import type { Db } from '@/lib/db/types'
import { rebuildRelationshipEdges } from './builder'
import { buildAdjacency, betweennessCentrality, eigenvectorCentrality } from './centrality'
import { detectCommunities } from './clusters'
import type { GraphLink } from '../types'

export async function rebuildGraph(db: Db): Promise<{ edges: number; nodes: number; clusters: number }> {
  const { edges } = await rebuildRelationshipEdges(db)
  const raw = await db.many<{ source_entity_id: string; target_entity_id: string; relationship_type: string; weight: string }>(
    `select source_entity_id, target_entity_id, relationship_type, weight::text from ax_relationship_edge`)
  const nodeIds = new Set<string>()
  const links: GraphLink[] = []
  for (const e of raw) {
    nodeIds.add(e.source_entity_id); nodeIds.add(e.target_entity_id)
    links.push({ source: e.source_entity_id, target: e.target_entity_id, type: e.relationship_type, value: Number(e.weight) })
  }
  const adj = buildAdjacency([...nodeIds], links)
  const between = betweennessCentrality(adj)
  const eigen = eigenvectorCentrality(adj)
  const communities = detectCommunities(adj)

  const maxBetween = Math.max(...between.values(), 0) || 1
  const maxEigen = Math.max(...eigen.values(), 0) || 1
  const ids = [...nodeIds]
  const scores = ids.map(id => {
    const b = ((between.get(id) ?? 0) / maxBetween) * 100
    const ev = ((eigen.get(id) ?? 0) / maxEigen) * 100
    return Math.round(((b + ev) / 2) * 10) / 10
  })
  for (let i = 0; i < ids.length; i += 1000) {
    await db.query(
      `insert into ax_influence_score(entity_id, network_centrality_score)
       select * from unnest($1::uuid[], $2::numeric[])
       on conflict (entity_id) do update set network_centrality_score = excluded.network_centrality_score`,
      [ids.slice(i, i + 1000), scores.slice(i, i + 1000)])
  }

  const clusterCount = new Set(communities.values()).size
  await db.query(
    `insert into ax_graph_snapshot(snapshot_date, node_count, edge_count, graph_data, metrics)
     values (current_date, $1, $2, $3, $4)
     on conflict (snapshot_date) do update set node_count = excluded.node_count, edge_count = excluded.edge_count,
       graph_data = excluded.graph_data, metrics = excluded.metrics`,
    [nodeIds.size, edges, JSON.stringify({ nodes: nodeIds.size, edges }), JSON.stringify({ cluster_count: clusterCount })])
  return { edges, nodes: nodeIds.size, clusters: clusterCount }
}
