import type { Db, InfluenceScoreRow } from '@/lib/db/types'

export type Dimension =
  | 'composite' | 'political_money' | 'institutional_position' | 'lobbying'
  | 'economic_footprint' | 'network_centrality' | 'public_visibility'

const COLUMN: Record<Dimension, string> = {
  composite: 'composite_score',
  political_money: 'political_money_score',
  institutional_position: 'institutional_position_score',
  lobbying: 'lobbying_score',
  economic_footprint: 'economic_footprint_score',
  network_centrality: 'network_centrality_score',
  public_visibility: 'public_visibility_score',
}

export interface PowerMapRow extends InfluenceScoreRow {
  person: { id: string; full_name: string; slug: string | null; office_held: string | null; island: string | null; entity_types: string[]; photo_url: string | null }
}

export async function getPowerMap(db: Db, opts: { dimension?: Dimension; limit?: number; island?: string; entity_type?: string } = {}): Promise<PowerMapRow[]> {
  const dim = opts.dimension ?? 'composite'
  const col = COLUMN[dim] ?? COLUMN.composite
  const params: unknown[] = []
  const where: string[] = [`e.kind = 'person'`]
  if (opts.island) { params.push(opts.island); where.push(`e.attributes ->> 'island' = $${params.length}`) }
  if (opts.entity_type) { params.push(opts.entity_type); where.push(`(e.attributes -> 'entity_types') ? $${params.length}`) }
  params.push(Math.min(opts.limit ?? 50, 500))
  const rows = await db.many<InfluenceScoreRow & { id: string; name: string; attributes: Record<string, unknown> }>(
    `select s.*, e.id, e.name, e.attributes from ax_influence_score s join entity e on e.id = s.entity_id
      where ${where.join(' and ')} order by s.${col} desc limit $${params.length}`, params)
  return rows.map(({ id, name, attributes, ...score }) => ({
    ...score,
    person: {
      id, full_name: name,
      slug: (attributes.slug as string) ?? null,
      office_held: (attributes.office_held as string) ?? null,
      island: (attributes.island as string) ?? null,
      entity_types: (attributes.entity_types as string[]) ?? [],
      photo_url: (attributes.photo_url as string) ?? null,
    },
  }))
}
