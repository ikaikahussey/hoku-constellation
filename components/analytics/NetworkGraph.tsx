'use client'
import { useEffect, useRef } from 'react'
import * as d3 from 'd3'

interface Node extends d3.SimulationNodeDatum {
  id: string
  label: string
  group?: string
  score?: number
}

interface Link extends d3.SimulationLinkDatum<Node> {
  type: string
  value: number
}

interface Props {
  nodes: Array<{ id: string; label: string; group?: string; score?: number }>
  links: Array<{ source: string; target: string; type: string; value: number }>
  width?: number
  height?: number
  onNodeClick?: (id: string) => void
}

export function NetworkGraph({ nodes, links, width = 800, height = 600, onNodeClick }: Props) {
  const ref = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const svg = d3.select(ref.current)
    svg.selectAll('*').remove()

    const simNodes: Node[] = nodes.map(n => ({ ...n }))
    const simLinks: Link[] = links.map(l => ({ ...l }))

    const simulation = d3
      .forceSimulation<Node>(simNodes)
      .force('link', d3.forceLink<Node, Link>(simLinks).id(d => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(20))

    const link = svg
      .append('g')
      .attr('stroke', '#999')
      .attr('stroke-opacity', 0.5)
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke-width', d => Math.max(1, Math.sqrt(d.value)))

    const color = d3.scaleOrdinal(d3.schemeCategory10)

    const node = svg
      .append('g')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .selectAll<SVGCircleElement, Node>('circle')
      .data(simNodes)
      .join('circle')
      .attr('r', d => 4 + Math.sqrt(d.score ?? 1))
      .attr('fill', d => color(d.group ?? 'default'))
      .style('cursor', 'pointer')
      .on('click', (_event, d) => onNodeClick?.(d.id))
      .call(
        d3
          .drag<SVGCircleElement, Node>()
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
      node.attr('cx', d => d.x ?? 0).attr('cy', d => d.y ?? 0)
    })

    return () => {
      simulation.stop()
    }
  }, [nodes, links, width, height, onNodeClick])

  return <svg ref={ref} width={width} height={height} />
}

export default NetworkGraph
