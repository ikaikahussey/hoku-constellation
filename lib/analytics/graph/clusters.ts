/**
 * Deterministic Louvain community detection, pure TS.
 * Small-graph implementation; use for the HI power map graph.
 */
import type { AdjMap } from './centrality'

/** Simple label-propagation-style clustering with deterministic tie-breaking. */
export function detectCommunities(adj: AdjMap, iterations = 20): Map<string, number> {
  const nodes = [...adj.keys()].sort()
  const community = new Map<string, number>()
  nodes.forEach((n, i) => community.set(n, i))

  for (let iter = 0; iter < iterations; iter++) {
    let changed = false
    for (const n of nodes) {
      const counts = new Map<number, number>()
      for (const m of adj.get(n) ?? []) {
        const c = community.get(m)!
        counts.set(c, (counts.get(c) ?? 0) + 1)
      }
      if (counts.size === 0) continue
      // Pick most-frequent neighbor community; deterministic tiebreak by lowest community id.
      let best = community.get(n)!
      let bestCount = -1
      for (const [c, cnt] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
        if (cnt > bestCount) { best = c; bestCount = cnt }
      }
      if (best !== community.get(n)) {
        community.set(n, best)
        changed = true
      }
    }
    if (!changed) break
  }

  // Normalize community ids to 0..k-1
  const remap = new Map<number, number>()
  let next = 0
  for (const id of [...community.values()]) {
    if (!remap.has(id)) remap.set(id, next++)
  }
  for (const [node, c] of community) community.set(node, remap.get(c)!)
  return community
}
