/** SVG path strings for entity-kind node shapes, centered on (0,0) with "radius" r. */
export function shapePath(kind: string | null | undefined, r: number): string {
  switch (kind) {
    case 'bill': // square
      return `M${-r},${-r}h${2 * r}v${2 * r}h${-2 * r}Z`
    case 'docket': // diamond
      return `M0,${-r}L${r},0L0,${r}L${-r},0Z`
    case 'parcel': { // triangle
      const h = r * 1.15
      return `M0,${-h}L${h},${h * 0.8}L${-h},${h * 0.8}Z`
    }
    case 'office': { // hexagon
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6
        return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`
      })
      return `M${pts.join('L')}Z`
    }
    default: { // circle (person, org)
      return `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`
    }
  }
}

export const KIND_LABELS: Record<string, string> = {
  person: 'Person',
  org: 'Organization',
  bill: 'Bill',
  docket: 'Docket',
  parcel: 'Parcel',
  office: 'Office',
}
