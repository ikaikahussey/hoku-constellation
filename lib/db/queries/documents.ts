import type { Db, DocumentRow } from '../types'

export interface DocumentForEntity extends Omit<DocumentRow, 'raw'> {
  edge_type: string
  role: string | null
  raw?: Record<string, unknown>
}

export interface GetDocumentsOptions {
  docTypes?: string[]
  sources?: string[]
  limit?: number
  offset?: number
  includeRaw?: boolean
}

/** Documents that back any edge touching an entity, newest first. */
export async function getDocumentsForEntity(db: Db, entityId: string, opts: GetDocumentsOptions = {}): Promise<DocumentForEntity[]> {
  const params: unknown[] = [entityId]
  const where: string[] = ['(e.from_id = $1 or e.to_id = $1)']
  if (opts.docTypes?.length) { params.push(opts.docTypes); where.push(`d.doc_type = any($${params.length})`) }
  if (opts.sources?.length) { params.push(opts.sources); where.push(`d.source = any($${params.length})`) }
  params.push(Math.min(opts.limit ?? 50, 500), opts.offset ?? 0)
  const rawCol = opts.includeRaw ? 'd.raw,' : ''
  return db.many<DocumentForEntity>(
    `select distinct on (d.id) d.id, d.source, d.source_record_id, d.doc_type, d.url, d.title, d.doc_date, ${rawCol}
            d.body_text, d.checksum, d.fetched_at, e.type as edge_type, e.role
       from edge e join document d on d.id = e.document_id
      where ${where.join(' and ')}
      order by d.id, d.doc_date desc nulls last`
      .replace('select distinct on (d.id)', 'select * from (select distinct on (d.id)') + `) x order by doc_date desc nulls last, fetched_at desc limit $${params.length - 1} offset $${params.length}`,
    params)
}

export async function getDocument(db: Db, id: string): Promise<DocumentRow | null> {
  return db.one<DocumentRow>(`select * from document where id = $1`, [id])
}

export async function getDocumentByChecksum(db: Db, checksum: string): Promise<DocumentRow | null> {
  return db.one<DocumentRow>(`select * from document where checksum = $1`, [checksum])
}

/** Articles (editorial documents) mentioning an entity. */
export async function getArticlesForEntity(db: Db, entityId: string, limit = 20): Promise<DocumentForEntity[]> {
  return getDocumentsForEntity(db, entityId, { docTypes: ['article'], limit })
}

/** Timeline events for an entity, newest first. */
export async function getEventsForEntity(db: Db, entityId: string, limit = 100): Promise<DocumentForEntity[]> {
  return getDocumentsForEntity(db, entityId, { docTypes: ['event'], limit, includeRaw: true })
}

export interface DocumentCounts { source: string; doc_type: string; n: number }
export async function countDocumentsBySource(db: Db): Promise<DocumentCounts[]> {
  const rows = await db.many<{ source: string; doc_type: string; n: string }>(
    `select source, doc_type, count(*)::text n from document group by 1, 2 order by 1, 2`)
  return rows.map(r => ({ ...r, n: Number(r.n) }))
}
