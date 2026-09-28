import { describe, it, expect } from 'vitest'
import { createTestDb } from './helpers/pglite'
import { backfill, documentText } from '@/scripts/embeddings/backfill'

describe('embedding backfill', () => {
  it('fills missing document and summary embeddings in batches with a cursor, skipping rows already embedded', async () => {
    const db = await createTestDb()
    try {
      await db.query(`insert into entity (id, kind, name, aliases) values ('00000000-0000-4000-8000-000000000001', 'person', 'A', '{}')`)
      for (let i = 0; i < 5; i++) await db.query(`insert into document (source, source_record_id, doc_type, title, body_text, checksum, raw) values ('t', $1, 'article', $2, 'body text', repeat($3, 64), '{}')`, [`r${i}`, `Doc ${i}`, String(i)])
      await db.query(`insert into summary (entity_id, tier, status, body, author) values ('00000000-0000-4000-8000-000000000001', 'free', 'published', 'A summary', 'test')`)
      const calls: number[] = []
      const embed = async (texts: string[]) => { calls.push(texts.length); return texts.map((_, i) => new Array(1024).fill(0).map((__, j) => (j === i ? 1 : 0))) }
      const n = await backfill(db, 'document', embed, { batch: 2, limit: 3 })
      expect(n).toBe(3)
      expect(calls).toEqual([2, 1])
      expect((await db.one<{ n: string }>(`select count(*)::text n from document where embedding is not null`))!.n).toBe('3')
      const rest = await backfill(db, 'document', embed, { batch: 10 })
      expect(rest).toBe(2)
      expect(await backfill(db, 'summary', embed, {})).toBe(1)
      expect(await backfill(db, 'document', embed, {})).toBe(0)
      const cur = await db.one<{ cursor_offset: number; status: string }>(`select cursor_offset, status from import_cursor where source = 'embeddings:document'`)
      expect(cur).toEqual({ cursor_offset: 5, status: 'complete' })
    } finally { await db.end() }
  })
  it('documentText falls back to the raw record and truncates', () => {
    const t = documentText({ title: 'T', body_text: null, doc_type: 'contribution', source: 'csc', raw: { a: 'x'.repeat(10_000) } })
    expect(t.startsWith('contribution (csc)\nT\n{"a":"xxx')).toBe(true)
    expect(t.length).toBeLessThanOrEqual(6000)
  })
})
