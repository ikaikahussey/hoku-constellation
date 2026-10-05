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
  return getDocumentsForEntity(db, entityId, { docTypes: ['article'], limit, includeRaw: true })
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

// ---------------------------------------------------------------- document browser (/documents)

export interface ListDocumentsOptions {
  /** Case-insensitive match on title, source_record_id, or body_text. */
  q?: string
  sources?: string[]
  docTypes?: string[]
  /** Doc types the caller may not see (access gating); always removed from results and facets. */
  excludeDocTypes?: string[]
  /** Inclusive ISO date bounds on doc_date. */
  from?: string
  to?: string
  limit?: number
  offset?: number
  orderBy?: 'doc_date' | 'fetched_at'
}

export interface DocumentSummary {
  id: string
  source: string
  source_record_id: string | null
  doc_type: string
  url: string | null
  title: string | null
  doc_date: string | null
  fetched_at: string
  /** First 240 characters of body_text, when present. */
  excerpt: string | null
  edge_count: number
}

export interface FacetCount { value: string; n: number }
export interface DocumentFacets { sources: FacetCount[]; docTypes: FacetCount[] }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function documentWhere(opts: ListDocumentsOptions, skip: 'sources' | 'docTypes' | null = null): { where: string; params: unknown[] } {
  const where: string[] = ['true']
  const params: unknown[] = []
  const q = opts.q?.trim()
  if (q) {
    params.push(`%${q}%`)
    where.push(`(d.title ilike $${params.length} or d.source_record_id ilike $${params.length} or d.body_text ilike $${params.length})`)
  }
  if (skip !== 'sources' && opts.sources?.length) { params.push(opts.sources); where.push(`d.source = any($${params.length}::text[])`) }
  if (skip !== 'docTypes' && opts.docTypes?.length) { params.push(opts.docTypes); where.push(`d.doc_type = any($${params.length}::text[])`) }
  if (opts.excludeDocTypes?.length) { params.push(opts.excludeDocTypes); where.push(`d.doc_type <> all($${params.length}::text[])`) }
  if (opts.from && ISO_DATE.test(opts.from)) { params.push(opts.from); where.push(`d.doc_date >= $${params.length}::date`) }
  if (opts.to && ISO_DATE.test(opts.to)) { params.push(opts.to); where.push(`d.doc_date <= $${params.length}::date`) }
  return { where: where.join(' and '), params }
}

/** Page of documents matching the filters, newest first, with the number of edges each one backs. */
export async function listDocuments(db: Db, opts: ListDocumentsOptions = {}): Promise<{ rows: DocumentSummary[]; total: number }> {
  const { where, params } = documentWhere(opts)
  const total = await db.one<{ n: string }>(`select count(*)::text n from document d where ${where}`, params)
  const order = opts.orderBy === 'fetched_at' ? 'd.fetched_at desc' : 'd.doc_date desc nulls last, d.fetched_at desc'
  params.push(Math.min(opts.limit ?? 50, 200), opts.offset ?? 0)
  const rows = await db.many<Omit<DocumentSummary, 'edge_count'> & { edge_count: string }>(
    `select d.id, d.source, d.source_record_id, d.doc_type, d.url, d.title, d.doc_date, d.fetched_at,
            left(d.body_text, 240) as excerpt,
            (select count(*) from edge e where e.document_id = d.id)::text as edge_count
       from document d
      where ${where}
      order by ${order}, d.id
      limit $${params.length - 1} offset $${params.length}`, params)
  return { rows: rows.map(r => ({ ...r, edge_count: Number(r.edge_count) })), total: Number(total?.n ?? 0) }
}

/**
 * Counts per source and per doc type for the current filters. Each facet ignores its own dimension so the
 * sidebar still shows the alternatives a user could switch to.
 */
export async function documentFacets(db: Db, opts: ListDocumentsOptions = {}): Promise<DocumentFacets> {
  const bySource = documentWhere(opts, 'sources')
  const byType = documentWhere(opts, 'docTypes')
  const [sources, docTypes] = await Promise.all([
    db.many<{ value: string; n: string }>(`select d.source as value, count(*)::text n from document d where ${bySource.where} group by 1 order by 2 desc, 1`, bySource.params),
    db.many<{ value: string; n: string }>(`select d.doc_type as value, count(*)::text n from document d where ${byType.where} group by 1 order by 2 desc, 1`, byType.params),
  ])
  return { sources: sources.map(r => ({ value: r.value, n: Number(r.n) })), docTypes: docTypes.map(r => ({ value: r.value, n: Number(r.n) })) }
}
