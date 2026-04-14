import type { GraphLink, GraphNode } from '../types'

export function toD3Format(nodes: GraphNode[], links: GraphLink[]) {
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      label: n.label,
      group: n.group ?? 'default',
      score: n.score ?? 0,
      entity_type: n.entity_type ?? 'person',
    })),
    links: links.map(l => ({
      source: String(l.source),
      target: String(l.target),
      type: l.type,
      value: l.value,
    })),
  }
}
