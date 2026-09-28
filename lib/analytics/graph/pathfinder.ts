/**
 * Shortest-path finder over ax_relationship_edge. BFS, max 3 hops.
 */
import type { Db } from '@/lib/db/types'
import type { GraphLink } from '../types'

export interface PathResult {
  path: string[]
  links: GraphLink[]
  narrative: string
  names: Record<string, string>
}

export async function findShortestPath(db: Db, idA: string, idB: string, maxHops = 3): Promise<PathResult | null> {
  if (idA === idB) return { path: [idA], links: [], narrative: 'same entity', names: {} }

  const edges = await db.many<{ source_entity_id: string; target_entity_id: string; relationship_type: string; weight: string }>(
    `select source_entity_id, target_entity_id, relationship_type, weight::text from ax_relationship_edge`)
  const adj = new Map<string, Array<{ to: string; type: string; weight: number }>>()
  for (const e of edges) {
    const s = e.source_entity_id, t = e.target_entity_id
    if (!adj.has(s)) adj.set(s, [])
    if (!adj.has(t)) adj.set(t, [])
    adj.get(s)!.push({ to: t, type: e.relationship_type, weight: Number(e.weight) })
    adj.get(t)!.push({ to: s, type: e.relationship_type, weight: Number(e.weight) })
  }

  const prev = new Map<string, { from: string; type: string; weight: number }>()
  const visited = new Set<string>([idA])
  const queue: Array<{ id: string; hops: number }> = [{ id: idA, hops: 0 }]
  let found = false
  while (queue.length && !found) {
    const { id, hops } = queue.shift()!
    if (hops >= maxHops) continue
    for (const e of adj.get(id) ?? []) {
      if (visited.has(e.to)) continue
      visited.add(e.to)
      prev.set(e.to, { from: id, type: e.type, weight: e.weight })
      if (e.to === idB) { found = true; break }
      queue.push({ id: e.to, hops: hops + 1 })
    }
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
  const rows = await db.many<{ id: string; name: string }>(`select id, name from entity where id = any($1::uuid[])`, [path])
  const names = Object.fromEntries(rows.map(r => [r.id, r.name]))
  const narrative = links.map(l => `${names[l.source] ?? l.source} → (${l.type}) → ${names[l.target] ?? l.target}`).join('; ')
  return { path, links, narrative, names }
}
