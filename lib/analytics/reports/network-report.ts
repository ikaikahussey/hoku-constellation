import type { Db } from '@/lib/db/types'
import type { GraphLink, GraphNode } from '../types'

/**
 * Ego network: all derived edges within `hops` of an entity. Returns {nodes, links} for toD3Format.
 */
export async function getEgoNetwork(db: Db, entityId: string, hops = 2): Promise<{ nodes: GraphNode[]; links: GraphLink[] }> {
  const allEdges = await db.many<{ source_entity_id: string; target_entity_id: string; relationship_type: string; weight: string }>(
    `select source_entity_id, target_entity_id, relationship_type, weight::text from ax_relationship_edge`)
  const adj = new Map<string, Array<{ to: string; type: string; weight: number }>>()
  for (const e of allEdges) {
    const s = e.source_entity_id, t = e.target_entity_id
    if (!adj.has(s)) adj.set(s, [])
    if (!adj.has(t)) adj.set(t, [])
    adj.get(s)!.push({ to: t, type: e.relationship_type, weight: Number(e.weight) })
    adj.get(t)!.push({ to: s, type: e.relationship_type, weight: Number(e.weight) })
  }

  const visited = new Set<string>([entityId])
  const queue: Array<{ id: string; depth: number }> = [{ id: entityId, depth: 0 }]
  const links: GraphLink[] = []
  const seen = new Set<string>()
  while (queue.length) {
    const { id, depth } = queue.shift()!
    if (depth >= hops) continue
    for (const e of adj.get(id) ?? []) {
      const key = id < e.to ? `${id}|${e.to}|${e.type}` : `${e.to}|${id}|${e.type}`
      if (!seen.has(key)) { links.push({ source: id, target: e.to, type: e.type, value: e.weight }); seen.add(key) }
      if (!visited.has(e.to)) { visited.add(e.to); queue.push({ id: e.to, depth: depth + 1 }) }
    }
  }

  const ids = [...visited]
  const [entities, scores] = await Promise.all([
    db.many<{ id: string; name: string; kind: GraphNode['kind']; island: string | null }>(
      `select id, name, kind, attributes ->> 'island' island from entity where id = any($1::uuid[])`, [ids]),
    db.many<{ entity_id: string; composite_score: string }>(`select entity_id, composite_score::text from ax_influence_score where entity_id = any($1::uuid[])`, [ids]),
  ])
  const scoreMap = new Map(scores.map(s => [s.entity_id, Number(s.composite_score)]))
  const nodes: GraphNode[] = entities.map(p => ({
    id: p.id, label: p.name, group: p.island ?? 'default', score: scoreMap.get(p.id) ?? 0, kind: p.kind,
    entity_type: p.kind === 'org' ? 'organization' : 'person',
  }))
  return { nodes, links }
}
