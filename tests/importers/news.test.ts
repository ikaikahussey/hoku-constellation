import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as news from '@/lib/import/sources/news'
import { runTwice, edgesFor, dryRunLeavesNothing } from './_harness'

const fixture = (f: string) => readFileSync(new URL(`../../lib/import/sources/__fixtures__/news/${f}`, import.meta.url), 'utf8')
const records: news.FeedRecord[] = [
  { outlet: 'civil_beat', feedUrl: 'https://www.civilbeat.org/feed/', xml: fixture('civil-beat.xml') },
  { outlet: 'ka_wai_ola', feedUrl: 'https://kawaiola.news/feed/', xml: fixture('atom.xml') },
  { outlet: 'khon2', feedUrl: 'https://www.khon2.com/feed/', xml: '<rss><channel></channel></rss>' },
]

let db: TestDb
beforeAll(async () => {
  db = await createTestDb()
  await db.query(`insert into entity(kind, name, attributes) values ('person', 'Josh Green', '{"slug":"josh-green"}'), ('org', 'Office of Hawaiian Affairs', '{"slug":"oha"}')`)
})
afterAll(async () => { await db.end() })

describe('news importer', () => {
  it('Hawaiʻi calendar date for a UTC timestamp', () => {
    expect(news.hstDate('2026-06-30T02:15:00.000Z')).toBe('2026-06-29')
    expect(news.hstDate(null)).toBeNull()
  })

  it('dry run writes nothing', async () => {
    const r = await dryRunLeavesNothing(db, news, records)
    expect(r.seen).toBe(3)
  })

  it('stores one article per feed item, tags existing entities, creates none; idempotent', async () => {
    const r = await runTwice(db, news, records, {}, 3)
    expect(r.entitiesCreated).toBe(0)
    expect(r.edges).toBe(2)
    const docs = await db.many<{ source_record_id: string; doc_type: string; doc_date: string | null; url: string; title: string; raw: Record<string, unknown>; body_text: string | null }>(
      `select source_record_id, doc_type, doc_date::text doc_date, url, title, raw, body_text from document where source = 'news' order by source_record_id`)
    expect(docs.map(d => d.source_record_id)).toEqual([
      'civil_beat:https://www.civilbeat.org/?p=900001',
      'civil_beat:https://www.civilbeat.org/?p=900002',
      'ka_wai_ola:tag:news.example.org,2026:oha-budget',
    ])
    expect(docs[0]).toMatchObject({ doc_type: 'article', doc_date: '2026-06-29', url: 'https://www.civilbeat.org/2026/06/green-signs-sb-1234/' })
    expect(docs[0].raw).toMatchObject({ outlet: 'civil_beat', outlet_name: 'Honolulu Civil Beat', author: 'Jane Reporter' })
    expect(docs[0].body_text).toContain('Docket No. 2024-0123')
    expect(docs[1].body_text).toBe('The council took no action. A vote is expected in July.')
    const edges = await edgesFor(db, 'news')
    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'mentioned_in', from_name_raw: 'Josh Green', role: 'mentioned', match_status: 'matched', start_date: '2026-06-29', to_id: null }),
      expect.objectContaining({ type: 'mentioned_in', from_name_raw: 'Office of Hawaiian Affairs', role: 'subject', match_status: 'matched', start_date: '2026-07-01' }),
    ]))
    expect(edges[0].attributes).toMatchObject({ mention_type: 'news', matched_on: 'name' })
  })

  it('routes an ambiguous name to review without an entity id', async () => {
    await db.query(`insert into entity(kind, name, attributes) values ('person', 'Sam Writer', '{"slug":"sam-writer-1"}'), ('person', 'Sam Writer', '{"slug":"sam-writer-2"}')`)
    const xml = `<rss><channel><item><title>Sam Writer Named Editor</title><guid>x-1</guid><link>https://www.khon2.com/x-1</link><pubDate>Wed, 01 Jul 2026 00:00:00 GMT</pubDate></item></channel></rss>`
    const r = await runTwice(db, news, [{ outlet: 'khon2', feedUrl: 'https://www.khon2.com/feed/', xml }], {}, 1)
    expect(r.edges).toBe(1)
    const e = await db.one<{ from_id: string | null; match_status: string; attributes: { candidates: string[] } }>(
      `select e.from_id, e.match_status, e.attributes from edge e join document d on d.id = e.document_id where d.source_record_id = 'khon2:x-1'`)
    expect(e).toMatchObject({ from_id: null, match_status: 'review' })
    expect(e!.attributes.candidates).toHaveLength(2)
  })
})
