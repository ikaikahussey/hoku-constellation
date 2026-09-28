'use client'
import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { shapePath } from '@/components/graph/shapes'

interface Node extends d3.SimulationNodeDatum {
  id: string
  label: string
  group?: string
  score?: number
  kind?: string
}

interface Link extends d3.SimulationLinkDatum<Node> {
  type: string
  value: number
}

interface Props {
  nodes: Array<{ id: string; label: string; group?: string; score?: number; kind?: string }>
  links: Array<{ source: string; target: string; type: string; value: number }>
  width?: number
  height?: number
  onNodeClick?: (id: string) => void
}

const INK = 'var(--color-ink)'
const PAPER = 'var(--color-paper)'
const LINK = 'var(--color-link)'
const GRAY = 'var(--color-gray-400)'

/** Derived-edge network (ax_relationship_edge). Same visual grammar as components/graph/EntityGraph. */
export function NetworkGraph({ nodes, links, width = 800, height = 600, onNodeClick }: Props) {
  const ref = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const svg = d3.select(ref.current)
    svg.selectAll('*').remove()

    const simNodes: Node[] = nodes.map(n => ({ ...n }))
    const simLinks: Link[] = links.map(l => ({ ...l }))
    const endId = (end: string | Node | number) => (typeof end === 'object' ? end.id : String(end))

    const simulation = d3
      .forceSimulation<Node>(simNodes)
      .force('link', d3.forceLink<Node, Link>(simLinks).id(d => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(20))

    const link = svg
      .append('g')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', GRAY)
      .attr('stroke-width', d => Math.max(1, Math.sqrt(d.value)))

    const radius = (d: Node) => 4 + Math.sqrt(d.score ?? 1)
    const fill = (d: Node) => ((d.kind ?? 'person') === 'person' ? INK : PAPER)

    const node = svg
      .append('g')
      .selectAll<SVGPathElement, Node>('path')
      .data(simNodes)
      .join('path')
      .attr('d', d => shapePath(d.kind ?? 'person', radius(d)))
      .attr('fill', fill)
      .attr('stroke', INK)
      .attr('stroke-width', 1.25)
      .style('cursor', 'pointer')
      .on('mouseover', (_event, d) => {
        const touches = (l: Link) => endId(l.source) === d.id || endId(l.target) === d.id
        node.attr('stroke', n => (n.id === d.id ? LINK : INK)).attr('fill', n => (n.id === d.id && n.kind !== 'org' ? LINK : fill(n)))
        link.attr('stroke', l => (touches(l) ? LINK : GRAY))
      })
      .on('mouseout', () => {
        node.attr('stroke', INK).attr('fill', fill)
        link.attr('stroke', GRAY)
      })
      .on('click', (_event, d) => onNodeClick?.(d.id))
      .call(
        d3
          .drag<SVGPathElement, Node>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on('drag', (event, d) => {
            d.fx = event.x
            d.fy = event.y
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0)
            d.fx = null
            d.fy = null
          })
      )

    node.append('title').text(d => d.label)

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as Node).x ?? 0)
        .attr('y1', d => (d.source as Node).y ?? 0)
        .attr('x2', d => (d.target as Node).x ?? 0)
        .attr('y2', d => (d.target as Node).y ?? 0)
      node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => {
      simulation.stop()
    }
  }, [nodes, links, width, height, onNodeClick])

  return <svg ref={ref} width={width} height={height} role="img" aria-label="Network graph" className="bg-paper border border-rule" />
}

export default NetworkGraph
