import type { Db, EntityRow } from '../types'

export async function getEntity(db: Db, id: string): Promise<EntityRow | null> {
  const row = await db.one<EntityRow>(`select * from entity where id = $1`, [id])
  if (row?.merged_into_id) return getEntity(db, row.merged_into_id)
  return row
}

export async function getEntityBySlug(db: Db, kind: EntityRow['kind'], slug: string): Promise<EntityRow | null> {
  const row = await db.one<EntityRow>(
    `select * from entity where kind = $1 and attributes ->> 'slug' = $2 limit 1`, [kind, slug])
  if (row?.merged_into_id) return getEntity(db, row.merged_into_id)
  return row
}

export async function getEntitiesByIds(db: Db, ids: string[]): Promise<Map<string, EntityRow>> {
  if (!ids.length) return new Map()
  const rows = await db.many<EntityRow>(`select * from entity where id = any($1::uuid[])`, [ids])
  return new Map(rows.map(r => [r.id, r]))
}

export interface ListEntitiesOptions {
  kind?: EntityRow['kind'] | EntityRow['kind'][]
  q?: string
  featured?: boolean
  status?: string | string[]
  /** attributes.entity_types overlaps any of these values */
  entityTypes?: string[]
  /** attributes.entity_types must overlap every one of these lists (AND of ORs) */
  tagClauses?: string[][]
  /** person.attributes.office_held ILIKE any of these patterns */
  officeHeldLike?: string[]
  /** org.attributes.sector matches any of these, compared case-insensitively with spaces/hyphens folded to underscores */
  sector?: string | string[]
  /** org.attributes.org_type matches any of these, folded like `sector` */
  orgType?: string[]
  /** attributes.island equals any of these values (case-insensitive) */
  island?: string[]
  limit?: number
  offset?: number
  orderBy?: 'updated_at' | 'name' | 'created_at'
}

/** `Real Estate` / `real-estate` / `real_estate` → `real_estate` */
export function foldToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function buildWhere(opts: ListEntitiesOptions): { where: string; params: unknown[] } {
  const where: string[] = ['merged_into_id is null']
  const params: unknown[] = []
  if (opts.kind) {
    const kinds = Array.isArray(opts.kind) ? opts.kind : [opts.kind]
    params.push(kinds); where.push(`kind = any($${params.length}::text[])`)
  }
  if (opts.q) { params.push(`%${opts.q}%`); where.push(`(name ilike $${params.length} or exists (select 1 from unnest(aliases) a where a ilike $${params.length}))`) }
  if (opts.featured !== undefined) { params.push(opts.featured); where.push(`coalesce((attributes ->> 'is_featured')::boolean, false) = $${params.length}`) }
  if (opts.status && opts.status.length) {
    params.push((Array.isArray(opts.status) ? opts.status : [opts.status]).map(s => s.toLowerCase()))
    where.push(`lower(attributes ->> 'status') = any($${params.length}::text[])`)
  }
  if (opts.entityTypes?.length) { params.push(opts.entityTypes); where.push(`(attributes -> 'entity_types') ?| $${params.length}::text[]`) }
  for (const clause of opts.tagClauses ?? []) {
    params.push(clause); where.push(`(attributes -> 'entity_types') ?| $${params.length}::text[]`)
  }
  if (opts.officeHeldLike?.length) { params.push(opts.officeHeldLike); where.push(`(attributes ->> 'office_held') ilike any($${params.length}::text[])`) }
  if (opts.sector) {
    const sectors = (Array.isArray(opts.sector) ? opts.sector : [opts.sector]).map(foldToken)
    params.push(sectors); where.push(`lower(regexp_replace(attributes ->> 'sector', '[\\s-]+', '_', 'g')) = any($${params.length}::text[])`)
  }
  if (opts.orgType?.length) {
    params.push(opts.orgType.map(foldToken)); where.push(`lower(regexp_replace(attributes ->> 'org_type', '[\\s-]+', '_', 'g')) = any($${params.length}::text[])`)
  }
  if (opts.island?.length) { params.push(opts.island.map(i => i.toLowerCase())); where.push(`lower(attributes ->> 'island') = any($${params.length}::text[])`) }
  return { where: where.join(' and '), params }
}

export type EntityFacet = 'entity_types' | 'org_type' | 'sector' | 'island' | 'status'

/**
 * Value counts for one attribute across the entities matching `opts`. Text attributes are folded
 * (`foldToken`), `island` is lower-cased, and `entity_types` is unnested.
 */
export async function entityFacetCounts(db: Db, facet: EntityFacet, opts: ListEntitiesOptions = {}): Promise<Map<string, number>> {
  const { where, params } = buildWhere(opts)
  const sql = facet === 'entity_types'
    ? `select t as v, count(*)::text n from entity,
         jsonb_array_elements_text(case when jsonb_typeof(attributes -> 'entity_types') = 'array' then attributes -> 'entity_types' else '[]'::jsonb end) t
       where ${where} group by t`
    : facet === 'island'
      ? `select lower(trim(attributes ->> 'island')) v, count(*)::text n from entity where ${where} and coalesce(trim(attributes ->> 'island'), '') <> '' group by 1`
      : `select lower(regexp_replace(trim(attributes ->> '${facet}'), '[\\s-]+', '_', 'g')) v, count(*)::text n from entity where ${where} and coalesce(trim(attributes ->> '${facet}'), '') <> '' group by 1`
  const rows = await db.many<{ v: string; n: string }>(sql, params)
  return new Map(rows.map(r => [r.v, Number(r.n)]))
}

/** For each named group of tags, the number of entities matching `opts` that carry at least one of them. */
export async function entityTagGroupCounts(db: Db, groups: Record<string, string[]>, opts: ListEntitiesOptions = {}): Promise<Map<string, number>> {
  const keys = Object.keys(groups)
  if (!keys.length) return new Map()
  const { where, params } = buildWhere(opts)
  const cols = keys.map((k, i) => { params.push(groups[k]); return `count(*) filter (where (attributes -> 'entity_types') ?| $${params.length}::text[])::text as g${i}` })
  const row = await db.one<Record<string, string>>(`select ${cols.join(', ')} from entity where ${where}`, params)
  return new Map(keys.map((k, i) => [k, Number(row?.[`g${i}`] ?? 0)]))
}

/** Number of entities matching the same filters `listEntities` accepts. */
export async function countEntities(db: Db, opts: ListEntitiesOptions = {}): Promise<number> {
  const { where, params } = buildWhere(opts)
  const row = await db.one<{ n: string }>(`select count(*)::text n from entity where ${where}`, params)
  return Number(row?.n ?? 0)
}

export async function listEntities(db: Db, opts: ListEntitiesOptions = {}): Promise<{ rows: EntityRow[]; total: number }> {
  const { where: sqlWhere, params } = buildWhere(opts)
  const order = opts.orderBy === 'name' ? 'name asc' : opts.orderBy === 'created_at' ? 'created_at desc' : 'updated_at desc'
  const limit = Math.min(opts.limit ?? 25, 500)
  const offset = opts.offset ?? 0
  const total = await db.one<{ n: string }>(`select count(*)::text n from entity where ${sqlWhere}`, params)
  params.push(limit, offset)
  const rows = await db.many<EntityRow>(
    `select * from entity where ${sqlWhere} order by ${order} limit $${params.length - 1} offset $${params.length}`, params)
  return { rows, total: Number(total?.n ?? 0) }
}

/** Number of edges touching an entity, optionally filtered by types. */
export async function countEdges(db: Db, entityId: string, types?: string[]): Promise<number> {
  const row = await db.one<{ n: string }>(
    `select count(*)::text n from edge where (from_id = $1 or to_id = $1) and ($2::text[] is null or type = any($2))`,
    [entityId, types ?? null])
  return Number(row?.n ?? 0)
}
