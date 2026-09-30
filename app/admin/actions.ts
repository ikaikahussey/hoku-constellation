'use server'

/**
 * Admin write path. Every action re-checks staff status and writes through the privileged
 * service connection. Reads for admin pages live in the page files; only writes live here.
 */
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth'
import { getServiceDb } from '@/lib/db/service'
import { entityInsertSchema, type EntityKind } from '@/lib/schema/attributes'
import type { Db } from '@/lib/db/types'

export type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string }

async function requireStaffDb(): Promise<{ db: Db } | { error: string }> {
  const user = await getCurrentUser()
  if (!user?.isStaff) return { error: 'Staff access required' }
  return { db: await getServiceDb() }
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key)
  return typeof v === 'string' ? v.trim() : ''
}

function optional(fd: FormData, key: string): string | undefined {
  const v = str(fd, key)
  return v ? v : undefined
}

function nullable(fd: FormData, key: string): string | null {
  const v = str(fd, key)
  return v ? v : null
}

function list(fd: FormData, key: string, sep = ','): string[] {
  return str(fd, key).split(sep).map(s => s.trim()).filter(Boolean)
}

function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key)
  return v === 'on' || v === 'true' || v === '1'
}

function visibility(fd: FormData): 'public' | 'gated' {
  return str(fd, 'visibility') === 'public' ? 'public' : 'gated'
}

/** Build {name, aliases, identifiers, attributes} for a person or org from a submitted form. */
function entityPayloadFromForm(kind: EntityKind, fd: FormData) {
  const name = str(fd, 'name')
  const aliases = list(fd, 'aliases')
  if (kind === 'person') {
    return {
      kind,
      name,
      aliases,
      identifiers: {},
      attributes: {
        slug: optional(fd, 'slug'),
        first_name: optional(fd, 'first_name'),
        last_name: optional(fd, 'last_name'),
        entity_types: fd.getAll('entity_types').map(String).filter(Boolean),
        office_held: nullable(fd, 'office_held'),
        party: nullable(fd, 'party'),
        district: nullable(fd, 'district'),
        island: optional(fd, 'island'),
        term_start: nullable(fd, 'term_start'),
        term_end: nullable(fd, 'term_end'),
        bio_summary: nullable(fd, 'bio_summary'),
        photo_url: nullable(fd, 'photo_url'),
        website_url: optional(fd, 'website_url'),
        status: optional(fd, 'status') ?? 'active',
        is_featured: bool(fd, 'is_featured'),
        is_priority: bool(fd, 'is_priority'),
        visibility: visibility(fd),
      },
    }
  }
  if (kind === 'org') {
    const identifiers: Record<string, string> = {}
    for (const scheme of ['ein', 'dcca', 'sec_cik', 'fec_id']) {
      const v = str(fd, scheme)
      if (v) identifiers[scheme] = v
    }
    return {
      kind,
      name,
      aliases,
      identifiers,
      attributes: {
        slug: optional(fd, 'slug'),
        org_type: optional(fd, 'org_type'),
        sector: nullable(fd, 'sector'),
        island: optional(fd, 'island'),
        description: optional(fd, 'description'),
        website_url: optional(fd, 'website_url'),
        status: optional(fd, 'status') ?? 'active',
        is_featured: bool(fd, 'is_featured'),
        is_priority: bool(fd, 'is_priority'),
        visibility: visibility(fd),
      },
    }
  }
  // Other kinds: attributes come in as a JSON blob.
  let attributes: Record<string, unknown> = {}
  const rawAttrs = str(fd, 'attributes_json')
  if (rawAttrs) {
    try { attributes = JSON.parse(rawAttrs) as Record<string, unknown> } catch { /* validated below */ }
  }
  return { kind, name, aliases, identifiers: {}, attributes }
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

function formatZodError(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues.map(i => `${i.path.join('.') || 'form'}: ${i.message}`).join('; ')
}

// ---------------------------------------------------------------- entities

export async function createEntity(kind: EntityKind, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireStaffDb()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const payload = entityPayloadFromForm(kind, formData)
  payload.attributes = stripUndefined(payload.attributes as Record<string, unknown>)
  const parsed = entityInsertSchema.safeParse(payload)
  if (!parsed.success) return { ok: false, error: formatZodError(parsed.error.issues) }
  const v = parsed.data
  try {
    const row = await ctx.db.one<{ id: string }>(
      `insert into entity (kind, name, aliases, identifiers, attributes)
       values ($1, $2, $3::text[], $4::jsonb, $5::jsonb) returning id`,
      [v.kind, v.name, v.aliases, JSON.stringify(v.identifiers), JSON.stringify(v.attributes)])
    if (!row) return { ok: false, error: 'Insert returned no row' }
    revalidatePath('/admin')
    revalidatePath(`/admin/${kind === 'person' ? 'person' : kind === 'org' ? 'org' : 'entity'}`)
    return { ok: true, id: row.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Insert failed' }
  }
}

export async function updateEntity(id: string, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireStaffDb()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const existing = await ctx.db.one<{ kind: EntityKind; attributes: Record<string, unknown>; identifiers: Record<string, string> }>(
    `select kind, attributes, identifiers from entity where id = $1`, [id])
  if (!existing) return { ok: false, error: 'Entity not found' }
  const payload = entityPayloadFromForm(existing.kind, formData)
  // Keep attributes the form does not manage (legacy ids, ingestion-provided fields).
  payload.attributes = stripUndefined({ ...existing.attributes, ...(payload.attributes as Record<string, unknown>) })
  if (existing.kind === 'org') {
    const kept = Object.fromEntries(Object.entries(existing.identifiers ?? {}).filter(([k]) => !['ein', 'dcca', 'sec_cik', 'fec_id'].includes(k)))
    payload.identifiers = { ...kept, ...payload.identifiers }
  } else {
    payload.identifiers = existing.identifiers ?? {}
  }
  const parsed = entityInsertSchema.safeParse(payload)
  if (!parsed.success) return { ok: false, error: formatZodError(parsed.error.issues) }
  const v = parsed.data
  try {
    await ctx.db.query(
      `update entity set name = $2, aliases = $3::text[], identifiers = $4::jsonb, attributes = $5::jsonb, updated_at = now() where id = $1`,
      [id, v.name, v.aliases, JSON.stringify(v.identifiers), JSON.stringify(v.attributes)])
    revalidatePath('/admin')
    revalidatePath(`/admin/person/${id}`)
    revalidatePath(`/admin/entity/${id}`)
    revalidatePath('/admin/person')
    revalidatePath('/admin/org')
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed' }
  }
}

export interface BulkRowResult { row: number; name: string; ok: boolean; error?: string; id?: string }

/** CSV bulk create: each row is a header→value map. Reuses createEntity's validation per row. */
export async function bulkCreateEntities(kind: 'person' | 'org', rows: Record<string, string>[]): Promise<ActionResult<{ results: BulkRowResult[]; created: number }>> {
  const ctx = await requireStaffDb()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const results: BulkRowResult[] = []
  let created = 0
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const fd = new FormData()
    const name = r.name || r.full_name || ''
    fd.set('name', name)
    fd.set('slug', r.slug || slugify(name))
    if (r.aliases) fd.set('aliases', r.aliases.replace(/;/g, ','))
    if (kind === 'person') {
      for (const k of ['first_name', 'last_name', 'party', 'district', 'island', 'status', 'website_url']) if (r[k]) fd.set(k, r[k])
      if (r.office_held || r.office) fd.set('office_held', r.office_held || r.office)
      for (const t of (r.entity_types || r.type || '').split(';').map(s => s.trim()).filter(Boolean)) fd.append('entity_types', t)
    } else {
      fd.set('org_type', r.org_type || r.type || 'other')
      for (const k of ['sector', 'island', 'status', 'website_url', 'description', 'ein', 'dcca', 'sec_cik', 'fec_id']) if (r[k]) fd.set(k, r[k])
    }
    if (!fd.get('status')) fd.set('status', 'active')
    fd.set('visibility', r.visibility || 'gated')
    const res = await createEntity(kind, fd)
    if (res.ok) { created++; results.push({ row: i + 1, name, ok: true, id: res.id }) }
    else results.push({ row: i + 1, name, ok: false, error: res.error })
  }
  return { ok: true, results, created }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[ʻ‘’']/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim()
}

/** Merge `fromId` into `intoId`: mark merged and repoint every edge. */
export async function mergeEntity(fromId: string, intoId: string): Promise<ActionResult> {
  const ctx = await requireStaffDb()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!fromId || !intoId || fromId === intoId) return { ok: false, error: 'Pick two different entities' }
  const target = await ctx.db.one<{ id: string; merged_into_id: string | null }>(`select id, merged_into_id from entity where id = $1`, [intoId])
  if (!target) return { ok: false, error: 'Target entity not found' }
  if (target.merged_into_id) return { ok: false, error: 'Target entity has itself been merged' }
  try {
    await ctx.db.transaction(async tx => {
      await tx.query(`update edge set from_id = $2 where from_id = $1`, [fromId, intoId])
      await tx.query(`update edge set to_id = $2 where to_id = $1`, [fromId, intoId])
      await tx.query(
        `update entity t set aliases = (select array(select distinct a from unnest(t.aliases || f.aliases || array[f.name]) a where a <> t.name))
           from entity f where t.id = $2 and f.id = $1`, [fromId, intoId])
      await tx.query(`update entity set merged_into_id = $2, updated_at = now() where id = $1`, [fromId, intoId])
    })
    revalidatePath('/admin', 'layout')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Merge failed' }
  }
}

// ---------------------------------------------------------------- match review

export async function resolveEdgeMatch(
  edgeId: string,
  side: 'from' | 'to',
  entityId: string | null,
  status: 'matched' | 'unmatched',
): Promise<ActionResult> {
  const ctx = await requireStaffDb()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const col = side === 'from' ? 'from_id' : 'to_id'
  const other = side === 'from' ? 'to_id' : 'from_id'
  try {
    if (status === 'matched') {
      if (!entityId) return { ok: false, error: 'An entity is required to mark matched' }
      // The edge is fully matched only when the other side is resolved (or not applicable).
      await ctx.db.query(
        `update edge set ${col} = $2, match_confidence = 1,
                match_status = case when ${other} is not null or type = 'mentioned_in' or ${other === 'to_id' ? 'to_name_raw' : 'from_name_raw'} is null then 'matched' else 'review' end
          where id = $1`, [edgeId, entityId])
    } else {
      await ctx.db.query(`update edge set ${col} = null, match_status = 'unmatched' where id = $1`, [edgeId])
    }
    revalidatePath('/admin/match-review')
    revalidatePath('/admin')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed' }
  }
}

// ---------------------------------------------------------------- articles

export async function createArticle(formData: FormData): Promise<ActionResult<{ id: string; created: boolean }>> {
  const ctx = await requireStaffDb()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const url = str(formData, 'url')
  const title = str(formData, 'title')
  if (!url || !title) return { ok: false, error: 'Title and URL are required' }
  const source = str(formData, 'source') || 'hoku_fm'
  const docDate = nullable(formData, 'doc_date')
  if (docDate && !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) return { ok: false, error: 'Date must be YYYY-MM-DD' }
  const raw = {
    title, url, source, doc_date: docDate,
    author: nullable(formData, 'author'),
    summary: nullable(formData, 'summary'),
    tags: list(formData, 'tags'),
  }
  const entityIds = formData.getAll('entity_ids').map(String).flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean)
  try {
    const inserted = await ctx.db.one<{ id: string }>(
      `insert into document (source, doc_type, url, title, doc_date, raw, checksum)
       values ($1, 'article', $2, $3, $4, $5::jsonb, encode(sha256(convert_to($2, 'utf8')), 'hex'))
       on conflict do nothing returning id`,
      [source, url, title, docDate, JSON.stringify(raw)])
    let id = inserted?.id
    const created = Boolean(inserted)
    if (!id) {
      const existing = await ctx.db.one<{ id: string }>(
        `select id from document where checksum = encode(sha256(convert_to($1, 'utf8')), 'hex')`, [url])
      if (!existing) return { ok: false, error: 'Document already exists but could not be located' }
      id = existing.id
    }
    for (const entityId of entityIds) {
      await ctx.db.query(
        `insert into edge (type, from_id, from_name_raw, document_id, match_status, match_confidence, attributes)
         select 'mentioned_in', e.id, e.name, $2, 'matched', 1, '{"mention_type":"editorial"}'::jsonb
           from entity e where e.id = $1
         on conflict do nothing`, [entityId, id])
    }
    revalidatePath('/admin/articles')
    return { ok: true, id, created }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Insert failed' }
  }
}

/** useActionState-compatible wrapper around createArticle. */
export async function createArticleForm(_prev: ActionResult<{ id: string; created: boolean }> | null, formData: FormData) {
  return createArticle(formData)
}
