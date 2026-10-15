import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from './helpers/pglite'
import { normalize } from '@/lib/entity-match'
import { clusterArticles, rebuildStories, summarizeStories, storyFacts, type StoryArticle } from '@/lib/news/stories'
import { tagArticle, keyNames, firstLastKey, TAGGER_VERSION } from '@/lib/news/tagger'
import { retagArticles, retagPending, RETAG_SOURCE } from '@/lib/news/retag'
import { listNewsStories, storyTags } from '@/lib/db/queries/news'
import { upsertDocument } from '@/lib/import/pipeline'
import type { NarrativeModel } from '@/lib/ai/claude'

const H = 3600_000
const t0 = Date.parse('2026-10-10T18:00:00Z')
const art = (id: string, title: string, text: string, outlet: string, hours: number, tags: string[] = []): StoryArticle => ({ id, title, text, outlet, at: t0 + hours * H, tags })

describe('clusterArticles', () => {
  const corpus: StoryArticle[] = [
    art('a1', 'Green signs bill raising Hawaii minimum wage to $18', 'Gov. Josh Green signed legislation raising the minimum wage to $18 an hour by 2028.', 'civil_beat', 0, ['green']),
    art('a2', 'Governor signs minimum wage increase into law', 'The state minimum wage will rise to $18 an hour under a bill Gov. Josh Green signed Tuesday.', 'star_advertiser', 3, ['green']),
    art('a3', 'Minimum wage to hit $18 after Green signs measure', 'Workers will see the minimum wage climb to $18 hourly, Gov. Josh Green said after signing the bill.', 'hawaii_news_now', 20, ['green']),
    art('b1', 'Maui County Council delays vote on short-term rental phase-out', 'The council postponed a vote on Bill 9, which would phase out vacation rentals in apartment districts.', 'maui_news', 1),
    art('b2', 'Council postpones short-term rental phase-out vote', 'Maui council members delayed a decision on phasing out vacation rentals in apartment-zoned districts.', 'maui_now', 5),
    art('c1', 'UH volleyball sweeps Wyoming', 'The Rainbow Wahine won in three sets on Saturday.', 'khon2', 2),
    art('c2', 'UH volleyball sweeps Wyoming', 'The Rainbow Wahine won in three sets.', 'kitv', 2.5),
    art('a4', 'Minimum wage bill signed by governor raises pay to $18', 'Gov. Josh Green signed the minimum wage increase to $18 an hour.', 'khon2', 24 * 6, ['green']),
    art('d1', 'Kauai water board approves rate increase', 'The Department of Water raised rates by 8%.', 'garden_island', 4),
  ]
  const groups = clusterArticles(corpus)
  const of = (id: string) => groups.find(g => g.members.some(m => m.id === id))!
  const ids = (id: string) => of(id).members.map(m => m.id).sort()

  it('groups reports of the same event across outlets', () => {
    expect(ids('a1')).toEqual(['a1', 'a2', 'a3'])
    expect(ids('b1')).toEqual(['b1', 'b2'])
  })
  it('always groups syndicated copies with identical headlines', () => {
    expect(ids('c1')).toEqual(['c1', 'c2'])
  })
  it('keeps unrelated stories apart and does not join stories outside the time window', () => {
    expect(ids('d1')).toEqual(['d1'])
    expect(ids('a4')).toEqual(['a4'])
    expect(groups).toHaveLength(5)
  })
  it('keys a story by its earliest article and records the join similarity', () => {
    const g = of('a2')
    expect(g.key).toBe('a1')
    expect(g.members.find(m => m.id === 'a1')!.similarity).toBeNull()
    expect(g.members.find(m => m.id === 'a2')!.similarity).toBeGreaterThan(0.42)
    expect(['a1', 'a2', 'a3']).toContain(g.leadId)
  })
  it('is independent of input order', () => {
    const again = clusterArticles([...corpus].reverse())
    expect(again.map(g => g.members.map(m => m.id).sort().join()).sort()).toEqual(groups.map(g => g.members.map(m => m.id).sort().join()).sort())
  })
})

describe('key people and organizations', () => {
  it('identifies titled and quoted people and suffixed organizations; strips titles and possessives', () => {
    const names = keyNames('Mayor Rick Blangiardi vetoes rail bill',
      'Sen. Jarrett Keohokalole said the measure would pass. "It is a start," said Kalani Akana. Rep. Nadine K. Nakamura’s committee met. ' +
      'The Hawaii Housing Finance and Development Corporation and the Honolulu City Council will review it.')
    expect(names.map(n => [n.surface, n.kind, n.cue])).toEqual([
      ['Rick Blangiardi', 'person', 'title:Mayor'],
      ['Jarrett Keohokalole', 'person', 'title:Sen'],
      ['Nadine K. Nakamura', 'person', 'title:Rep'],
      ['Kalani Akana', 'person', 'said'],
      ['Hawaii Housing Finance and Development Corporation', 'org', 'org:Corporation'],
      ['Honolulu City Council', 'org', 'org:Council'],
    ])
  })
  it('reduces 3–5 word names to first + last, ignoring suffixes', () => {
    expect(firstLastKey('Joshua B. Green')).toBe('joshua green')
    expect(firstLastKey('Leodoloff R. Asuncion, Jr.')).toBe('leodoloff asuncion')
    expect(firstLastKey('Josh Green')).toBeNull()
  })
})

describe('tagging against the database, re-tagging, stories', () => {
  let db: TestDb
  const ids: Record<string, string> = {}
  const entity = async (kind: string, name: string, aliases: string[] = []) =>
    (await db.one<{ id: string }>(`insert into entity(kind, name, aliases, attributes) values ($1, $2, $3, $4) returning id`,
      [kind, name, aliases, JSON.stringify({ slug: normalize(name).replace(/ /g, '-') + '-' + Math.random().toString(36).slice(2, 6) })]))!.id
  const article = async (key: string, outlet: string, title: string, body: string, published: string) =>
    (await upsertDocument(db, {
      source: 'news', source_record_id: `${outlet}:${key}`, doc_type: 'article', url: `https://example.org/${outlet}/${key}`, title, doc_date: published.slice(0, 10),
      raw: { outlet, outlet_name: outlet.toUpperCase(), guid: key, title, published, description: body }, body_text: body,
    })).id

  beforeAll(async () => {
    db = await createTestDb()
    ids.uh1 = await entity('org', 'UNIVERSITY OF HAWAII')
    ids.uh2 = await entity('org', 'University of Hawaii')
    ids.joshua = await entity('person', 'Joshua B. Green')
    ids.keo = await entity('person', 'Jarrett Keohokalole')
    ids.dlnr = await entity('org', 'Department of Land and Natural Resources', ['DLNR'])
    // uh2 is the better-connected duplicate.
    const doc = await article('seed', 'seed', 'Seed', 'Seed.', '2026-01-01T00:00:00Z')
    await db.query(`insert into edge(type, from_id, from_name_raw, document_id, match_status) values ('mentioned_in', $1, 'University of Hawaii', $2, 'matched')`, [ids.uh2, doc])
  })
  afterAll(async () => { await db.end() })

  it('expands curated acronyms, collapses duplicate organizations, matches first + last names, and keeps unknown people for review', async () => {
    const m = await tagArticle(db, {
      title: 'UH regents back DLNR land swap',
      body: 'Joshua Green said the swap would help. Sen. Jarrett Keohokalole questioned it. Board chair Alapaki Nahale-a said the board would vote next month.',
      published: '2026-10-10T00:00:00Z',
    })
    const by = (surface: string) => m.find(x => x.surface === surface)
    expect(by('UH')).toMatchObject({ entityId: ids.uh2, matchedOn: 'acronym', role: 'subject', candidates: [ids.uh1, ids.uh2].sort() })
    expect(by('DLNR')).toMatchObject({ entityId: ids.dlnr, matchedOn: 'alias', role: 'subject' })
    expect(by('Joshua Green')).toMatchObject({ entityId: ids.joshua, kind: 'person' })
    expect(by('Jarrett Keohokalole')).toMatchObject({ entityId: ids.keo, matchedOn: 'name' })
    expect(by('Alapaki Nahale-a')).toMatchObject({ entityId: null, kind: 'person', matchedOn: 'extracted', cue: 'said' })
    expect(m.filter(x => x.surface === 'Jarrett Keohokalole')).toHaveLength(1)
  })

  it('re-tags stored articles once per tagger version, upgrading review edges and never touching matched ones', async () => {
    const doc = await article('rt', 'civil_beat', 'Joshua Green names new DLNR chief', 'The governor announced the pick Monday.', '2026-10-09T20:00:00Z')
    // Tagged by an older tagger: the DLNR acronym sat in review, and a staff-matched edge exists.
    await db.query(`insert into edge(type, from_name_raw, document_id, match_status, role, attributes) values ('mentioned_in', 'DLNR', $1, 'review', 'subject', '{"mention_type":"news"}')`, [doc])
    await db.query(`insert into edge(type, from_id, from_name_raw, document_id, match_status, role) values ('mentioned_in', $1, 'Joshua Green', $2, 'matched', 'subject')`, [ids.keo, doc])
    expect(await retagPending(db)).toBe(true)
    const r = await retagArticles(db, { limit: 50 })
    expect(r).toMatchObject({ errors: 0, done: true })
    expect(r.updated).toBeGreaterThanOrEqual(1)
    const edges = await db.many<{ from_name_raw: string; from_id: string | null; match_status: string }>(
      `select from_name_raw, from_id, match_status from edge where document_id = $1 order by from_name_raw`, [doc])
    expect(edges).toEqual([
      { from_name_raw: 'DLNR', from_id: ids.dlnr, match_status: 'matched' },
      { from_name_raw: 'Joshua Green', from_id: ids.keo, match_status: 'matched' }, // a staff decision stays as it was
    ])
    const c = await db.one<{ metadata: { version: number } }>(`select metadata from import_cursor where source = $1`, [RETAG_SOURCE])
    expect(c!.metadata.version).toBe(TAGGER_VERSION)
    expect(await retagPending(db)).toBe(false)
  })

  it('stores stories with stable ids, summarizes multi-outlet stories with citations, and lists them with coverage and tags', async () => {
    const a = await article('w1', 'civil_beat', 'Green signs bill raising Hawaii minimum wage to $18', 'Gov. Josh Green signed legislation raising the minimum wage to $18 an hour by 2028.', '2026-10-10T18:00:00Z')
    const b = await article('w2', 'star_advertiser', 'Governor signs minimum wage increase into law', 'The state minimum wage will rise to $18 an hour under a bill Gov. Josh Green signed Tuesday.', '2026-10-10T21:00:00Z')
    const lone = await article('x1', 'khon2', 'Honolulu rail opens new stations', 'Skyline added four stations.', '2026-10-10T22:00:00Z')
    await db.query(`insert into edge(type, from_id, from_name_raw, document_id, match_status, role) values ('mentioned_in', $1, 'Josh Green', $2, 'matched', 'subject'), ('mentioned_in', $1, 'Josh Green', $3, 'matched', 'mentioned')`, [ids.joshua, a, b])

    // Before the first rebuild, articles still list (one-article stories).
    const before = await listNewsStories(db, { outlet: 'khon2' })
    expect(before.rows.map(r => r.id)).toEqual([lone])

    const built = await rebuildStories(db, { days: 100000 })
    expect(built.multi).toBe(1)
    const story = await db.one<{ id: string; story_key: string; article_count: number; outlet_count: number; headline: string }>(
      `select s.id, s.story_key, s.article_count, s.outlet_count, s.headline from ax_news_story s join ax_news_story_article m on m.story_id = s.id where m.document_id = $1`, [a])
    expect(story).toMatchObject({ story_key: a, article_count: 2, outlet_count: 2 })

    // Without a model: the lead article's text stands in.
    let r = await summarizeStories(db, { model: null })
    expect(r).toMatchObject({ considered: 1, model: 0, fallback: 1 })

    const prompts: string[] = []
    const model: NarrativeModel = {
      name: 'fake-model',
      async generate(_system, user) {
        prompts.push(user)
        return { sentences: [{ text: 'Gov. Josh Green signed a bill raising the minimum wage to $18 an hour.', cites: ['D1', 'D2'] }] }
      },
    }
    r = await summarizeStories(db, { model })
    expect(r).toMatchObject({ considered: 1, model: 1 })
    expect(prompts[0]).toContain('CIVIL_BEAT headline: Green signs bill')
    expect(prompts[0]).toContain('STAR_ADVERTISER: The state minimum wage')
    const s = await db.one<{ summary: string; summary_author: string; summary_cites: string[] }>(`select summary, summary_author, summary_cites from ax_news_story where id = $1`, [story!.id])
    expect(s).toMatchObject({ summary: 'Gov. Josh Green signed a bill raising the minimum wage to $18 an hour.', summary_author: 'model:fake-model' })
    expect([...s!.summary_cites].sort()).toEqual([a, b].sort())

    // A rebuild with the same articles keeps the id and the summary; a new article reopens the summary.
    await rebuildStories(db, { days: 100000 })
    expect((await summarizeStories(db, { model })).considered).toBe(0)
    const c = await article('w3', 'hawaii_news_now', 'Minimum wage to hit $18 after Green signs measure', 'Workers will see the minimum wage climb to $18 hourly, Gov. Josh Green said.', '2026-10-11T08:00:00Z')
    await rebuildStories(db, { days: 100000 })
    const again = await db.one<{ id: string; article_count: number }>(`select s.id, s.article_count from ax_news_story s join ax_news_story_article m on m.story_id = s.id where m.document_id = $1`, [c])
    expect(again).toEqual({ id: story!.id, article_count: 3 })
    expect((await summarizeStories(db, { model })).considered).toBe(1)

    const { rows } = await listNewsStories(db)
    const wage = rows.find(x => x.id === story!.id)!
    expect(wage.articles.map(x => x.outlet)).toEqual(['civil_beat', 'star_advertiser', 'hawaii_news_now'])
    expect(wage.outlet_count).toBe(3)
    expect(wage.summary).toBe('Gov. Josh Green signed a bill raising the minimum wage to $18 an hour.')
    expect(wage.tags).toEqual([expect.objectContaining({ id: ids.joshua, role: 'subject', articles: 2 })])
    expect((await listNewsStories(db, { entityId: ids.joshua })).rows.map(x => x.id)).toContain(story!.id)
    expect((await listNewsStories(db, { outlet: 'star_advertiser' })).rows.map(x => x.id)).toEqual([story!.id])
  })

  it('builds story facts one outlet at a time and merges tags across articles', () => {
    const facts = storyFacts([
      { id: 'a', title: 'A', body_text: 'One. Two.', description: null, outlet_name: 'X', published: '2026-10-10T00:00:00Z', lead_summary: null },
      { id: 'b', title: 'B', body_text: null, description: 'Three.', outlet_name: 'X', published: null, lead_summary: null },
      { id: 'c', title: 'C', body_text: 'Four.', description: null, outlet_name: 'Y', published: null, lead_summary: null },
    ])
    expect(facts.map(f => f.documentId)).toEqual(['a', 'a', 'a', 'c', 'c', 'b', 'b'])
    const t = { kind: 'person', slug: null }
    expect(storyTags([
      { tags: [{ ...t, id: '1', name: 'Zed', role: 'mentioned' }, { ...t, id: '2', name: 'Amy', role: 'mentioned' }] },
      { tags: [{ ...t, id: '2', name: 'Amy', role: 'mentioned' }, { ...t, id: '3', name: 'Bo', role: 'subject' }] },
    ] as never).map(x => [x.name, x.articles])).toEqual([['Bo', 1], ['Amy', 2], ['Zed', 1]])
  })
})
