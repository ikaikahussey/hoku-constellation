'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

interface ConstellationNode {
  id: string
  name: string
  type: 'person' | 'organization'
  slug: string | null
  isCenter?: boolean
}

interface ConstellationEdge {
  source: string
  target: string
  label: string
  isCurrent: boolean
}

interface ConstellationGraphProps {
  nodes: ConstellationNode[]
  edges: ConstellationEdge[]
  onNodeClick?: (node: ConstellationNode) => void
  width?: number
  height?: number
}

export function ConstellationGraph({
  nodes,
  edges,
  onNodeClick,
  width: propWidth,
  height: propHeight,
}: ConstellationGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: propWidth || 800, height: propHeight || 500 })
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: ConstellationNode } | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect
      setDimensions({ width, height: Math.min(width * 0.625, 600) })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const { width, height } = dimensions

    // Create simulation
    interface SimNode extends d3.SimulationNodeDatum {
      id: string
      name: string
      type: 'person' | 'organization'
      slug: string | null
      isCenter?: boolean
    }

    interface SimLink extends d3.SimulationLinkDatum<SimNode> {
      label: string
      isCurrent: boolean
    }

    const simNodes: SimNode[] = nodes.map(n => ({ ...n }))
    const simLinks: SimLink[] = edges.map(e => ({ source: e.source, target: e.target, label: e.label, isCurrent: e.isCurrent }))

    const simulation = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40))

    // Draw edges
    const link = svg.append('g')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', d => d.isCurrent ? 'rgba(212, 168, 67, 0.3)' : 'rgba(255, 255, 255, 0.08)')
      .attr('stroke-width', d => d.isCurrent ? 1.5 : 1)

    // Draw edge labels
    const linkLabel = svg.append('g')
      .selectAll('text')
      .data(simLinks)
      .join('text')
      .text(d => d.label.replace(/_/g, ' '))
      .attr('fill', 'rgba(255, 255, 255, 0.2)')
      .attr('font-size', '9px')
      .attr('text-anchor', 'middle')

    // Draw nodes
    const node = svg.append('g')
      .selectAll<SVGCircleElement, SimNode>('circle')
      .data(simNodes)
      .join('circle')
      .attr('r', d => d.isCenter ? 14 : 8)
      .attr('fill', d => d.type === 'person' ? '#D4A843' : '#0E4D6B')
      .attr('stroke', d => d.isCenter ? '#E8C878' : 'rgba(255, 255, 255, 0.1)')
      .attr('stroke-width', d => d.isCenter ? 2 : 1)
      .style('cursor', 'pointer')

    // Node labels
    const label = svg.append('g')
      .selectAll('text')
      .data(simNodes)
      .join('text')
      .text(d => d.name.length > 20 ? d.name.slice(0, 18) + '...' : d.name)
      .attr('fill', d => d.isCenter ? '#FFFFFF' : 'rgba(255, 255, 255, 0.6)')
      .attr('font-size', d => d.isCenter ? '12px' : '10px')
      .attr('font-weight', d => d.isCenter ? '600' : '400')
      .attr('text-anchor', 'middle')
      .attr('dy', d => (d.isCenter ? 14 : 8) + 14)

    // Interactions
    node
      .on('mouseover', function (event, d) {
        d3.select(this).attr('r', d.isCenter ? 16 : 10)
        setTooltip({ x: event.offsetX, y: event.offsetY, node: d })

        // Highlight connected
        const connected = new Set<string>()
        simLinks.forEach(l => {
          const sid = String(typeof l.source === 'object' ? (l.source as SimNode).id : l.source)
          const tid = String(typeof l.target === 'object' ? (l.target as SimNode).id : l.target)
          if (sid === d.id) connected.add(tid)
          if (tid === d.id) connected.add(sid)
        })
        connected.add(d.id)

        node.attr('opacity', n => connected.has(n.id) ? 1 : 0.2)
        link.attr('opacity', l => {
          const sid = typeof l.source === 'object' ? (l.source as SimNode).id : l.source
          const tid = typeof l.target === 'object' ? (l.target as SimNode).id : l.target
          return sid === d.id || tid === d.id ? 1 : 0.05
        })
        label.attr('opacity', n => connected.has(n.id) ? 1 : 0.1)
        linkLabel.attr('opacity', l => {
          const sid = typeof l.source === 'object' ? (l.source as SimNode).id : l.source
          const tid = typeof l.target === 'object' ? (l.target as SimNode).id : l.target
          return sid === d.id || tid === d.id ? 1 : 0
        })
      })
      .on('mouseout', function (_, d) {
        d3.select(this).attr('r', d.isCenter ? 14 : 8)
        setTooltip(null)
        node.attr('opacity', 1)
        link.attr('opacity', 1)
        label.attr('opacity', 1)
        linkLabel.attr('opacity', 0.5)
      })
      .on('click', (_, d) => {
        if (onNodeClick) onNodeClick(d)
      })

    // Drag behavior
    const drag = d3.drag<SVGCircleElement, SimNode>()
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

    // Tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as SimNode).x!)
        .attr('y1', d => (d.source as SimNode).y!)
        .attr('x2', d => (d.target as SimNode).x!)
        .attr('y2', d => (d.target as SimNode).y!)

      linkLabel
        .attr('x', d => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
        .attr('y', d => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2)

      node
        .attr('cx', d => d.x!)
        .attr('cy', d => d.y!)

      label
        .attr('x', d => d.x!)
        .attr('y', d => d.y!)
    })

    return () => { simulation.stop() }
  }, [nodes, edges, dimensions, onNodeClick])

  return (
    <div ref={containerRef} className="relative w-full">
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="bg-navy rounded-lg border border-white/10"
      />
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-navy-light border border-white/20 rounded-md px-3 py-2 text-xs z-10"
          style={{ left: tooltip.x + 10, top: tooltip.y - 10 }}
        >
          <p className="font-medium text-white">{tooltip.node.name}</p>
          <p className="text-white/40">{tooltip.node.type === 'person' ? 'Person' : 'Organization'}</p>
        </div>
      )}
    </div>
  )
}
