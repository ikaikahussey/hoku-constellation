/**
 * Pure-TS centrality algorithms. No external deps.
 * - betweenness(): Brandes' algorithm, unweighted.
 * - eigenvector(): power iteration.
 * - degree(): simple neighbor count.
 *
 * Input graph representation is an adjacency map built from GraphLink[].
 */
import type { GraphLink } from '../types'

export type AdjMap = Map<string, Set<string>>

export function buildAdjacency(nodeIds: string[], links: GraphLink[]): AdjMap {
  const adj: AdjMap = new Map()
  for (const n of nodeIds) adj.set(n, new Set())
  for (const l of links) {
    const s = String(l.source), t = String(l.target)
    if (!adj.has(s) || !adj.has(t)) continue
    adj.get(s)!.add(t)
    adj.get(t)!.add(s)
  }
  return adj
}

export function degreeCentrality(adj: AdjMap): Map<string, number> {
  const out = new Map<string, number>()
  const n = adj.size
  for (const [id, neigh] of adj) {
    out.set(id, n > 1 ? neigh.size / (n - 1) : 0)
  }
  return out
}

/**
 * Brandes' betweenness (unweighted). O(V·E). Fine for HI-scale (~5–20k nodes).
 * Returns normalized betweenness in [0, 1].
 */
export function betweennessCentrality(adj: AdjMap): Map<string, number> {
  const nodes = [...adj.keys()]
  const cb = new Map<string, number>()
  for (const n of nodes) cb.set(n, 0)

  for (const s of nodes) {
    const S: string[] = []
    const P = new Map<string, string[]>()
    const sigma = new Map<string, number>()
    const d = new Map<string, number>()
    for (const v of nodes) { P.set(v, []); sigma.set(v, 0); d.set(v, -1) }
    sigma.set(s, 1); d.set(s, 0)
    const Q: string[] = [s]
    while (Q.length) {
      const v = Q.shift()!
      S.push(v)
      for (const w of adj.get(v) ?? []) {
        if ((d.get(w) ?? -1) < 0) {
          Q.push(w)
          d.set(w, (d.get(v) ?? 0) + 1)
        }
        if ((d.get(w) ?? -1) === (d.get(v) ?? 0) + 1) {
          sigma.set(w, (sigma.get(w) ?? 0) + (sigma.get(v) ?? 0))
          P.get(w)!.push(v)
        }
      }
    }
    const delta = new Map<string, number>()
    for (const v of nodes) delta.set(v, 0)
    while (S.length) {
      const w = S.pop()!
      for (const v of P.get(w) ?? []) {
        const ratio = (sigma.get(v) ?? 0) / (sigma.get(w) ?? 1)
        delta.set(v, (delta.get(v) ?? 0) + ratio * (1 + (delta.get(w) ?? 0)))
      }
      if (w !== s) cb.set(w, (cb.get(w) ?? 0) + (delta.get(w) ?? 0))
    }
  }
  // Normalize: divide by (n-1)(n-2) for undirected
  const n = nodes.length
  const norm = n > 2 ? 2 / ((n - 1) * (n - 2)) : 0
  for (const k of cb.keys()) cb.set(k, (cb.get(k) ?? 0) * norm)
  return cb
}

/** Power iteration for eigenvector centrality. Deterministic start vector. */
export function eigenvectorCentrality(adj: AdjMap, iterations = 50, tol = 1e-6): Map<string, number> {
  const nodes = [...adj.keys()]
  let x = new Map<string, number>()
  for (const n of nodes) x.set(n, 1 / nodes.length)
  for (let iter = 0; iter < iterations; iter++) {
    const y = new Map<string, number>()
    for (const n of nodes) y.set(n, 0)
    for (const n of nodes) {
      for (const m of adj.get(n) ?? []) {
        y.set(n, (y.get(n) ?? 0) + (x.get(m) ?? 0))
      }
    }
    let norm = 0
    for (const v of y.values()) norm += v * v
    norm = Math.sqrt(norm) || 1
    let diff = 0
    for (const n of nodes) {
      const nv = (y.get(n) ?? 0) / norm
      diff += Math.abs(nv - (x.get(n) ?? 0))
      y.set(n, nv)
    }
    x = y
    if (diff < tol) break
  }
  return x
}
