import type { Db, SummaryRow } from '../types'

export interface GetSummaryOptions {
  /** Include drafts (staff callers only; RLS enforces this for user clients). */
  includeDrafts?: boolean
  tier?: 'free' | 'paid'
}

/** Latest published summary for an entity (or all, newest first). */
export async function getSummary(db: Db, entityId: string, opts: GetSummaryOptions = {}): Promise<SummaryRow | null> {
  const params: unknown[] = [entityId]
  const where = ['entity_id = $1']
  if (!opts.includeDrafts) where.push(`status = 'published'`)
  if (opts.tier) { params.push(opts.tier); where.push(`tier = $${params.length}`) }
  return db.one<SummaryRow>(`select * from summary where ${where.join(' and ')} order by created_at desc limit 1`, params)
}

export async function listSummaries(db: Db, entityId: string, opts: GetSummaryOptions = {}): Promise<SummaryRow[]> {
  const params: unknown[] = [entityId]
  const where = ['entity_id = $1']
  if (!opts.includeDrafts) where.push(`status = 'published'`)
  return db.many<SummaryRow>(`select * from summary where ${where.join(' and ')} order by created_at desc`, params)
}

export interface SummaryInsert {
  entity_id?: string | null
  edge_id?: string | null
  document_id?: string | null
  body: string
  cites?: string[]
  author: string
  status?: 'draft' | 'published'
  tier?: 'free' | 'paid'
}

/** Staff/admin write path (service db). Ingestion must never call this. */
export async function insertSummary(db: Db, s: SummaryInsert): Promise<SummaryRow> {
  const row = await db.one<SummaryRow>(
    `insert into summary(entity_id, edge_id, document_id, body, cites, author, status, tier)
     values ($1, $2, $3, $4, $5, $6, coalesce($7, 'draft'), coalesce($8, 'paid')) returning *`,
    [s.entity_id ?? null, s.edge_id ?? null, s.document_id ?? null, s.body, s.cites ?? [], s.author, s.status ?? null, s.tier ?? null])
  return row!
}
