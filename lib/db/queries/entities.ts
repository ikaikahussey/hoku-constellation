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
  kind?: EntityRow['kind']
  q?: string
  featured?: boolean
  status?: string
  limit?: number
  offset?: number
  orderBy?: 'updated_at' | 'name' | 'created_at'
}

export async function listEntities(db: Db, opts: ListEntitiesOptions = {}): Promise<{ rows: EntityRow[]; total: number }> {
  const where: string[] = ['merged_into_id is null']
  const params: unknown[] = []
  if (opts.kind) { params.push(opts.kind); where.push(`kind = $${params.length}`) }
  if (opts.q) { params.push(`%${opts.q}%`); where.push(`(name ilike $${params.length} or exists (select 1 from unnest(aliases) a where a ilike $${params.length}))`) }
  if (opts.featured !== undefined) { params.push(opts.featured); where.push(`coalesce((attributes ->> 'is_featured')::boolean, false) = $${params.length}`) }
  if (opts.status) { params.push(opts.status); where.push(`attributes ->> 'status' = $${params.length}`) }
  const order = opts.orderBy === 'name' ? 'name asc' : opts.orderBy === 'created_at' ? 'created_at desc' : 'updated_at desc'
  const limit = Math.min(opts.limit ?? 25, 500)
  const offset = opts.offset ?? 0
  const sqlWhere = where.join(' and ')
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
