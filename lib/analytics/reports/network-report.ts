import type { SupabaseClient } from '@supabase/supabase-js'
import type { GraphLink, GraphNode } from '../types'

/**
 * Ego network: all edges within `hops` of the given person.
 * Returns {nodes, links} ready to feed into toD3Format.
 */
export async function getEgoNetwork(
  supabase: SupabaseClient,
  personId: string,
  hops = 2
): Promise<{ nodes: GraphNode[]; links: GraphLink[] }> {
  const { data: allEdges } = await supabase
    .from('ax_relationship_edge')
    .select('source_person_id, target_person_id, relationship_type, weight')

  const adj = new Map<string, Array<{ to: string; type: string; weight: number }>>()
  for (const e of allEdges ?? []) {
    const s = e.source_person_id!, t = e.target_person_id!
    if (!adj.has(s)) adj.set(s, [])
    if (!adj.has(t)) adj.set(t, [])
    adj.get(s)!.push({ to: t, type: e.relationship_type, weight: Number(e.weight) })
    adj.get(t)!.push({ to: s, type: e.relationship_type, weight: Number(e.weight) })
  }

  // BFS out to `hops`
  const visited = new Set<string>([personId])
  const queue: Array<{ id: string; depth: number }> = [{ id: personId, depth: 0 }]
  const links: GraphLink[] = []
  const seenLinks = new Set<string>()
  while (queue.length) {
    const { id, depth } = queue.shift()!
    if (depth >= hops) continue
    for (const e of adj.get(id) ?? []) {
      const key = id < e.to ? `${id}|${e.to}|${e.type}` : `${e.to}|${id}|${e.type}`
      if (!seenLinks.has(key)) {
        links.push({ source: id, target: e.to, type: e.type, value: e.weight })
        seenLinks.add(key)
      }
      if (!visited.has(e.to)) {
        visited.add(e.to)
        queue.push({ id: e.to, depth: depth + 1 })
      }
    }
  }

  // Resolve node labels + scores
  const ids = [...visited]
  const [{ data: persons }, { data: scores }] = await Promise.all([
    supabase.from('person').select('id, full_name, office_held, island').in('id', ids),
    supabase.from('ax_influence_score').select('person_id, composite_score').in('person_id', ids),
  ])
  const scoreMap = new Map((scores ?? []).map(s => [s.person_id, Number(s.composite_score)]))
  const nodes: GraphNode[] = (persons ?? []).map(p => ({
    id: p.id,
    label: p.full_name,
    group: (p.island as string) ?? 'default',
    score: scoreMap.get(p.id) ?? 0,
    entity_type: 'person',
  }))

  return { nodes, links }
}
