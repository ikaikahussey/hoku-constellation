/**
 * Shortest-path finder over ax_relationship_edge. BFS, max 3 hops.
 * Returns a human-readable narrative of the chain.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GraphLink } from '../types'

export interface PathResult {
  path: string[]
  links: GraphLink[]
  narrative: string
}

export async function findShortestPath(
  supabase: SupabaseClient,
  idA: string,
  idB: string,
  maxHops = 3
): Promise<PathResult | null> {
  if (idA === idB) return { path: [idA], links: [], narrative: 'same entity' }

  // Load all edges into memory — HI-scale is small.
  const { data: edges } = await supabase
    .from('ax_relationship_edge')
    .select('source_person_id, target_person_id, relationship_type, weight')
  const adj = new Map<string, Array<{ to: string; type: string; weight: number }>>()
  for (const e of edges ?? []) {
    const s = e.source_person_id!, t = e.target_person_id!
    if (!adj.has(s)) adj.set(s, [])
    if (!adj.has(t)) adj.set(t, [])
    adj.get(s)!.push({ to: t, type: e.relationship_type, weight: Number(e.weight) })
    adj.get(t)!.push({ to: s, type: e.relationship_type, weight: Number(e.weight) })
  }

  // BFS with hop limit
  const prev = new Map<string, { from: string; type: string; weight: number }>()
  const visited = new Set<string>([idA])
  const queue: Array<{ id: string; hops: number }> = [{ id: idA, hops: 0 }]
  let found = false
  while (queue.length) {
    const { id, hops } = queue.shift()!
    if (hops >= maxHops) continue
    for (const e of adj.get(id) ?? []) {
      if (visited.has(e.to)) continue
      visited.add(e.to)
      prev.set(e.to, { from: id, type: e.type, weight: e.weight })
      if (e.to === idB) { found = true; break }
      queue.push({ id: e.to, hops: hops + 1 })
    }
    if (found) break
  }

  if (!found) return null

  const path: string[] = [idB]
  const links: GraphLink[] = []
  let cur = idB
  while (cur !== idA) {
    const p = prev.get(cur)!
    links.unshift({ source: p.from, target: cur, type: p.type, value: p.weight })
    path.unshift(p.from)
    cur = p.from
  }

  // Resolve names for narrative
  const { data: persons } = await supabase.from('person').select('id, full_name').in('id', path)
  const names = new Map((persons ?? []).map(p => [p.id, p.full_name as string]))
  const narrative = links
    .map(l => `${names.get(String(l.source)) ?? l.source} → (${l.type}) → ${names.get(String(l.target)) ?? l.target}`)
    .join('; ')

  return { path, links, narrative }
}
