import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import {
  EDGE_TYPES, ENTITY_KINDS, DOC_TYPES,
  entityAttributeSchemas, edgeAttributeSchemas, documentInsertSchema, edgeInsertSchema, entityInsertSchema,
} from '@/lib/schema/attributes'

let db: TestDb

beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

const sha = (s: string) => Array.from({ length: 64 }, (_, i) => s.charCodeAt(i % s.length).toString(16).slice(-1)).join('')

describe('core schema constraints', () => {
  it('has the five core tables plus operational tables', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema='public' order by 1`)
    const names = rows.map(r => r.table_name)
    for (const t of ['entity', 'document', 'edge', 'summary', 'user_account', 'import_cursor', 'ax_influence_score', 'ax_relationship_edge', 'ax_alert', 'ax_graph_snapshot', 'migration_user_map']) {
      expect(names).toContain(t)
    }
  })

  it('rejects unknown entity.kind', async () => {
    await expect(db.query(`insert into entity(kind, name) values ('planet', 'Mars')`)).rejects.toThrow(/check/i)
  })

  it('accepts every declared entity.kind', async () => {
    for (const kind of ENTITY_KINDS) {
      await db.query(`insert into entity(kind, name) values ($1, $2)`, [kind, `test ${kind}`])
    }
    const { rows } = await db.query<{ n: string }>(`select count(*)::text n from entity`)
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(ENTITY_KINDS.length)
  })

  it('rejects unknown edge.type and accepts every declared type', async () => {
    const doc = await db.one<{ id: string }>(
      `insert into document(source, doc_type, raw, checksum) values ('test','source_record','{}', $1) returning id`, [sha('doc-types')])
    const a = await db.one<{ id: string }>(`insert into entity(kind,name) values ('person','A') returning id`)
    const b = await db.one<{ id: string }>(`insert into entity(kind,name) values ('org','B') returning id`)
    await expect(db.query(
      `insert into edge(type, from_id, to_id, document_id) values ('friends_with', $1, $2, $3)`, [a!.id, b!.id, doc!.id]
    )).rejects.toThrow(/edge_type_vocabulary/)
    for (const t of EDGE_TYPES) {
      await db.query(`insert into edge(type, from_id, to_id, document_id, role) values ($1, $2, $3, $4, $1)`, [t, a!.id, b!.id, doc!.id])
    }
  })

  it('rejects unknown match_status', async () => {
    const doc = await db.one<{ id: string }>(
      `insert into document(source, doc_type, raw, checksum) values ('test','source_record','{}', $1) returning id`, [sha('ms')])
    await expect(db.query(
      `insert into edge(type, from_name_raw, to_name_raw, document_id, match_status) values ('contributed_to','x','y',$1,'auto_matched')`, [doc!.id]
    )).rejects.toThrow(/check/i)
  })

  it('enforces document checksum uniqueness (ON CONFLICT DO NOTHING inserts 0)', async () => {
    const cs = sha('dup')
    await db.query(`insert into document(source, doc_type, raw, checksum) values ('t','article','{}',$1)`, [cs])
    const r = await db.query(`insert into document(source, doc_type, raw, checksum) values ('t','article','{}',$1) on conflict (checksum) do nothing`, [cs])
    expect(r.rowCount).toBe(0)
  })

  it('enforces edge dedup on (document_id, type, raw names, role) with nulls', async () => {
    const doc = await db.one<{ id: string }>(
      `insert into document(source, doc_type, raw, checksum) values ('t','contribution','{}',$1) returning id`, [sha('edge-dedup')])
    const ins = `insert into edge(type, from_name_raw, to_name_raw, document_id) values ('contributed_to','Donor','Cand',$1) on conflict do nothing`
    const r1 = await db.query(ins, [doc!.id])
    const r2 = await db.query(ins, [doc!.id])
    expect(r1.rowCount).toBe(1)
    expect(r2.rowCount).toBe(0)
  })

  it('summary requires exactly one subject', async () => {
    const e = await db.one<{ id: string }>(`insert into entity(kind,name) values ('person','S') returning id`)
    const doc = await db.one<{ id: string }>(
      `insert into document(source, doc_type, raw, checksum) values ('t','article','{}',$1) returning id`, [sha('summary')])
    await expect(db.query(`insert into summary(body, author) values ('x','model:test')`)).rejects.toThrow(/check/i)
    await expect(db.query(`insert into summary(entity_id, document_id, body, author) values ($1,$2,'x','model:test')`, [e!.id, doc!.id])).rejects.toThrow(/check/i)
    await db.query(`insert into summary(entity_id, body, author) values ($1,'ok','model:test')`, [e!.id])
    await expect(db.query(`insert into summary(entity_id, body, author, status) values ($1,'ok','model:test','archived')`, [e!.id])).rejects.toThrow(/check/i)
    await expect(db.query(`insert into summary(entity_id, body, author, tier) values ($1,'ok','model:test','gold')`, [e!.id])).rejects.toThrow(/check/i)
  })

  it('has the required indexes', async () => {
    const { rows } = await db.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname='public'`)
    const idx = rows.map(r => r.indexname)
    for (const name of ['edge_type_to_idx', 'edge_type_from_idx', 'edge_document_idx', 'edge_start_date_idx', 'edge_amount_idx',
      'edge_needs_review_idx', 'entity_identifiers_gin', 'entity_aliases_gin', 'entity_name_trgm', 'document_source_date_idx',
      'document_embedding_hnsw', 'summary_embedding_hnsw']) {
      expect(idx).toContain(name)
    }
  })

  it('keeps entity.updated_at fresh', async () => {
    const e = await db.one<{ id: string; updated_at: string }>(`insert into entity(kind,name) values ('org','U') returning id, updated_at`)
    await db.query(`update entity set name='U2' where id=$1`, [e!.id])
    const after = await db.one<{ updated_at: string }>(`select updated_at from entity where id=$1`, [e!.id])
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(e!.updated_at).getTime())
  })
})

describe('zod attribute schemas', () => {
  it('has a schema for every kind, edge type, and doc type', () => {
    for (const k of ENTITY_KINDS) expect(entityAttributeSchemas[k]).toBeDefined()
    for (const t of EDGE_TYPES) expect(edgeAttributeSchemas[t]).toBeDefined()
    for (const d of DOC_TYPES) expect(documentInsertSchema.shape.doc_type.safeParse(d).success).toBe(true)
  })

  it('validates and rejects per kind', () => {
    expect(entityInsertSchema.safeParse({ kind: 'bill', name: 'SB1', attributes: { measure_number: 'SB1', session: '2026' } }).success).toBe(true)
    expect(entityInsertSchema.safeParse({ kind: 'bill', name: 'SB1', attributes: {} }).success).toBe(false)
    expect(entityInsertSchema.safeParse({ kind: 'parcel', name: '1-2-3-004-005', attributes: { tmk: '120030040050000' } }).success).toBe(true)
    expect(entityInsertSchema.safeParse({ kind: 'parcel', name: 'x', attributes: { tmk: '920030040050000' } }).success).toBe(false)
    expect(entityInsertSchema.safeParse({ kind: 'office', name: 'BLNR', attributes: { office_type: 'board' } }).success).toBe(true)
    expect(entityInsertSchema.safeParse({ kind: 'office', name: 'BLNR', attributes: { office_type: 'club' } }).success).toBe(false)
    expect(entityInsertSchema.safeParse({ kind: 'docket', name: '2024-0158', attributes: { docket_number: '2024-0158', agency: 'PUC' } }).success).toBe(true)
    expect(entityInsertSchema.safeParse({ kind: 'person', name: 'A', attributes: { term_start: '01/02/2020' } }).success).toBe(false)
    expect(entityInsertSchema.safeParse({ kind: 'moon', name: 'A' }).success).toBe(false)
  })

  it('validates documents', () => {
    const ok = documentInsertSchema.safeParse({ source: 'csc', doc_type: 'contribution', raw: { a: 1 }, checksum: 'a'.repeat(64) })
    expect(ok.success).toBe(true)
    expect(documentInsertSchema.safeParse({ source: 'csc', doc_type: 'tweet', raw: {}, checksum: 'a'.repeat(64) }).success).toBe(false)
    expect(documentInsertSchema.safeParse({ source: 'csc', doc_type: 'article', raw: {}, checksum: 'nothex' }).success).toBe(false)
  })

  it('validates edges and requires endpoints', () => {
    const doc = '11111111-1111-4111-8111-111111111111'
    expect(edgeInsertSchema.safeParse({ type: 'contributed_to', from_name_raw: 'A', to_name_raw: 'B', document_id: doc, amount: 100 }).success).toBe(true)
    expect(edgeInsertSchema.safeParse({ type: 'contributed_to', from_name_raw: 'A', document_id: doc }).success).toBe(false)
    expect(edgeInsertSchema.safeParse({ type: 'mentioned_in', from_name_raw: 'A', document_id: doc }).success).toBe(true)
    expect(edgeInsertSchema.safeParse({ type: 'voted_on', from_name_raw: 'A', to_name_raw: 'SB1', document_id: doc, attributes: { vote_type: 'telepathic' } }).success).toBe(false)
    expect(edgeInsertSchema.safeParse({ type: 'hugged', from_name_raw: 'A', to_name_raw: 'B', document_id: doc }).success).toBe(false)
    expect(edgeInsertSchema.safeParse({ type: 'owns', from_name_raw: 'A', to_name_raw: 'B', document_id: doc, match_confidence: 1.7 }).success).toBe(false)
  })
})

describe('Neon URL derivation', () => {
  it('derives the Data API URL from the Auth URL', async () => {
    const { deriveDataApiUrl } = await import('@/lib/db/browser')
    expect(deriveDataApiUrl('https://ep-wild-hall-b8xj7vav.neonauth.c-14.us-east-1.aws.neon.tech/neondb/auth'))
      .toBe('https://ep-wild-hall-b8xj7vav.apirest.c-14.us-east-1.aws.neon.tech/neondb/rest/v1')
  })
})
