import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from './helpers/pglite'
import { normalize, normalizeOrg } from '@/lib/entity-match'
import { parseFeed, canonicalLink, htmlToText } from '@/lib/news/rss'
import { candidatePhrases, measureMentions, docketMentions, sessionsFor, tagArticle } from '@/lib/news/tagger'
import { activeOutlets, NEWS_OUTLETS } from '@/lib/news/outlets'
import { summarizePendingArticles, FALLBACK_AUTHOR } from '@/lib/news/summarize'
import { listNews, newsOutletCounts } from '@/lib/db/queries/news'
import { upsertDocument } from '@/lib/import/pipeline'
import type { NarrativeModel } from '@/lib/ai/claude'
import type { CitedSentence } from '@/lib/ai/citations'

const fixture = (f: string) => readFileSync(new URL(`../lib/import/sources/__fixtures__/news/${f}`, import.meta.url), 'utf8')

let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

async function entity(kind: string, name: string, extra: { aliases?: string[]; identifiers?: Record<string, string>; attributes?: Record<string, unknown>; merged_into_id?: string } = {}) {
  const row = await db.one<{ id: string }>(
    `insert into entity(kind, name, aliases, identifiers, attributes, merged_into_id) values ($1,$2,$3,$4,$5,$6) returning id`,
    [kind, name, extra.aliases ?? [], JSON.stringify(extra.identifiers ?? {}), JSON.stringify(extra.attributes ?? { slug: normalize(name).replace(/ /g, '-') }), extra.merged_into_id ?? null])
  return row!.id
}

describe('feed parsing', () => {
  it('parses RSS 2.0 with content:encoded, strips trailers, scripts, and tracking params', () => {
    const items = parseFeed(fixture('civil-beat.xml'))
    expect(items).toHaveLength(2)
    const [a, b] = items
    expect(a.title).toBe('Green Signs SB 1234, Ordering New Review Of Hawaiian Electric’s Wildfire Plan')
    expect(a.guid).toBe('https://www.civilbeat.org/?p=900001')
    expect(a.link).toBe('https://www.civilbeat.org/2026/06/green-signs-sb-1234/')
    expect(a.author).toBe('Jane Reporter')
    expect(a.published).toBe('2026-06-30T02:15:00.000Z')
    expect(a.categories).toEqual(['Politics', 'Energy'])
    expect(a.description).toBe('Gov. Josh Green signed the measure Monday. The law requires a new review of utility wildfire plans.')
    expect(a.content).toContain('Docket No. 2024-0123')
    expect(a.content).not.toContain('tracker')
    expect(b.link).toBe('https://www.civilbeat.org/2026/06/maui-housing/')
    expect(b.description).toBe('The council took no action. A vote is expected in July.')
    expect(b.content).toBeNull()
  })

  it('parses Atom entries', () => {
    const [e] = parseFeed(fixture('atom.xml'))
    expect(e).toMatchObject({
      guid: 'tag:news.example.org,2026:oha-budget', link: 'https://news.example.org/oha-budget', title: 'Office of Hawaiian Affairs Trustees Approve Budget',
      author: 'Kai Writer', published: '2026-07-01T19:30:00.000Z', description: 'The Office of Hawaiian Affairs board voted 7-2.', categories: ['OHA'],
    })
  })

  it('tolerates junk input', () => {
    expect(parseFeed('not xml at all')).toEqual([])
    expect(canonicalLink('not a url')).toBeNull()
    expect(htmlToText('')).toBeNull()
  })
})

describe('outlets', () => {
  it('never returns disabled outlets, even when named', () => {
    const disabled = NEWS_OUTLETS.find(o => !o.enabled)!
    expect(activeOutlets().some(o => o.key === disabled.key)).toBe(false)
    expect(activeOutlets(`${disabled.key},civil_beat`).map(o => o.key)).toEqual(['civil_beat'])
    expect(new Set(NEWS_OUTLETS.map(o => o.key)).size).toBe(NEWS_OUTLETS.length)
  })
})

describe('entity_match_key SQL mirrors normalize()', () => {
  const names = ['Kauaʻi Island Utility Cooperative', 'Hawaiian Electric Co., Inc.', 'Office of Hawaiian Affairs', 'Alexander & Baldwin', 'Nadine K. Nakamura',
    'Kaua‘i County', "Kaua'i", 'Mānoa Valley Theatre', 'Lānaʻi Resorts LLC', 'Hōkūleʻa', '  Double  Spaced  ', 'The Nature Conservancy', 'José Peña']
  it('matches normalize() and normalizeOrg() for Hawaiian orthography, punctuation, and suffixes', async () => {
    for (const n of names) {
      const r = await db.one<{ k: string; keys: string[] }>(`select public.entity_match_key($1) k, public.entity_match_keys('org', $1, '{}') keys`, [n])
      expect(r!.k, n).toBe(normalize(n))
      expect(r!.keys, n).toContain(normalizeOrg(n))
    }
  })
})

describe('tagger helpers', () => {
  it('finds measures, dockets, and biennium sessions', () => {
    expect(measureMentions('Lawmakers passed SB 1234 SD1, HB12 and House Bill 7; also House Concurrent Resolution 3.').map(m => m.measure).sort())
      .toEqual(['HB12', 'HB7', 'HCR3', 'SB1234'])
    expect(docketMentions('PUC Docket No. 2024-0123 and docket 2025-0001').map(d => d.docket)).toEqual(['2024-0123', '2025-0001'])
    expect(sessionsFor('2026-06-30T00:00:00Z')).toEqual(['2026', '2025'])
    expect(sessionsFor('2027-05-01T00:00:00Z')).toEqual(['2027'])
    expect(sessionsFor('2027-01-05T00:00:00Z')).toEqual(['2027', '2026', '2025'])
  })

  it('builds capitalized phrase candidates without single common words', () => {
    const keys = candidatePhrases('Gov. Josh Green Visits Maui', 'The Office of Hawaiian Affairs and HECO met. Rep. Nadine K. Nakamura spoke. She said the State would act.').map(c => c.key)
    expect(keys).toContain('josh green')
    expect(keys).toContain('office of hawaiian affairs')
    expect(keys).toContain('heco')
    expect(keys).toContain('nadine k nakamura')
    expect(keys).not.toContain('maui')
    expect(keys).not.toContain('state')
    expect(keys).not.toContain('she')
  })
})

describe('tagArticle + summaries + listNews', () => {
  const ids: Record<string, string> = {}
  let docId = ''

  beforeAll(async () => {
    ids.green = await entity('person', 'Josh Green')
    ids.heco = await entity('org', 'Hawaiian Electric Company, Inc.', { aliases: ['HECO', 'Hawaiian Electric'] })
    ids.hei = await entity('org', 'Hawaiian Electric Industries, Inc.')
    ids.puc = await entity('office', 'Public Utilities Commission', { attributes: { slug: 'puc', office_type: 'commission' } })
    ids.nakamura = await entity('person', 'Nadine K. Nakamura')
    ids.smith1 = await entity('person', 'John Smith')
    ids.smith2 = await entity('person', 'John Smith', { attributes: { slug: 'john-smith-2' } })
    ids.bill = await entity('bill', 'SB1234 (2025)', { identifiers: { measure: '2025:SB1234' }, attributes: { slug: 'sb1234-2025', measure_number: 'SB1234', session: '2025' } })
    ids.docket = await entity('docket', 'PUC Docket 2024-0123', { identifiers: { docket_number: '2024-0123' }, attributes: { slug: 'puc-docket-20240123', docket_number: '2024-0123', agency: 'PUC' } })
    const survivor = await entity('person', 'Ann Doe')
    ids.annDoe = survivor
    await entity('person', 'Ann B Doe', { aliases: ['Ann Doe'], merged_into_id: survivor, attributes: { slug: 'ann-b-doe' } })
  })

  it('tags people, orgs, offices, bills, and dockets; prefers the longest phrase; routes ambiguous names to review', async () => {
    const [item] = parseFeed(fixture('civil-beat.xml'))
    const mentions = await tagArticle(db, { title: item.title, body: item.content, published: item.published })
    const byId = new Map(mentions.filter(m => m.entityId).map(m => [m.entityId!, m]))
    // The headline says only "Green"; the full name is in the body.
    expect(byId.get(ids.green)).toMatchObject({ kind: 'person', role: 'mentioned', matchedOn: 'name' })
    expect(byId.get(ids.bill)).toMatchObject({ kind: 'bill', role: 'subject', matchedOn: 'measure' })
    expect(byId.get(ids.docket)).toMatchObject({ kind: 'docket', role: 'mentioned', matchedOn: 'docket' })
    expect(byId.get(ids.hei)).toMatchObject({ kind: 'org', role: 'mentioned', surface: 'Hawaiian Electric Industries' })
    // "Hawaiian Electric" in the headline is the operating company's name without its suffixes.
    expect(byId.get(ids.heco)).toMatchObject({ kind: 'org', role: 'subject', matchedOn: 'name' })
    expect(byId.get(ids.puc)).toMatchObject({ kind: 'office', role: 'mentioned' })
    expect(byId.get(ids.nakamura)).toMatchObject({ kind: 'person', role: 'mentioned' })
    // Merged duplicate answers to the same alias: one tag on the survivor, not an ambiguity.
    expect(byId.get(ids.annDoe)).toMatchObject({ kind: 'person' })
    const smith = mentions.find(m => m.surface === 'John Smith')
    expect(smith).toMatchObject({ entityId: null, candidates: [ids.smith1, ids.smith2].sort() })
    expect(byId.has(ids.smith1)).toBe(false)
    const entityCount = await db.one<{ n: string }>(`select count(*)::text n from entity`)
    expect(Number(entityCount!.n)).toBe(11) // nothing created
  })

  it('summarizes with a cited model, falls back to the feed excerpt, and keeps staff summaries', async () => {
    const [item] = parseFeed(fixture('civil-beat.xml'))
    const doc = await upsertDocument(db, {
      source: 'news', source_record_id: `civil_beat:${item.guid}`, doc_type: 'article', url: item.link, title: item.title, doc_date: '2026-06-29',
      raw: { outlet: 'civil_beat', outlet_name: 'Honolulu Civil Beat', guid: item.guid, title: item.title, published: item.published, description: item.description }, body_text: item.content,
    })
    docId = doc.id
    await db.query(`insert into edge(type, from_id, from_name_raw, document_id, match_status, role) values ('mentioned_in', $1, 'Josh Green', $2, 'matched', 'subject')`, [ids.green, docId])

    // No model → publisher excerpt.
    let r = await summarizePendingArticles(db, { model: null })
    expect(r).toEqual({ considered: 1, model: 0, fallback: 1, errors: 0 })
    const s = await db.one<{ body: string; author: string; cites: string[]; status: string; tier: string }>(`select body, author, cites, status, tier from summary where document_id = $1`, [docId])
    expect(s).toMatchObject({ body: 'Gov. Josh Green signed the measure Monday. The law requires a new review of utility wildfire plans.', author: FALLBACK_AUTHOR, cites: [docId], status: 'published', tier: 'free' })
    expect((await summarizePendingArticles(db, { model: null })).considered).toBe(0)

    // Model output that fails citation validation twice → stays on the fallback.
    const prompts: string[] = []
    const bad: NarrativeModel = { name: 'bad', async generate() { return { insufficient: false, sentences: [{ text: 'Uncited claim.', cites: [] }] } } }
    r = await summarizePendingArticles(db, { model: bad, retryFallbacks: true })
    expect(r).toMatchObject({ considered: 1, model: 0, fallback: 1 })

    // A valid model upgrades the fallback.
    const good: NarrativeModel = {
      name: 'fake-model',
      async generate(system, user): Promise<{ sentences: CitedSentence[] }> {
        prompts.push(`${system}\n${user}`)
        return { sentences: [
          { text: 'Gov. Josh Green signed SB 1234 on Monday.', cites: ['D1'] },
          { text: 'The law orders the Public Utilities Commission to review a utility wildfire plan.', cites: ['D1'] },
        ] }
      },
    }
    r = await summarizePendingArticles(db, { model: good, retryFallbacks: true })
    expect(r).toMatchObject({ considered: 1, model: 1, fallback: 0 })
    expect(prompts[0]).toContain('Honolulu Civil Beat')
    expect(prompts[0]).toContain('Headline: Green Signs SB 1234')
    expect(prompts[0]).not.toContain('tracker')
    const rows = await db.many<{ body: string; author: string }>(`select body, author from summary where document_id = $1`, [docId])
    expect(rows).toEqual([{ body: 'Gov. Josh Green signed SB 1234 on Monday. The law orders the Public Utilities Commission to review a utility wildfire plan.', author: 'model:fake-model' }])
    expect((await summarizePendingArticles(db, { model: good, retryFallbacks: true })).considered).toBe(0)

    // Document updated in place after the summary → re-summarized. Staff summaries are never replaced.
    await db.query(`update document set fetched_at = now() + interval '1 minute' where id = $1`, [docId])
    expect((await summarizePendingArticles(db, { model: good })).model).toBe(1)
    await db.query(`insert into summary(document_id, body, cites, author, status, tier) values ($1, 'Staff summary.', array[$1]::uuid[], 'staff:u1', 'published', 'free')`, [docId])
    await db.query(`update document set fetched_at = now() + interval '2 minutes' where id = $1`, [docId])
    expect((await summarizePendingArticles(db, { model: good })).considered).toBe(0)
  })

  it('lists news with the latest summary and matched tags, filterable by outlet and entity', async () => {
    const { rows, total } = await listNews(db)
    expect(total).toBe(1)
    expect(rows[0]).toMatchObject({ id: docId, outlet: 'civil_beat', outlet_name: 'Honolulu Civil Beat', summary: 'Staff summary.' })
    expect(rows[0].tags).toEqual([{ id: ids.green, kind: 'person', name: 'Josh Green', slug: 'josh-green', role: 'subject' }])
    expect((await listNews(db, { entityId: ids.green })).total).toBe(1)
    expect((await listNews(db, { entityId: ids.hei })).total).toBe(0)
    expect((await listNews(db, { outlet: 'khon2' })).total).toBe(0)
    expect(await newsOutletCounts(db)).toEqual([{ outlet: 'civil_beat', outlet_name: 'Honolulu Civil Beat', n: 1 }])
  })
})
