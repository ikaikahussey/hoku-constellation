'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { shapePath, KIND_LABELS } from './shapes'

export interface GraphNode {
  id: string
  name: string
  kind: string
  slug: string | null
  isCenter?: boolean
}

export interface GraphEdge {
  source: string
  target: string
  label: string
  isCurrent: boolean
}

interface EntityGraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  onNodeClick?: (node: GraphNode) => void
  width?: number
  height?: number
}

interface SimNode extends d3.SimulationNodeDatum, GraphNode {}
interface SimLink extends d3.SimulationLinkDatum<SimNode> { label: string; isCurrent: boolean }

const INK = 'var(--color-ink)'
const PAPER = 'var(--color-paper)'
const LINK = 'var(--color-link)'
const GRAY = 'var(--color-gray-400)'
const MUTED = 'var(--color-muted)'

function endId(end: string | SimNode | number): string {
  return typeof end === 'object' ? end.id : String(end)
}

/**
 * D3 force graph. Person nodes are black circles; organizations white circles with a black
 * stroke; bills squares, dockets diamonds, parcels triangles, offices hexagons. Edges are gray;
 * the hovered node, its edges and its label turn red (link color), like links elsewhere.
 */
export function EntityGraph({ nodes, edges, onNodeClick, width: propWidth, height: propHeight }: EntityGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: propWidth || 800, height: propHeight || 500 })
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null)

  useEffect(() => {
    if (!containerRef.current || propWidth) return
    const observer = new ResizeObserver(entries => {
      const { width } = entries[0].contentRect
      if (width > 0) setDimensions({ width, height: propHeight || Math.max(320, Math.min(width * 0.625, 600)) })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [propWidth, propHeight])

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    const { width, height } = dimensions

    const simNodes: SimNode[] = nodes.map(n => ({ ...n }))
    const simLinks: SimLink[] = edges.map(e => ({ source: e.source, target: e.target, label: e.label, isCurrent: e.isCurrent }))
    const radius = (d: SimNode) => (d.isCenter ? 14 : 8)

    const simulation = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40))

    const link = svg.append('g')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', GRAY)
      .attr('stroke-width', d => (d.isCurrent ? 1.5 : 1))
      .attr('stroke-dasharray', d => (d.isCurrent ? null : '3 3'))

    const linkLabel = svg.append('g')
      .selectAll('text')
      .data(simLinks)
      .join('text')
      .text(d => d.label.replace(/_/g, ' '))
      .attr('fill', MUTED)
      .attr('font-size', '9px')
      .attr('text-anchor', 'middle')
      .attr('opacity', 0)

    const node = svg.append('g')
      .selectAll<SVGPathElement, SimNode>('path')
      .data(simNodes)
      .join('path')
      .attr('d', d => shapePath(d.kind, radius(d)))
      .attr('fill', d => (d.kind === 'person' ? INK : PAPER))
      .attr('stroke', INK)
      .attr('stroke-width', d => (d.isCenter ? 2 : 1.25))
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', d => `${d.name} (${KIND_LABELS[d.kind] ?? d.kind})`)
      .style('cursor', d => (d.slug || d.kind === 'bill' ? 'pointer' : 'default'))

    const label = svg.append('g')
      .selectAll('text')
      .data(simNodes)
      .join('text')
      .text(d => (d.name.length > 22 ? d.name.slice(0, 20) + '…' : d.name))
      .attr('fill', INK)
      .attr('font-size', d => (d.isCenter ? '12px' : '10px'))
      .attr('font-weight', d => (d.isCenter ? '700' : '400'))
      .attr('text-anchor', 'middle')
      .attr('dy', d => radius(d) + 14)

    function highlight(d: SimNode | null) {
      if (!d) {
        node.attr('stroke', INK).attr('fill', n => (n.kind === 'person' ? INK : PAPER)).attr('opacity', 1)
        link.attr('stroke', GRAY).attr('opacity', 1)
        label.attr('fill', INK).attr('opacity', 1)
        linkLabel.attr('opacity', 0)
        return
      }
      const connected = new Set<string>([d.id])
      simLinks.forEach(l => {
        const s = endId(l.source), t = endId(l.target)
        if (s === d.id) connected.add(t)
        if (t === d.id) connected.add(s)
      })
      const touches = (l: SimLink) => endId(l.source) === d.id || endId(l.target) === d.id
      node
        .attr('opacity', n => (connected.has(n.id) ? 1 : 0.25))
        .attr('stroke', n => (n.id === d.id ? LINK : INK))
        .attr('fill', n => (n.id === d.id ? (n.kind === 'person' ? LINK : PAPER) : n.kind === 'person' ? INK : PAPER))
      link.attr('stroke', l => (touches(l) ? LINK : GRAY)).attr('opacity', l => (touches(l) ? 1 : 0.2))
      label.attr('fill', n => (n.id === d.id ? LINK : INK)).attr('opacity', n => (connected.has(n.id) ? 1 : 0.25))
      linkLabel.attr('opacity', l => (touches(l) ? 1 : 0))
    }

    node
      .on('mouseover focus', function (event: MouseEvent | FocusEvent, d: SimNode) {
        highlight(d)
        const rect = svgRef.current?.getBoundingClientRect()
        const x = 'clientX' in event && rect ? event.clientX - rect.left : (d.x ?? 0)
        const y = 'clientY' in event && rect ? event.clientY - rect.top : (d.y ?? 0)
        setTooltip({ x, y, node: d })
      })
      .on('mouseout blur', () => {
        highlight(null)
        setTooltip(null)
      })
      .on('click', (_event: MouseEvent, d: SimNode) => onNodeClick?.(d))
      .on('keydown', (event: KeyboardEvent, d: SimNode) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onNodeClick?.(d)
        }
      })

    const drag = d3.drag<SVGPathElement, SimNode>()
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
    node.call(drag)

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as SimNode).x ?? 0)
        .attr('y1', d => (d.source as SimNode).y ?? 0)
        .attr('x2', d => (d.target as SimNode).x ?? 0)
        .attr('y2', d => (d.target as SimNode).y ?? 0)
      linkLabel
        .attr('x', d => (((d.source as SimNode).x ?? 0) + ((d.target as SimNode).x ?? 0)) / 2)
        .attr('y', d => (((d.source as SimNode).y ?? 0) + ((d.target as SimNode).y ?? 0)) / 2)
      node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
      label.attr('x', d => d.x ?? 0).attr('y', d => d.y ?? 0)
    })

    return () => { simulation.stop() }
  }, [nodes, edges, dimensions, onNodeClick])

  return (
    <div ref={containerRef} className="relative w-full">
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        role="img"
        aria-label="Relationship graph"
        className="bg-paper border border-rule w-full"
      />
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-paper border border-ink px-3 py-2 text-xs z-10"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <p className="font-bold">{tooltip.node.name}</p>
          <p className="text-muted">{KIND_LABELS[tooltip.node.kind] ?? tooltip.node.kind}</p>
        </div>
      )}
    </div>
  )
}
