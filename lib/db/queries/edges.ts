import type { Db, EdgeRow } from '../types'

export interface EdgeWithEnds extends EdgeRow {
  from_name: string | null
  from_kind: string | null
  from_slug: string | null
  to_name: string | null
  to_kind: string | null
  to_slug: string | null
  doc_source: string
  doc_type: string
  doc_title: string | null
  doc_url: string | null
  doc_date: string | null
}

export interface GetEdgesOptions {
  types?: string[]
  direction?: 'in' | 'out' | 'both'
  dateRange?: { from?: string; to?: string }
  matchStatus?: Array<'matched' | 'review' | 'unmatched'>
  limit?: number
  offset?: number
  orderBy?: 'start_date' | 'amount'
}

const SELECT = `
  select e.*,
         f.name as from_name, f.kind as from_kind, f.attributes ->> 'slug' as from_slug,
         t.name as to_name, t.kind as to_kind, t.attributes ->> 'slug' as to_slug,
         d.source as doc_source, d.doc_type as doc_type, d.title as doc_title, d.url as doc_url, d.doc_date as doc_date
    from edge e
    left join entity f on f.id = e.from_id
    left join entity t on t.id = e.to_id
    join document d on d.id = e.document_id`

/**
 * Edges touching an entity. `direction: 'out'` = entity is `from_id`, `'in'` = entity is `to_id`.
 */
export async function getEdges(db: Db, entityId: string, opts: GetEdgesOptions = {}): Promise<EdgeWithEnds[]> {
  const params: unknown[] = [entityId]
  const where: string[] = []
  const dir = opts.direction ?? 'both'
  if (dir === 'out') where.push('e.from_id = $1')
  else if (dir === 'in') where.push('e.to_id = $1')
  else where.push('(e.from_id = $1 or e.to_id = $1)')
  if (opts.types?.length) { params.push(opts.types); where.push(`e.type = any($${params.length})`) }
  if (opts.dateRange?.from) { params.push(opts.dateRange.from); where.push(`e.start_date >= $${params.length}`) }
  if (opts.dateRange?.to) { params.push(opts.dateRange.to); where.push(`e.start_date <= $${params.length}`) }
  if (opts.matchStatus?.length) { params.push(opts.matchStatus); where.push(`e.match_status = any($${params.length})`) }
  const order = opts.orderBy === 'amount' ? 'e.amount desc nulls last' : 'e.start_date desc nulls last'
  params.push(Math.min(opts.limit ?? 200, 2000), opts.offset ?? 0)
  return db.many<EdgeWithEnds>(
    `${SELECT} where ${where.join(' and ')} order by ${order}, e.id limit $${params.length - 1} offset $${params.length}`, params)
}

export async function getEdgeById(db: Db, id: string): Promise<EdgeWithEnds | null> {
  return db.one<EdgeWithEnds>(`${SELECT} where e.id = $1`, [id])
}

/** Edges pointing at a document (e.g. mentioned_in for an article). */
export async function getEdgesForDocument(db: Db, documentId: string): Promise<EdgeWithEnds[]> {
  return db.many<EdgeWithEnds>(`${SELECT} where e.document_id = $1 order by e.type, e.from_name_raw`, [documentId])
}

export interface EdgeTotals {
  type: string
  direction: 'in' | 'out'
  n: number
  sum: number
}

/** Count and sum by type and direction for an entity's money view. */
export async function getEdgeTotals(db: Db, entityId: string): Promise<EdgeTotals[]> {
  const rows = await db.many<{ type: string; direction: 'in' | 'out'; n: string; sum: string | null }>(
    `select type, case when from_id = $1 then 'out' else 'in' end as direction, count(*)::text n, sum(amount)::text sum
       from edge where from_id = $1 or to_id = $1 group by 1, 2 order by 1, 2`, [entityId])
  return rows.map(r => ({ type: r.type, direction: r.direction, n: Number(r.n), sum: Number(r.sum ?? 0) }))
}

/** Edges awaiting review (admin match queue). */
export interface ReviewPriority {
  /** Priority entity ids: edges already linked to one of them on either side. */
  ids: string[]
  /** Normalized priority names (lib/import/priority targetNames): unresolved raw names similar to one of them. */
  names: string[]
}

/** Trigram similarity at or above which an unresolved raw name counts as a priority name (word order ignored). */
export const PRIORITY_NAME_SIMILARITY = 0.6

function reviewWhere(opts: { type?: string; priority?: ReviewPriority; priorityOnly?: boolean }, params: unknown[], needRank: boolean): { where: string; rank: string } {
  let where = `e.match_status <> 'matched'`
  if (opts.type) { params.push(opts.type); where += ` and e.type = $${params.length}` }
  let rank = 'false'
  // Bind the priority arrays only when the statement references them (Postgres rejects unused parameters).
  if (opts.priority && (opts.priority.ids.length || opts.priority.names.length) && (needRank || opts.priorityOnly)) {
    params.push(opts.priority.ids, opts.priority.names)
    const ids = `$${params.length - 1}::uuid[]`, names = `$${params.length}::text[]`
    rank = `coalesce(e.from_id = any(${ids}) or e.to_id = any(${ids})
      or exists (select 1 from unnest(${names}) p(n)
                  where (e.from_id is null and similarity(lower(coalesce(e.from_name_raw, '')), p.n) >= ${PRIORITY_NAME_SIMILARITY})
                     or (e.to_id is null and similarity(lower(coalesce(e.to_name_raw, '')), p.n) >= ${PRIORITY_NAME_SIMILARITY})), false)`
    if (opts.priorityOnly) where += ` and ${rank}`
  }
  return { where, rank }
}

/**
 * Edges with an unresolved side. Edges touching a priority entity (linked, or an unresolved raw name
 * similar to one of its names) come first; then highest amounts.
 */
export async function listReviewEdges(db: Db, opts: { limit?: number; offset?: number; type?: string; priority?: ReviewPriority; priorityOnly?: boolean } = {}): Promise<Array<EdgeWithEnds & { is_priority: boolean }>> {
  const params: unknown[] = []
  const { where, rank } = reviewWhere(opts, params, true)
  params.push(Math.min(opts.limit ?? 50, 500), opts.offset ?? 0)
  return db.many<EdgeWithEnds & { is_priority: boolean }>(
    `select * from (${SELECT.replace(/^\s*select /i, `select ${rank} as is_priority, `)} where ${where}) q
      order by q.is_priority desc, q.amount desc nulls last, q.id limit $${params.length - 1} offset $${params.length}`, params)
}

export async function countReviewEdges(db: Db, opts: { type?: string; priority?: ReviewPriority; priorityOnly?: boolean } = {}): Promise<number> {
  const params: unknown[] = []
  const { where } = reviewWhere(opts, params, false)
  return Number((await db.one<{ n: string }>(`select count(*)::text n from edge e where ${where}`, params))?.n ?? 0)
}
