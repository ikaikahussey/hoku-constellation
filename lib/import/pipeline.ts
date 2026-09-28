/**
 * Shared write pipeline for every importer (D1 conventions):
 *   1. upsert document  (checksum = sha256(canonicalized source record); ON CONFLICT DO NOTHING)
 *   2. resolve or create entities (identifier → fuzzy → thresholds; follow merged_into_id)
 *   3. insert edges pointing at the document (unique on document_id, type, raw names, role)
 *
 * Never writes ax_* or summary. Never imports from lib/analytics.
 */
import { createHash } from 'node:crypto'
import type { Db } from '@/lib/db/types'
import { validateDocument, validateEdge, entityInsertSchema, type DocType, type EdgeType, type EntityKind } from '@/lib/schema/attributes'
import { resolveEntity, matchByIdentifiers, autoMatchThreshold, type Resolution } from '@/lib/entity-match'

// ---------------------------------------------------------------- canonicalization + checksum

/** Deterministic JSON: sorted keys, no undefined, stable number formatting. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k]
      if (val === undefined) continue
      out[k] = sortKeys(val)
    }
    return out
  }
  return v
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalize(value)).digest('hex')
}

/** Checksum for a source record: sha256 of `<source>:<canonical json>` so the same record under two sources stays distinct. */
export function recordChecksum(source: string, record: unknown): string {
  return sha256(`${source}:${canonicalize(record)}`)
}

// ---------------------------------------------------------------- documents

export interface DocumentInput {
  source: string
  source_record_id?: string | null
  doc_type: DocType
  url?: string | null
  title?: string | null
  doc_date?: string | null
  raw: Record<string, unknown> | unknown[]
  body_text?: string | null
  /** Override the default checksum (e.g. when the source publishes a stable hash). */
  checksum?: string
}

export interface UpsertDocumentResult { id: string; inserted: boolean; checksum: string }

export async function upsertDocument(db: Db, input: DocumentInput): Promise<UpsertDocumentResult> {
  const checksum = input.checksum ?? recordChecksum(input.source, input.raw)
  const doc = validateDocument({ ...input, checksum })
  const inserted = await db.one<{ id: string }>(
    `insert into document(source, source_record_id, doc_type, url, title, doc_date, raw, body_text, checksum)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict do nothing returning id`,
    [doc.source, doc.source_record_id ?? null, doc.doc_type, doc.url ?? null, doc.title ?? null, doc.doc_date ?? null,
      JSON.stringify(doc.raw), doc.body_text ?? null, doc.checksum])
  if (inserted) return { id: inserted.id, inserted: true, checksum }
  // Either the checksum exists, or (source, source_record_id) exists with a different checksum (record changed upstream).
  const existing = await db.one<{ id: string }>(`select id from document where checksum = $1`, [checksum])
  if (existing) return { id: existing.id, inserted: false, checksum }
  if (doc.source_record_id) {
    // Record content changed: replace raw/checksum in place so history stays keyed by source_record_id.
    const updated = await db.one<{ id: string }>(
      `update document set raw = $3, checksum = $4, title = coalesce($5, title), doc_date = coalesce($6, doc_date), url = coalesce($7, url), body_text = coalesce($8, body_text), fetched_at = now()
        where source = $1 and source_record_id = $2 returning id`,
      [doc.source, doc.source_record_id, JSON.stringify(doc.raw), checksum, doc.title ?? null, doc.doc_date ?? null, doc.url ?? null, doc.body_text ?? null])
    if (updated) return { id: updated.id, inserted: false, checksum }
  }
  throw new Error(`upsertDocument: could not insert or locate document for ${doc.source}/${doc.source_record_id ?? checksum}`)
}

// ---------------------------------------------------------------- entities

export interface EntityRef {
  kind: EntityKind
  rawName: string | null | undefined
  identifiers?: Record<string, string | null | undefined>
  /** Attributes used if the entity is created. */
  attributes?: Record<string, unknown>
  aliases?: string[]
  /** Allow creation without an identifier when confidence is below thresholds (sources with authoritative names, e.g. legislators, bills, dockets, parcels). */
  createIfMissing?: boolean
  /** Display name to use when creating (defaults to rawName). */
  canonicalName?: string
}

export interface ResolvedRef {
  entityId: string | null
  status: 'matched' | 'review' | 'unmatched'
  confidence: number | null
  created: boolean
  rawName: string | null
}

const cleanIdentifiers = (ids?: Record<string, string | null | undefined>) => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(ids ?? {})) if (v != null && String(v).trim()) out[k] = String(v).trim()
  return out
}

/**
 * Resolve a reference to an entity id following D1 rules. Creates a new entity only when an
 * identifier is present or `createIfMissing` is set (bills, dockets, parcels, official rosters).
 */
export async function resolveRef(db: Db, ref: EntityRef): Promise<ResolvedRef> {
  const rawName = ref.rawName?.trim() || null
  const ids = cleanIdentifiers(ref.identifiers)
  const res: Resolution = await resolveEntity(db, { kind: ref.kind, rawName, identifiers: ids })
  if (res.entityId) {
    if (Object.keys(ids).length) await mergeIdentifiers(db, res.entityId, ids)
    return { entityId: res.entityId, status: 'matched', confidence: res.confidence, created: false, rawName }
  }
  const canCreate = Object.keys(ids).length > 0 || ref.createIfMissing === true
  if (canCreate && (rawName || ref.canonicalName)) {
    const id = await createEntity(db, ref, ids)
    return { entityId: id, status: 'matched', confidence: 1, created: true, rawName }
  }
  return { entityId: null, status: res.status === 'review' ? 'review' : 'unmatched', confidence: res.confidence, created: false, rawName }
}

async function mergeIdentifiers(db: Db, entityId: string, ids: Record<string, string>) {
  await db.query(`update entity set identifiers = identifiers || $2::jsonb where id = $1 and not (identifiers @> $2::jsonb)`, [entityId, JSON.stringify(ids)])
}

export async function createEntity(db: Db, ref: EntityRef, ids: Record<string, string>): Promise<string> {
  const name = (ref.canonicalName ?? ref.rawName ?? '').trim()
  const attributes = { ...(ref.attributes ?? {}) }
  if (!attributes.slug) attributes.slug = slugFor(name, ids)
  const parsed = entityInsertSchema.parse({ kind: ref.kind, name, aliases: ref.aliases ?? [], identifiers: ids, attributes })
  // Slug collisions: append a short hash of identifiers/name.
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = attempt === 0 ? parsed.attributes.slug : `${parsed.attributes.slug}-${sha256(name + attempt).slice(0, 6)}`
    const row = await db.one<{ id: string }>(
      `insert into entity(kind, name, aliases, identifiers, attributes) values ($1,$2,$3,$4,$5)
       on conflict do nothing returning id`,
      [parsed.kind, parsed.name, parsed.aliases, JSON.stringify(parsed.identifiers), JSON.stringify({ ...parsed.attributes, slug })])
    if (row) return row.id
  }
  // Same slug already exists for this kind — reuse it (idempotent re-runs of created entities).
  const existing = await db.one<{ id: string }>(`select id from entity where kind = $1 and attributes ->> 'slug' = $2`, [parsed.kind, String(parsed.attributes.slug)])
  if (existing) return existing.id
  throw new Error(`createEntity: failed for ${ref.kind} ${name}`)
}

export function slugFor(name: string, ids: Record<string, string> = {}): string {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʻ‘’`']/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')
  const idSuffix = ids.tmk ?? ids.ein ?? ids.fec_id ?? ids.capitol_measure ?? ids.puc_docket
  return idSuffix ? `${base}-${idSuffix.toLowerCase().replace(/[^a-z0-9]+/g, '')}`.slice(0, 120) : base.slice(0, 120)
}

// ---------------------------------------------------------------- edges

export interface EdgeInput {
  type: EdgeType
  from: ResolvedRef | { entityId: string; rawName?: string | null }
  to: ResolvedRef | { entityId: string | null; rawName?: string | null } | null
  role?: string | null
  amount?: number | null
  start_date?: string | null
  end_date?: string | null
  attributes?: Record<string, unknown>
}

function statusFor(from: EdgeInput['from'], to: EdgeInput['to'], type: EdgeType): 'matched' | 'review' | 'unmatched' {
  const f = from.entityId, t = to?.entityId ?? null
  if (type === 'mentioned_in') return f ? 'matched' : (('status' in from && from.status === 'review') ? 'review' : 'unmatched')
  if (f && t) return 'matched'
  if (f || t) return 'review'
  const anyReview = ('status' in from && from.status === 'review') || (to && 'status' in to && to.status === 'review')
  return anyReview ? 'review' : 'unmatched'
}

/** Insert one edge; returns true if a row was inserted (false when the dedup index already has it). */
export async function insertEdge(db: Db, documentId: string, e: EdgeInput): Promise<boolean> {
  const fromConf = 'confidence' in e.from ? e.from.confidence : 1
  const toConf = e.to && 'confidence' in e.to ? e.to.confidence : 1
  const conf = [fromConf, toConf].filter((x): x is number => typeof x === 'number')
  const edge = validateEdge({
    type: e.type,
    from_id: e.from.entityId,
    to_id: e.to?.entityId ?? null,
    from_name_raw: e.from.rawName ?? null,
    to_name_raw: e.to?.rawName ?? null,
    role: e.role ?? null,
    amount: e.amount ?? null,
    start_date: e.start_date ?? null,
    end_date: e.end_date ?? null,
    document_id: documentId,
    match_status: statusFor(e.from, e.to, e.type),
    match_confidence: conf.length ? Math.min(...conf) : null,
    attributes: e.attributes ?? {},
  })
  const r = await db.query(
    `insert into edge(type, from_id, to_id, from_name_raw, to_name_raw, role, amount, start_date, end_date, document_id, match_status, match_confidence, attributes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict do nothing`,
    [edge.type, edge.from_id ?? null, edge.to_id ?? null, edge.from_name_raw ?? null, edge.to_name_raw ?? null, edge.role ?? null,
      edge.amount ?? null, edge.start_date ?? null, edge.end_date ?? null, edge.document_id, edge.match_status, edge.match_confidence ?? null,
      JSON.stringify(edge.attributes)])
  return r.rowCount > 0
}

// ---------------------------------------------------------------- batch result + cursor

export interface BatchResult {
  documents: number
  entitiesCreated: number
  edges: number
  nextOffset: number
  done: boolean
  /** Records seen (including duplicates). */
  seen: number
  errors: number
}

export function emptyResult(offset: number, done = false): BatchResult {
  return { documents: 0, entitiesCreated: 0, edges: 0, nextOffset: offset, done, seen: 0, errors: 0 }
}

export async function getCursor(db: Db, source: string): Promise<{ cursor_offset: number; status: string | null; last_run_at: string | null; metadata: Record<string, unknown> }> {
  const row = await db.one<{ cursor_offset: number | null; status: string | null; last_run_at: string | null; metadata: Record<string, unknown> | null }>(
    `select cursor_offset, status, last_run_at, metadata from import_cursor where source = $1`, [source])
  return { cursor_offset: row?.cursor_offset ?? 0, status: row?.status ?? null, last_run_at: row?.last_run_at ?? null, metadata: row?.metadata ?? {} }
}

export async function setCursor(db: Db, source: string, offset: number, status: 'running' | 'complete' | 'idle' | 'error', metadata: Record<string, unknown> = {}): Promise<void> {
  await db.query(
    `insert into import_cursor(source, cursor_offset, status, last_run_at, metadata) values ($1,$2,$3, now(), $4)
     on conflict (source) do update set cursor_offset = excluded.cursor_offset, status = excluded.status, last_run_at = now(),
       metadata = coalesce(import_cursor.metadata, '{}'::jsonb) || excluded.metadata`,
    [source, offset, status, JSON.stringify(metadata)])
}

/** Convenience for importers: process one source record through document → entities → edges. */
export interface RecordPlan {
  document: DocumentInput
  /** Called with the document id; return the edges to insert. Entity resolution happens inside via resolveRef. */
  edges: (ctx: { db: Db; documentId: string; created: () => void }) => Promise<EdgeInput[]>
}

export async function processRecord(db: Db, plan: RecordPlan, acc: BatchResult): Promise<void> {
  acc.seen++
  const doc = await upsertDocument(db, plan.document)
  if (doc.inserted) acc.documents++
  let created = 0
  const edges = await plan.edges({ db, documentId: doc.id, created: () => { created++ } })
  acc.entitiesCreated += created
  for (const e of edges) {
    if (await insertEdge(db, doc.id, e)) acc.edges++
  }
}

export { autoMatchThreshold, matchByIdentifiers }
